// Replay saved dictations locally, or score raw predictions from another model.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { parseArgs } = require("node:util");
const { parseDbTimestamp } = require("../src/helpers/dbTimestamp");
const { LocalSpeechModel } = require("../src/helpers/localModel");

function words(text) {
  return (
    text
      .normalize("NFC")
      .toLowerCase()
      .replaceAll("’", "'")
      .match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:'[\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu) || []
  );
}

// Minimum number of word insertions, removals and replacements.
function wordEdits(reference, prediction) {
  const costs = Array.from({ length: prediction.length + 1 }, (_, i) => i);
  for (const word of reference) {
    let diagonal = costs[0];
    costs[0]++;
    for (let j = 1; j < costs.length; j++) {
      const above = costs[j];
      costs[j] = Math.min(
        above + 1,
        costs[j - 1] + 1,
        diagonal + Number(word !== prediction[j - 1])
      );
      diagonal = above;
    }
  }
  return costs.at(-1);
}

function loadPredictions(filename) {
  const predictions = new Map();
  const lines = fs.readFileSync(filename, "utf8").trim().split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on prediction line ${i + 1}.`);
    }
    if (
      typeof row?.id !== "string" ||
      !row.id ||
      typeof row.text !== "string" ||
      typeof row.model !== "string" ||
      !row.model.trim() ||
      predictions.has(row.id)
    ) {
      throw new Error(
        `Prediction line ${i + 1} needs a unique recording ID, model name and raw text.`
      );
    }
    predictions.set(row.id, row);
  }
  return predictions;
}

function median(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return Math.round((values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2);
}

async function main() {
  const { values } = parseArgs({
    options: {
      profile: { type: "string" },
      agreement: { type: "boolean" },
      limit: { type: "string" },
      "through-id": { type: "string" },
      predictions: { type: "string" },
      "list-inputs": { type: "boolean" },
      "show-mismatches": { type: "boolean" },
    },
  });
  const limit = values.limit === undefined ? (values.agreement ? 30 : -1) : Number(values.limit);
  const through = Number(values["through-id"] ?? Number.MAX_SAFE_INTEGER);
  if (
    (values.limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) ||
    !Number.isSafeInteger(through) ||
    through < 1
  )
    throw new Error("Use positive whole numbers for --limit and --through-id.");
  const config =
    process.platform === "win32"
      ? process.env.APPDATA
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library/Application Support")
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const profile = path.resolve(values.profile ?? path.join(config, "only-whispers"));
  const db = new DatabaseSync(path.join(profile, "transcriptions.db"), { readOnly: true });
  let rows, eligible;
  try {
    // A legacy or retried history result alone cannot establish the original model or words.
    const where = `deleted_at IS NULL AND status = 'completed' AND has_audio = 1
      AND client_transcription_id IS NOT NULL AND id <= ? AND ${
        values.agreement
          ? "reference_text IS NULL AND stt_raw_text IS NOT NULL AND stt_model IS NOT NULL AND stt_provider IS NOT NULL"
          : "reference_text IS NOT NULL"
      }`;
    db.exec("BEGIN");
    eligible = db
      .prepare(`SELECT COUNT(*) AS total FROM transcriptions WHERE ${where}`)
      .get(through).total;
    rows = db
      .prepare(
        `SELECT id, timestamp, client_transcription_id, stt_raw_text, stt_model, stt_provider,
      stt_app_version, stt_latency_ms, reference_text FROM transcriptions
      WHERE ${where} ORDER BY id DESC LIMIT ?`
      )
      .all(through, limit);
  } finally {
    db.close();
  }
  const audio = new Map();
  const audioDir = path.join(profile, "audio");
  if (fs.existsSync(audioDir)) {
    for (const entry of fs.readdirSync(audioDir, { withFileTypes: true })) {
      const id = entry.name.match(/(?:^|-)(\d+)\.webm$/)?.[1];
      if (id && entry.isFile() && !audio.has(Number(id)))
        audio.set(Number(id), path.join(audioDir, entry.name));
    }
  }
  const predictions = values.predictions ? loadPredictions(values.predictions) : null;
  const local = new LocalSpeechModel(profile);
  const groups = new Map();
  const mismatches = [];
  let missingAudio = 0,
    missingPrediction = 0,
    replayFailures = 0,
    scored = 0,
    paired = 0;
  for (const row of rows) {
    const file = audio.get(row.id);
    if (!file) {
      missingAudio++;
      continue;
    }
    const id = row.client_transcription_id;
    if (values["list-inputs"]) {
      console.log(JSON.stringify({ id, file }));
      continue;
    }
    let candidate, replayMs;
    if (predictions) {
      candidate = predictions.get(id);
      if (!candidate) {
        missingPrediction++;
        continue;
      }
    } else {
      const start = performance.now();
      try {
        candidate = await local.transcribe(file);
      } catch (error) {
        // Missing weights affect the whole run. A bad individual clip need not stop it.
        if (!(await local.installedModel())) throw error;
        replayFailures++;
        continue;
      }
      replayMs = performance.now() - start;
      candidate.model = candidate.model + "@" + candidate.modelRevision;
    }
    const hasOriginal =
      row.stt_raw_text !== null && row.stt_model !== null && row.stt_provider !== null;
    const labels = {
      recordedProvider: hasOriginal ? row.stt_provider : null,
      recordedModel: hasOriginal ? row.stt_model : null,
      recordedAppVersion: hasOriginal ? row.stt_app_version : null,
      candidateModel: candidate.model,
    };
    const key = JSON.stringify(labels);
    if (!groups.has(key))
      groups.set(key, {
        ...labels,
        clips: 0,
        referenceWords: 0,
        recordedEdits: hasOriginal ? 0 : null,
        candidateEdits: 0,
        recordedTimes: [],
        replayTimes: [],
      });
    const group = groups.get(key);
    const saved = hasOriginal ? words(row.stt_raw_text) : [];
    const reference = values.agreement ? saved : words(row.reference_text);
    const hypothesis = words(candidate.text);
    group.clips++;
    group.referenceWords += reference.length;
    if (!values.agreement && hasOriginal) group.recordedEdits += wordEdits(reference, saved);
    group.candidateEdits += wordEdits(reference, hypothesis);
    if (hasOriginal && values["show-mismatches"] && saved.join(" ") !== hypothesis.join(" ")) {
      mismatches.push({
        historyId: row.id,
        localTime: parseDbTimestamp(row.timestamp)?.toLocaleString() ?? null,
      });
    }
    if (hasOriginal && row.stt_latency_ms !== null) group.recordedTimes.push(row.stt_latency_ms);
    if (replayMs !== undefined) group.replayTimes.push(replayMs);
    scored++;
    if (hasOriginal) paired++;
  }
  if (values["list-inputs"]) return;
  const comparisons = [];
  for (const {
    referenceWords,
    recordedEdits,
    candidateEdits,
    recordedTimes,
    replayTimes,
    ...labels
  } of groups.values()) {
    const percent = (n) =>
      n !== null && referenceWords ? Number(((100 * n) / referenceWords).toFixed(2)) : null;
    comparisons.push({
      ...labels,
      ...(values.agreement
        ? {
            recordedWords: referenceWords,
            wordDifferences: candidateEdits,
            disagreementPct: percent(candidateEdits),
          }
        : {
            referenceWords,
            recordedEdits,
            candidateEdits,
            recordedWerPct: percent(recordedEdits),
            candidateWerPct: percent(candidateEdits),
          }),
      releaseToRawMedianMs: median(recordedTimes),
      releaseToRawClips: recordedTimes.length,
      replayMedianMs: median(replayTimes),
      replayTimedClips: replayTimes.length,
    });
  }
  console.log(
    JSON.stringify(
      {
        mode: values.agreement ? "unreviewed model disagreement" : "human-reviewed word error rate",
        throughId: rows[0]?.id ?? null,
        eligible,
        selected: rows.length,
        scored,
        paired,
        candidateOnly: scored - paired,
        missingAudio,
        missingPrediction,
        replayFailures,
        comparisons,
        ...(values["show-mismatches"] ? { mismatches } : {}),
      },
      null,
      2
    )
  );
  if (replayFailures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
