// Replays real recordings through the app's own cleanup sockets (src/helpers/chatgptResponsesSocket.js),
// once per setup ("mode") per file, one run after the other. The order of the modes turns by one on
// every file. Never run modes at once: parallel requests slow Luna down, which the app never does.
//   base:          prefill at release only (the app today without the early cleanup)
//   early:         base + early cleanup (speech end + 880 ms, then 150 ms with no new words)
//   rolling:       base + a prefill while speaking each time the text grew by ROLLING_STEP words
//   rolling-skip:  rolling, but no prefill at release when a rolling prefill was sent
//   rolling-early: rolling + early cleanup
// Audio goes to Mistral at real-time speed (50 ms chunks, delay 480). Prints one JSON line per run
// with the time from release to the cleaned text. `changed: false` means the mode did the same as
// base on that file (the control group). Analyze with analyze-replay.cjs.
// Needs a fresh ChatGPT token: if it expired, dictate once in the app (never refresh here).
// Run from a folder outside the repo.
// Usage: node cleanup-replay.cjs <wav folder> [maxSeconds=30] [modes=base,early]
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { REPO, fromRepo, mistralKey, chatgpt, checkWorkDir } = require("./common.cjs");
const WebSocket = fromRepo("ws");
const prompts = require(path.join(REPO, "src/locales/en/prompts.json"));

checkWorkDir();
const [folder, maxArg = "30", modesArg = "base,early"] = process.argv.slice(2);
const modes = modesArg.split(",");
const auth = chatgpt();
if (auth.expires - Date.now() < 60000) {
  console.error("ChatGPT token expired. Dictate once in the app, then run again.");
  process.exit(1);
}

// The app's values (audioManager.js, mistralRealtimeStreaming.js). Change them here when the app changes.
const DELAY_MS = 480;
const AFTER_SPEECH_MS = 480 + 400;
const QUIET_MS = 150;
const SPEECH_LEVEL = 300;
// Not in the app yet: the planned rolling prefill.
const ROLLING_STEP = Number(process.env.ROLLING_STEP || 15);
// Same text as wrapCleanupTranscript and cleanupTranscriptStart (src/config/prompts/index.ts).
const wrap = (text) => `<transcript>\n${text}\n</transcript>\n\nOutput only the cleaned transcript.`;
const transcriptStart = (text) => `<transcript>\n${text}`;
const body = (text) => ({
  model: "gpt-6-luna",
  instructions: prompts.cleanupPrompt,
  input: [{ role: "user", content: [{ type: "input_text", text }] }],
  store: false,
  service_tier: "priority",
  reasoning: { effort: "none" },
});
// The live text without its last word, which may still be cut in half (as the app's prefill).
const prefillText = (text) => {
  const live = text.trimStart();
  return live.slice(0, live.lastIndexOf(" ") + 1);
};
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

// One copy of the app's socket module, with the token read (not refreshed) from the app's store.
const socketPath = path.join(REPO, "src/helpers/chatgptResponsesSocket.js");
function loadSocketModule() {
  delete require.cache[socketPath];
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === socketPath) {
      if (request === "./chatgptAuth") return { getAccessToken: async () => auth.access };
      if (request === "./debugLogger") return { debug() {} };
    }
    return original.call(this, request, parent, isMain);
  };
  try {
    return require(socketPath);
  } finally {
    Module._load = original;
  }
}

const loadPcm = (file) => {
  const buf = fs.readFileSync(file);
  return buf.subarray(buf.indexOf("data") + 8);
};

