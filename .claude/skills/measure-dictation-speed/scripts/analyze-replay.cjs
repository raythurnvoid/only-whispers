// Pairs the runs of early-cleanup-replay.cjs by file and prints the median difference
// (early - base) of the time from release to the cleaned text, per early-cleanup result.
// The "none" group did the same thing in both runs, so its difference is the noise.
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

const byFile = {};
for (const row of rows) (byFile[row.file] ??= {})[row.mode] = row;
const pairs = Object.values(byFile).filter((pair) => pair.early && pair.base);
const diff = (pair) => pair.early.cleanedMs - pair.base.cleanedMs;

console.log(`${pairs.length} pairs, ${rows.length} runs`);
console.log(`all: median early - base ${median(pairs.map(diff))} ms`);
for (const result of ["hit", "miss", "failed", "none"]) {
  const group = pairs.filter((pair) => pair.early.early === result);
  if (!group.length) continue;
  console.log(
    `${result} (${group.length}): median early - base ${median(group.map(diff))} ms,` +
      ` early sent ${median(group.map((p) => p.early.earlySentMs))} ms,` +
      ` Mistral done ${median(group.map((p) => p.early.stopMs))} ms after release`
  );
}
console.log(
  `base: release -> cleaned ${median(pairs.map((p) => p.base.cleanedMs))} ms,` +
    ` Luna after Mistral ${median(pairs.map((p) => p.base.cleanedMs - p.base.stopMs))} ms`
);
