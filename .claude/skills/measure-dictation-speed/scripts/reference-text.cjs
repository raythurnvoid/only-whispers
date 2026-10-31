// Reference text for each WAV in ./audio-real/ from Mistral's batch model (the app's
// Retry and Upload path), written to ./ref-real.json. Used to count word errors.
// Usage: node reference-text.cjs
const fs = require("fs");
const path = require("path");
const { mistralKey, checkWorkDir } = require("./common.cjs");

checkWorkDir();
(async () => {
  const out = {};
  for (const f of fs.readdirSync("audio-real").filter((x) => x.endsWith(".wav"))) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([fs.readFileSync(path.join("audio-real", f))], { type: "audio/wav" }),
      f
    );
    form.append("model", "voxtral-mini-transcribe-3-0");
    form.append("language", "en");
    const res = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "x-api-key": mistralKey() },
      body: form,
    });
    const body = await res.json();
    out[f] = res.ok ? body.text.trim() : { error: res.status };
    process.stdout.write(".");
  }
  fs.writeFileSync("ref-real.json", JSON.stringify(out, null, 1));
  console.log("\nDONE", Object.keys(out).length);
})();
