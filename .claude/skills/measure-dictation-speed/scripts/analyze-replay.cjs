// Pairs the runs of cleanup-replay.cjs by file and prints, for every mode against "base", the median
// difference (mode - base) of the time from release to the cleaned text.
// "did nothing" are the files where the mode did the same as base: their difference is the noise.
// Usage: node analyze-replay.cjs <results.jsonl> [more.jsonl ...]
const fs = require("fs");

const rows = process.argv
  .slice(2)
  .flatMap((file) => fs.readFileSync(file, "utf8").trim().split("\n"))
  .map((line) => JSON.parse(line))
  .filter((row) => !row.error);
const median = (values) => {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};
// Results from before the "changed" field: the early cleanup was the only change.
const changed = (row) => row.changed ?? row.earlySentMs != null;

const byFile = {};
for (const row of rows) (byFile[row.file] ??= {})[row.mode] = row;
const modes = [...new Set(rows.map((row) => row.mode))].filter((mode) => mode !== "base");
console.log(`${Object.keys(byFile).length} files, ${rows.length} runs`);

for (const mode of modes) {
  const pairs = Object.values(byFile).filter((pair) => pair[mode] && pair.base);
  const diff = (pair) => pair[mode].cleanedMs - pair.base.cleanedMs;
  console.log(`\n${mode} vs base (${pairs.length} pairs): median ${median(pairs.map(diff))} ms`);
  const groups = {
    "changed something": pairs.filter((pair) => changed(pair[mode])),
    "did nothing (noise)": pairs.filter((pair) => !changed(pair[mode])),
  };
  for (const [name, group] of Object.entries(groups)) {
    if (!group.length) continue;
    console.log(`  ${name} (${group.length}): median ${median(group.map(diff))} ms`);
  }
  for (const result of ["hit", "miss", "failed"]) {
    const group = pairs.filter((pair) => pair[mode].early === result);
    if (group.length) console.log(`  early ${result} (${group.length}): median ${median(group.map(diff))} ms`);
  }
  const row = (key) => median(pairs.map((pair) => pair[mode][key]));
  console.log(
    `  ${mode}: prefill wait ${row("prefillWaitMs")} ms, rest ${row("restChars")} chars,` +
      ` rolling prefills ${row("rollingPrefills")}`
  );
}

const base = Object.values(byFile)
  .map((pair) => pair.base)
  .filter(Boolean);
console.log(
  `\nbase: release -> cleaned ${median(base.map((r) => r.cleanedMs))} ms,` +
    ` Mistral ${median(base.map((r) => r.stopMs))} ms,` +
    ` prefill wait ${median(base.map((r) => r.prefillWaitMs))} ms,` +
    ` prefill ${median(base.map((r) => r.prefillMs))} ms, rest ${median(base.map((r) => r.restChars))} chars`
);
