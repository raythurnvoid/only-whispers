// Reads the app's newest debug log (userData/logs/debug-*.log, written only with
// --log-level=debug) and prints one row per dictation with the timing of each stage.
// Usage: node log-timings.cjs [log file]
const fs = require("fs");
const path = require("path");
const { USER_DATA } = require("./common.cjs");

const dir = path.join(USER_DATA, "logs");
const file =
  process.argv[2] ||
  fs
    .readdirSync(dir)
    .filter((f) => /^debug-.*\.log$/.test(f))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!file) {
  console.error(`No debug log in ${dir}. Start the app with --log-level=debug and dictate.`);
  process.exit(1);
}

// Entry format (debugLogger.js): "[ISO time] [LEVEL][scope][source] message {meta JSON}",
// where the meta JSON spans the following lines.
const entries = [];
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const m = line.match(/^\[(\d{4}-\d\d-\d\dT[^\]]+)\] \[(\w+)\]((?:\[[^\]]+\])*) (.*)$/);
  if (m) entries.push({ time: m[1], message: m[4], metaText: "" });
  else if (entries.length) entries.at(-1).metaText += line + "\n";
}
for (const e of entries) {
  const brace = e.message.indexOf(" {");
  const text = brace >= 0 ? e.message.slice(brace + 1) + "\n" + e.metaText : e.metaText;
  if (brace >= 0) e.message = e.message.slice(0, brace);
  try {
    e.meta = text.trim() ? JSON.parse(text) : {};
  } catch {
    e.meta = {};
  }
}

// One dictation = from "Streaming stop timing" to its "Paste timing".
const rows = [];
let row = null;
for (const e of entries) {
  const m = e.meta;
  if (e.message === "Streaming stop timing")
    row = { time: e.time.slice(11, 19), seconds: m.durationSeconds, stopMs: m.totalStopMs };
  if (!row) continue;
  if (e.message === "CHATGPT_PLAN_SOCKET") Object.assign(row, { lunaMs: m.socketMs, warm: m.warm });
  if (e.message === "ChatGPT socket failed, using HTTP")
    Object.assign(row, { socketFailedMs: m.socketMs });
  if (e.message === "CHATGPT_PLAN_SUCCESS") row.cleanupMs = m.processingTimeMs;
  if (e.message === "Streaming total processing") row.toPasteMs = m.totalProcessingMs;
  if (e.message === "Paste steps timing")
    Object.assign(row, { focusCheckMs: m.focusCheckMs, pasteHelperMs: m.pasteHelperMs });
  if (e.message === "Paste timing") {
    Object.assign(row, { pasteMs: m.pasteMs, pasted: m.success });
    rows.push(row);
    row = null;
  }
}
console.log(path.basename(file));
console.table(rows);
