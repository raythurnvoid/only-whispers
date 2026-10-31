// Streams every WAV in ./audio-real/ once per delay (real silence kept), 3 at a time,
// and writes one JSON line per run to <out>. About (total audio x delays / 3) minutes.
// Usage: node run-live.cjs <out.jsonl> [delays=1200,800,480]
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { checkWorkDir } = require("./common.cjs");

checkWorkDir();
const [outFile = "results-real.jsonl", delays = "1200,800,480"] = process.argv.slice(2);
const files = fs.readdirSync("audio-real").filter((x) => x.endsWith(".wav"));
const cases = files.flatMap((f) => delays.split(",").map((d) => [`audio-real/${f}`, d, "asis"]));
const out = [];
let next = 0;
const worker = () =>
  new Promise((done) => {
    const run = () => {
      const c = cases[next++];
      if (!c) return done();
      execFile(
        process.execPath,
        [path.join(__dirname, "mistral-live.cjs"), ...c],
        { timeout: 180000, maxBuffer: 1 << 24 },
        (err, stdout, stderr) => {
          out.push(
            err ? JSON.stringify({ case: c, error: (stderr || err.message).trim() }) : stdout.trim()
          );
          process.stdout.write(".");
          run();
        }
      );
    };
    run();
  });
// Collect in memory and write once: parallel appends to one file lose lines.
Promise.all([worker(), worker(), worker()]).then(() => {
  fs.writeFileSync(outFile, out.join("\n") + "\n");
  console.log("\nDONE", out.length);
});
