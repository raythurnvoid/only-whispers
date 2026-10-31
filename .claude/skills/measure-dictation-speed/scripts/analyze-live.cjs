// Scores run-live.cjs results: speed and word errors per delay (against ./ref-real.json),
// and the "lag rule" for sending text to Luna early. Pass two result files from two
// passes to also see how often Mistral gave the same final twice.
// Usage: node analyze-live.cjs <results.jsonl> [more.jsonl ...] [--show-diffs]
//   --show-diffs prints the first words where delays disagree. That is the user's own
//   speech: read it here, never paste it into the repo, a commit or an issue.
const fs = require("fs");

const args = process.argv.slice(2);
const showDiffs = args.includes("--show-diffs");
const files = args.filter((a) => !a.startsWith("--"));
const ref = fs.existsSync("ref-real.json")
  ? JSON.parse(fs.readFileSync("ref-real.json", "utf8"))
  : {};
const load = (f) =>
  fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const passes = files.map(load);
const all = passes.flat();
const ok = all.filter((r) => !r.error);
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(p * (s.length - 1))] : null;
};
const words = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
function wordErrors(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return d[a.length][b.length];
}
// Lag rule: Mistral's text trails the audio by about the delay. After release, send once
// time >= local speech end + delay + M and no delta came for Q ms. Hit = text at that
// moment equals the final. Saving = done - send time, only on a hit.
function lagRule(r, M, Q) {
  const times = r.deltas.map((d) => d.t);
  let t = Math.max(r.releaseMs, r.speechEndMs + r.delay + M);
  let fire;
  for (;;) {
    const last = Math.max(0, ...times.filter((x) => x <= t));
    fire = Math.max(t, last + Q);
    const next = times.find((x) => x > last);
    if (next === undefined || next > fire) break;
    t = next;
  }
  if (fire >= r.doneAfterStartMs) return { fired: false };
  const hit = (r.deltas.filter((d) => d.t <= fire).at(-1)?.text ?? "").trim() === r.final;
  return { fired: true, hit, saved: hit ? r.doneAfterStartMs - fire : 0 };
}

const errors = all.filter((r) => r.error);
console.log(
  `runs ${all.length}, errors ${errors.length}`,
  errors.map((e) => `${e.case.join(" ")}: ${e.error.slice(0, 80)}`)
);
for (const delay of [...new Set(ok.map((r) => r.delay))].sort((a, b) => b - a)) {
  const set = ok.filter((r) => r.delay === delay);
  const fin = set.map((r) => r.finalizeMs);
  const windowMs = set.map((r) => r.doneAfterStartMs - (r.deltas.at(-1)?.t ?? r.doneAfterStartMs));
  console.log(`\n== delay ${delay} (n=${set.length}) ==`);
  console.log(
    `release -> done: median ${pct(fin, 0.5)}, p90 ${pct(fin, 0.9)}, max ${Math.max(...fin)} ms`
  );
  const withRef = set.filter((r) => typeof ref[r.file] === "string");
  if (withRef.length) {
    let we = 0,
      rw = 0,
      first3 = 0;
    for (const r of withRef) {
      const a = words(ref[r.file]),
        b = words(r.final);
      we += wordErrors(a, b);
      rw += a.length;
      if (a.slice(0, 3).join(" ") === b.slice(0, 3).join(" ")) first3++;
    }
    console.log(
      `word errors vs batch reference: ${we}/${rw} (${((100 * we) / rw).toFixed(1)}%), first 3 words right: ${first3}/${withRef.length}`
    );
  }
  console.log(
    `deltas equal final: ${set.filter((r) => r.deltasEqualFinal).length}/${set.length}, text complete at release: ${set.filter((r) => r.normAtRelease).length}/${set.length}`
  );
  console.log(`last delta -> done (most early send can save): median ${pct(windowMs, 0.5)} ms`);
  for (const M of [0, 200, 400]) {
    const res = set.map((r) => lagRule(r, M, 150));
    const fired = res.filter((x) => x.fired).length;
    const hits = res.filter((x) => x.hit).length;
    const saved = res.reduce((s, x) => s + (x.saved || 0), 0);
    console.log(
      `  lag rule M=${M} Q=150: sent early ${fired}/${set.length}, full text ${hits}/${fired} (${fired ? Math.round((100 * hits) / fired) : 0}%), mean saving per dictation ${Math.round(saved / set.length)} ms`
    );
  }
}
if (passes.length >= 2) {
  console.log("\nsame final in pass 1 and pass 2:");
  for (const delay of [...new Set(ok.map((r) => r.delay))]) {
    const a = passes[0].filter((r) => !r.error && r.delay === delay);
    const pairs = a
      .map((r) => [r, passes[1].find((s) => !s.error && s.file === r.file && s.delay === delay)])
      .filter(([, s]) => s);
    console.log(
      `  delay ${delay}: ${pairs.filter(([r, s]) => r.final === s.final).length}/${pairs.length}`
    );
  }
}
if (showDiffs) {
  const delays = [...new Set(ok.map((r) => r.delay))].sort((a, b) => b - a);
  for (const f of [...new Set(ok.map((r) => r.file))]) {
    const finals = delays.map((d) => ok.find((r) => r.file === f && r.delay === d)?.final ?? "");
    const heads = finals.map((t) => words(t).slice(0, 8).join(" "));
    if (new Set(heads.map((h) => h.split(" ").slice(0, 4).join(" "))).size > 1)
      console.log(
        `\n${f}\n  ref : ${words(ref[f] || "")
          .slice(0, 8)
          .join(" ")}\n${delays.map((d, i) => `  ${d}: ${heads[i]}`).join("\n")}`
      );
  }
}
