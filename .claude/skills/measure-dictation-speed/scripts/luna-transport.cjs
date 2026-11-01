// Transport probes for an early send to Luna: which way can a second, early request go?
// Needs a fresh ChatGPT token: if it expired, dictate once in the app (never refresh here).
// Usage: node luna-transport.cjs
// 1. response.cancel: does it stop a running response, and can the next request start right away?
// 2. Warm socket: time to first token (x3).
// 3. Two sockets at once: does a second socket answer while the first one is busy?
// 4. HTTP: time to first token (1st call = new connection).
const path = require("path");
const { REPO, fromRepo, chatgpt } = require("./common.cjs");
const WebSocket = fromRepo("ws");
const prompts = require(path.join(REPO, "src/locales/en/prompts.json"));
const auth = chatgpt();
if (auth.expires - Date.now() < 60000) {
  console.error("ChatGPT token expired. Dictate once in the app, then run again.");
  process.exit(1);
}
const TEXT = "<transcript>\nso the plan for today is pretty simple first I want to finish the login page and fix the bug with the reset password email after that I will review the pull request from anna and if everything looks good we can merge it before lunch\n</transcript>\n\nOutput only the cleaned transcript.";
const body = { model: "gpt-6-luna", instructions: prompts.cleanupPrompt, store: false, service_tier: "priority", reasoning: { effort: "none" }, input: [{ role: "user", content: [{ type: "input_text", text: TEXT }] }] };
const r = Math.round;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function openWs() {
  const ws = new WebSocket("wss://api.openai.com/v1/responses", { headers: { Authorization: `Bearer ${auth.access}` } });
  await new Promise((res, rej) => (ws.once("open", res), ws.once("error", rej)));
  ws.events = [];
  ws.t0 = performance.now();
  ws.on("message", (d) => {
    const e = JSON.parse(d.toString());
    ws.events.push({ t: r(performance.now() - ws.t0), type: e.type, code: e.error?.code ?? e.response?.status, msg: (e.error?.message || "").slice(0, 160) });
  });
  return ws;
}

// Sends one request and resolves with its first-token and total times.
function run(ws, extra = {}) {
  ws.events = [];
  ws.t0 = performance.now();
  ws.send(JSON.stringify({ type: "response.create", ...body, ...extra }));
  return new Promise((res) => {
    const iv = setInterval(() => {
      const end = ws.events.find((e) => ["response.completed", "response.failed", "error"].includes(e.type));
      if (!end) return;
      clearInterval(iv);
      res({ firstMs: ws.events.find((e) => e.type === "response.output_text.delta")?.t, totalMs: end.t, end: `${end.type} ${end.code ?? ""} ${end.msg}`.trim() });
    }, 5);
  });
}

async function http() {
  const t0 = performance.now();
  const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.access}` }, body: JSON.stringify({ ...body, stream: true }) });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let first = null, buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    if (first == null && buf.includes("response.output_text.delta")) first = performance.now() - t0;
  }
  return { status: res.status, firstMs: r(first), totalMs: r(performance.now() - t0) };
}

(async () => {
  const ws = await openWs();
  console.log("warm-up:", await run(ws));

  // Probe 1: cancel 300 ms in, then send the next request right away.
  ws.events = []; ws.t0 = performance.now();
  ws.send(JSON.stringify({ type: "response.create", ...body }));
  await sleep(300);
  ws.send(JSON.stringify({ type: "response.cancel" }));
  await sleep(1500);
  const kinds = {};
  for (const e of ws.events) kinds[e.type] = (kinds[e.type] || 0) + 1;
  console.log("probe1 event counts:", kinds);
  console.log("probe1 non-delta events:", ws.events.filter((e) => !e.type.includes("delta")).map((e) => `${e.t}ms ${e.type} ${e.code ?? ""} ${e.msg}`));
  // Cancel, then a new request with no wait.
  ws.events = []; ws.t0 = performance.now();
  ws.send(JSON.stringify({ type: "response.create", ...body }));
  await sleep(300);
  ws.send(JSON.stringify({ type: "response.cancel" }));
  console.log("probe1 request right after cancel:", await run(ws));

  // Probe 2: warm socket x3.
  const sock = [];
  for (let i = 0; i < 3; i++) sock.push(await run(ws));
  console.log("probe2 socket:", sock.map((s) => `${s.firstMs}/${s.totalMs}`));

  // Probe 3: a second socket while the first is busy, x3.
  const ws2 = await openWs();
  await run(ws2);
  for (let i = 0; i < 3; i++) {
    const [a, b] = await Promise.all([run(ws), sleep(150).then(() => run(ws2))]);
    console.log(`probe3 parallel: socket1 ${a.firstMs}/${a.totalMs} (${a.end}), socket2 ${b.firstMs}/${b.totalMs} (${b.end})`);
  }
  ws.close(); ws2.close();

  // Probe 4: HTTP.
  const h = [];
  for (let i = 0; i < 4; i++) h.push(await http());
  console.log("probe4 http (1st = new connection):", h);
})().catch((e) => { console.error(e.message); process.exit(1); });
