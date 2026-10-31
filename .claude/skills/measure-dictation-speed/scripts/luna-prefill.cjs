// Compares Luna cleanup on the ChatGPT plan socket:
//  full:    one request with the whole transcript (what the app does today)
//  prefill: generate:false with the first part while "speaking", then the rest + generate
// Measures time to first token and total time, and checks the answer kept part 1.
// Needs a fresh ChatGPT token: if it expired, dictate once in the app (never refresh here).
// Usage: node luna-prefill.cjs [rounds=4]
const path = require("path");
const { REPO, fromRepo, chatgpt } = require("./common.cjs");
const WebSocket = fromRepo("ws");
const prompts = require(path.join(REPO, "src/locales/en/prompts.json"));

const auth = chatgpt();
if (!(auth.expires > Date.now() + 60_000)) {
  console.error("ChatGPT token expired. Open the app and dictate once, then run again.");
  process.exit(1);
}
const rounds = Number(process.argv[2] || 4);
const PART1 =
  "so the plan for today is pretty simple first I want to finish the login page and fix the bug with the reset password email after that I will review the pull request from anna";
const PART2 =
  "and if everything looks good we can merge it before lunch in the afternoon I have a call with the design team about the new settings screen";
// Same wrapper as wrapCleanupTranscript (src/config/prompts/index.ts).
const TAIL = "\n</transcript>\n\nOutput only the cleaned transcript.";
const base = {
  model: "gpt-6-luna",
  instructions: prompts.cleanupPrompt,
  store: false,
  service_tier: "priority",
  reasoning: { effort: "none" },
};
const msg = (text) => ({ role: "user", content: [{ type: "input_text", text }] });

let ws;
function send(body) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let text = "";
    let first = null;
    const onMessage = (data) => {
      const e = JSON.parse(data.toString());
      if (e.type === "response.output_text.delta") {
        first ??= performance.now() - t0;
        text += e.delta || "";
      }
      if (e.type === "response.completed")
        done(null, { id: e.response?.id, text, firstMs: first, totalMs: performance.now() - t0 });
      if (["response.failed", "response.incomplete", "error"].includes(e.type))
        done(new Error(JSON.stringify(e.error ?? e.response?.error ?? e.type)));
    };
    const done = (err, res) => {
      ws.off("message", onMessage);
      err ? reject(err) : resolve(res);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "response.create", ...body }));
  });
}
const r = (n) => (n == null ? null : Math.round(n));

(async () => {
  ws = new WebSocket("wss://api.openai.com/v1/responses", {
    headers: { Authorization: `Bearer ${auth.access}` },
  });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("unexpected-response", (_q, s) => rej(new Error("HTTP " + s.statusCode)));
    ws.once("error", rej);
  });
  for (let i = 0; i < rounds; i++) {
    // Today: warm with the prompt only (as the app's warmup does), then the full transcript.
    const w = await send({ ...base, input: [], generate: false });
    await new Promise((res) => setTimeout(res, 1000));
    const full = await send({
      ...base,
      previous_response_id: w.id,
      input: [msg(`<transcript>\n${PART1} ${PART2}${TAIL}`)],
    });
    // Prefill: warm with the prompt and the first part, then send only the rest.
    const p = await send({ ...base, input: [msg(`<transcript>\n${PART1}`)], generate: false });
    await new Promise((res) => setTimeout(res, 1000));
    const pre = await send({
      ...base,
      previous_response_id: p.id,
      input: [msg(`${PART2}${TAIL}`)],
    });
    console.log(
      JSON.stringify({
        round: i + 1,
        full: { firstMs: r(full.firstMs), totalMs: r(full.totalMs) },
        prefill: {
          warmMs: r(p.totalMs),
          firstMs: r(pre.firstMs),
          totalMs: r(pre.totalMs),
          keptPart1: /login page/i.test(pre.text),
        },
      })
    );
    if (i === 0) console.log("FULL:", full.text, "\nPREFILL:", pre.text);
  }
  ws.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
