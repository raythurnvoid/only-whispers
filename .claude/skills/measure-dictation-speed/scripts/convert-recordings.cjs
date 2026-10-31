// Converts the newest real recordings the app saved (userData/audio/*.webm) to 16 kHz
// mono PCM WAV in ./audio-real/. Skips tiny clips and very long ones.
// Usage: node convert-recordings.cjs [count=30]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { REPO, USER_DATA, checkWorkDir } = require("./common.cjs");

checkWorkDir();
const ffmpeg = require(path.join(REPO, "node_modules", "ffmpeg-static"));
const src = path.join(USER_DATA, "audio");
const files = fs
  .readdirSync(src)
  .filter((f) => f.endsWith(".webm"))
  .map((f) => ({ f, size: fs.statSync(path.join(src, f)).size }))
  .filter((x) => x.size > 40000 && x.size < 1500000)
  .sort((a, b) => a.f.localeCompare(b.f, undefined, { numeric: true }))
  .slice(-Number(process.argv[2] || 30));
fs.mkdirSync("audio-real", { recursive: true });
for (const { f } of files) {
  const out = path.join("audio-real", f.replace(".webm", ".wav"));
  if (!fs.existsSync(out))
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-i",
      path.join(src, f),
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      out,
    ]);
  console.log(out, Math.round(((fs.statSync(out).size - 44) / 32000) * 10) / 10, "s");
}
