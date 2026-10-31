// Streams one WAV to Mistral realtime at real-time speed, like the app (50 ms PCM chunks,
// language "en"), then "releases" (input_audio.end) and prints one JSON line with every
// text delta and its time. Times are ms from the first audio chunk.
// Usage: node mistral-live.cjs <wav> <delayMs> <trailMs|asis>
//   asis   = keep the file's real silence before the release (use for real recordings)
//   number = cut the file at speech end, then add that much silence (synthetic tests)
// Env SPEECH_LEVEL: mean abs sample level that counts as speech (default 300).
const fs = require("fs");
const path = require("path");
const { fromRepo, mistralKey } = require("./common.cjs");
const WebSocket = fromRepo("ws");

const [wavPath, delayArg = "1200", trailArg = "asis"] = process.argv.slice(2);
const delay = Number(delayArg);
const asis = trailArg === "asis";
const trailMs = asis ? 0 : Number(trailArg);
const SPEECH_LEVEL = Number(process.env.SPEECH_LEVEL || 300);

const loadPcm = (file) => {
  const buf = fs.readFileSync(file);
  return buf.subarray(buf.indexOf("data") + 8);
};
// End of the last 20 ms window with speech energy: what the app could know from mic level.
function speechEndMs(pcm) {
  const win = 320;
  let last = 0;
  for (let i = 0; i + win * 2 <= pcm.length; i += win * 2) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += Math.abs(pcm.readInt16LE(i + j * 2));
    if (sum / win > SPEECH_LEVEL) last = i + win * 2;
  }
  return (last / 2 / 16000) * 1000;
}
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

(async () => {
  let pcm = loadPcm(wavPath);
  const endMs = speechEndMs(pcm);
  if (!asis)
    pcm = Buffer.concat([
      pcm.subarray(0, Math.round((endMs / 1000) * 16000) * 2),
      Buffer.alloc(Math.round((trailMs / 1000) * 16000) * 2),
    ]);
  const ws = new WebSocket(
    "wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3",
    { headers: { Authorization: `Bearer ${mistralKey()}` } }
  );
  let text = "";
  const deltas = [];
  let t0 = 0;
  const done = new Promise((resolve, reject) => {
    ws.on("message", (data) => {
      const e = JSON.parse(data.toString());
      if (e.type === "session.updated") ws.emit("ready");
      if (e.type === "transcription.text.delta") {
        text += e.text || "";
        deltas.push({ t: Math.round(performance.now() - t0), text });
      }
      if (e.type === "transcription.done")
        resolve({ t: performance.now(), text: (e.text ?? text).trim() });
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
          target_streaming_delay_ms: delay,
          language: "en",
        },
      })
    )
  );
  await new Promise((r) => ws.once("ready", r));
  t0 = performance.now();
  const chunk = 1600; // 800 samples = 50 ms
  for (let i = 0, n = 0; i < pcm.length; i += chunk, n++) {
    const wait = t0 + n * 50 - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    ws.send(
      JSON.stringify({
        type: "input_audio.append",
        audio: pcm.subarray(i, i + chunk).toString("base64"),
      })
    );
  }
  const endSentAt = performance.now();
  const textAtRelease = text;
  ws.send(JSON.stringify({ type: "input_audio.end" }));
  const final = await done;
  ws.close();
  console.log(
    JSON.stringify({
      file: path.basename(wavPath),
      delay,
      trailMs: asis ? "asis" : trailMs,
      speechEndMs: Math.round(endMs),
      releaseMs: Math.round(endSentAt - t0),
      finalizeMs: Math.round(final.t - endSentAt), // release -> transcription.done
      normAtRelease: norm(textAtRelease) === norm(final.text),
      deltasEqualFinal: text.trim() === final.text,
      lastDeltaAfterSpeechEndMs: deltas.length
        ? deltas[deltas.length - 1].t - Math.round(endMs)
        : null,
      final: final.text,
      doneAfterStartMs: Math.round(final.t - t0),
      deltas,
    })
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