async function replay(file, copy, mode) {
  const useEarly = mode.endsWith("early");
  const rolling = mode.startsWith("rolling");
  const pcm = loadPcm(file);
  copy.warmup(); // dictation start
  const ws = new WebSocket(
    "wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3",
    { headers: { Authorization: `Bearer ${mistralKey()}` } }
  );
  let text = "";
  let textAt = 0;
  // Rolling prefill: one at a time, each with the whole text so far.
  let rollingPrefills = 0;
  let rollingWords = 0;
  let rollingInFlight = false;
  let released = false;
  const rollPrefill = () => {
    const start = prefillText(text);
    if (released || rollingInFlight || wordCount(start) - rollingWords < ROLLING_STEP) return;
    rollingInFlight = true;
    rollingWords = wordCount(start);
    rollingPrefills += 1;
    copy.prefillTranscript(transcriptStart(start)).finally(() => {
      rollingInFlight = false;
    });
  };
  const done = new Promise((resolve, reject) => {
    ws.on("message", (data) => {
      const e = JSON.parse(data.toString());
      if (e.type === "session.updated") ws.emit("ready");
      if (e.type === "transcription.text.delta") {
        text += e.text || "";
        textAt = performance.now();
        if (rolling) rollPrefill();
      }
      if (e.type === "transcription.done") {
        resolve({ at: performance.now(), text: (e.text ?? text).trim() });
      }
      if (e.type === "error") reject(new Error(JSON.stringify(e.error)));
    });
    ws.on("error", reject);
  });
  ws.on("open", () =>
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          audio_format: { encoding: "pcm_s16le", sample_rate: 16000 },
          target_streaming_delay_ms: DELAY_MS,
          language: "en",
        },
      })
    )
  );
  // A network error rejects done, so it must also end the wait for "ready".
  done.catch(() => {});
  await Promise.race([new Promise((resolve) => ws.once("ready", resolve)), done]);

  // Like the app, a 50 ms chunk is sent once its audio has been heard.
  const t0 = performance.now();
  let speechEndAt = 0;
  for (let i = 0, n = 0; i < pcm.length; i += 1600, n++) {
    const wait = t0 + (n + 1) * 50 - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const chunk = pcm.subarray(i, i + 1600);
    const samples = new Int16Array(
      chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length)
    );
    for (let start = 0; start < samples.length; start += 400) {
      const part = samples.subarray(start, start + 400);
      let sum = 0;
      for (const sample of part) sum += Math.abs(sample);
      if (sum / part.length > SPEECH_LEVEL) speechEndAt = t0 + n * 50 + (start + part.length) / 16;
    }
    ws.send(JSON.stringify({ type: "input_audio.append", audio: chunk.toString("base64") }));
  }
  const releaseAt = performance.now();
  released = true;
  ws.send(JSON.stringify({ type: "input_audio.end" }));

  const start = prefillText(text);
  const skipReleasePrefill = mode === "rolling-skip" && rollingPrefills > 0;
  if (start && !skipReleasePrefill) copy.prefillTranscript(transcriptStart(start));

  let earlySentAt = null;
  let timer = null;
  let finished = false;
  if (useEarly && speechEndAt) {
    const sendAfter = speechEndAt + AFTER_SPEECH_MS;
    const trySend = () => {
      if (finished) return;
      const wait = Math.max(sendAfter, textAt + QUIET_MS) - performance.now();
      if (wait > 0) {
        timer = setTimeout(trySend, wait);
        return;
      }
      if (!text.trim()) return;
      earlySentAt = performance.now();
      copy.sendEarly(wrap(text.trim()));
    };
    trySend();
  }

  const final = await done;
  finished = true;
  clearTimeout(timer);
  ws.close();
  const result = await copy.createResponse(body(wrap(final.text)), 15000);
  return {
    mode,
    file: path.basename(file),
    seconds: +(pcm.length / 32000).toFixed(1),
    words: wordCount(final.text),
    changed: mode !== "base" && (earlySentAt !== null || rollingPrefills > 0),
    stopMs: Math.round(final.at - releaseAt),
    earlySentMs: earlySentAt === null ? null : Math.round(earlySentAt - releaseAt),
    early: result.early,
    rollingPrefills,
    prefilled: result.prefilled,
    prefillWaitMs: result.prefillWaitMs,
    prefillMs: result.prefillMs,
    restChars: result.restChars,
    cleanedMs: Math.round(performance.now() - releaseAt),
  };
}

(async () => {
  const copy = loadSocketModule();
  // One cleanup, so later dictations have a prompt to warm, prefill and send early with.
  await copy.createResponse(body(wrap("hello this is a test")), 15000);
  const files = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith(".wav"))
    .map((f) => path.join(folder, f))
    .filter((f) => fs.statSync(f).size / 32000 <= Number(maxArg));
  for (const [index, file] of files.entries()) {
    const turn = index % modes.length;
    for (const mode of [...modes.slice(turn), ...modes.slice(0, turn)]) {
      try {
        console.log(JSON.stringify(await replay(file, copy, mode)));
      } catch (error) {
        console.log(JSON.stringify({ mode, file: path.basename(file), error: error.message }));
      }
    }
  }
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
