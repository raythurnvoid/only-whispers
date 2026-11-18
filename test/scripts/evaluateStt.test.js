const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("offline comparison scores matching recordings against human words or against each other", (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "only-whispers-eval-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  fs.mkdirSync(path.join(profile, "audio"));
  const db = new DatabaseSync(path.join(profile, "transcriptions.db"));
  db.exec(`CREATE TABLE transcriptions (
    id INTEGER PRIMARY KEY, client_transcription_id TEXT, stt_raw_text TEXT, stt_provider TEXT DEFAULT 'parakeet',
    stt_model TEXT DEFAULT 'local@rev', stt_app_version TEXT DEFAULT 'test', stt_latency_ms INTEGER,
    deleted_at TEXT, status TEXT DEFAULT 'completed', has_audio INTEGER DEFAULT 1, reference_text TEXT,
    timestamp TEXT DEFAULT '2026-11-18 08:15:00'
  )`);
  const add = db.prepare(
    "INSERT INTO transcriptions(id, client_transcription_id, stt_raw_text, reference_text, stt_latency_ms) VALUES (?, ?, ?, ?, ?)"
  );
  add.run(1, "a", "we agree", "we agree", 200);
  add.run(2, "b", "wrong", "", 100);
  add.run(3, "c", "two words", null, 999);
  add.run(4, "d", "do not read", "missing prediction", null);
  add.run(5, "e", "do not read", "missing audio", null);
  add.run(6, "f", "ignore", "deleted", null);
  add.run(7, "g", null, "legacy", null);
  db.exec("UPDATE transcriptions SET deleted_at='now' WHERE id=6");
  db.close();
  for (const id of [1, 2, 3, 4, 6, 7])
    fs.writeFileSync(path.join(profile, "audio", id + ".webm"), "");
  const predictions = path.join(profile, "models.jsonl");
  fs.writeFileSync(
    predictions,
    [
      { id: "a", text: "We strongly agree!", model: "candidate" },
      { id: "b", text: "", model: "candidate" },
      { id: "c", text: "two", model: "candidate" },
      { id: "g", text: "legacy", model: "candidate" },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n")
  );
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../../scripts/evaluate-stt.js"), "--profile", profile, ...args],
      { encoding: "utf8" }
    );
  const reviewed = run("--predictions", predictions);
  assert.equal(reviewed.status, 0, reviewed.stderr);
  assert.doesNotMatch(reviewed.stdout, /strongly agree|do not read/);
  const report = JSON.parse(reviewed.stdout);
  assert.equal(report.eligible, 5);
  assert.equal(report.scored, 3);
  assert.equal(report.paired, 2);
  assert.equal(report.candidateOnly, 1);
  assert.equal(report.missingAudio, 1);
  assert.equal(report.missingPrediction, 1);
  const legacy = report.comparisons.find((group) => group.recordedModel === null);
  assert.equal(legacy.candidateWerPct, 0);
  assert.equal(legacy.recordedWerPct, null);
  assert.equal(legacy.recordedEdits, null);
  assert.deepEqual(
    report.comparisons.find((group) => group.recordedModel === "local@rev"),
    {
      recordedProvider: "parakeet",
      recordedModel: "local@rev",
      recordedAppVersion: "test",
      candidateModel: "candidate",
      clips: 2,
      referenceWords: 2,
      recordedEdits: 1,
      candidateEdits: 1,
      recordedWerPct: 50,
      candidateWerPct: 50,
      releaseToRawMedianMs: 150,
      releaseToRawClips: 2,
      replayMedianMs: null,
      replayTimedClips: 0,
    }
  );
  const raw = JSON.parse(
    run("--agreement", "--predictions", predictions, "--show-mismatches").stdout
  );
  assert.equal(raw.comparisons[0].disagreementPct, 50);
  assert.equal(raw.comparisons[0].candidateWerPct, undefined);
  assert.deepEqual(raw.mismatches, [
    { historyId: 3, localTime: new Date("2026-11-18T08:15:00Z").toLocaleString() },
  ]);
  const list = run("--list-inputs", "--through-id", "2", "--limit", "1");
  assert.deepEqual(JSON.parse(list.stdout), {
    id: "b",
    file: path.join(profile, "audio", "2.webm"),
  });
  fs.writeFileSync(predictions, "private malformed transcript");
  const bad = run("--predictions", predictions);
  assert.equal(bad.status, 1);
  assert.doesNotMatch(bad.stderr, /private malformed/);
});
