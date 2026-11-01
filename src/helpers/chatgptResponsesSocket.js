const WebSocket = require("ws");
const debugLogger = require("./debugLogger");
const chatgptAuth = require("./chatgptAuth");

// Cleanup on the ChatGPT plan over the Responses API WebSocket mode. The socket
// is opened while the user speaks, so cleanup skips the ~1 s connect, and a
// generate:false request with the last prompt warms the server for it.
// The renderer cannot set the Authorization header on a WebSocket, so this
// runs in the main process. Any failure makes the renderer use HTTP instead.
const RESPONSES_URL = "wss://api.openai.com/v1/responses";
const OPEN_TIMEOUT_MS = 5000;
// The cleanup request waits for the prefill, which took 240-640 ms in tests.
const PREFILL_TIMEOUT_MS = 2000;
const EARLY_TIMEOUT_MS = 10000;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

// A socket runs one request at a time. Cleanup guesses (sendEarly) run on spare
// sockets, so a wrong guess never blocks the real request: response.cancel does
// nothing here. Each spare runs one guess at a time, so up to SPARE_LANES at once.
const SPARE_LANES = 3;
const newLane = () => ({
  socket: null, // { ws, token, opened: Promise<void> }
  queue: Promise.resolve(),
  warm: null, // { key, id } from the generate:false warmup
  warming: null,
  prefill: null, // { key, id, text, ms } from the generate:false prefill
  prefilling: null,
  guessing: false, // a cleanup guess runs on it (spare lanes only)
  idleTimer: null,
});
const main = newLane();
const spares = Array.from({ length: SPARE_LANES }, newLane);

let lastPrompt = null; // model, instructions, reasoning and tier of the last cleanup
let guesses = []; // { key, userText, result } from this dictation's cleanup guesses
// Counts dictations, so a prefill that ends after the next dictation started is dropped.
let dictation = 0;

const promptKey = (prompt) => JSON.stringify(prompt);
const userMessage = (text) => ({ role: "user", content: [{ type: "input_text", text }] });

function openSocket(lane, token) {
  if (lane.socket?.token === token && lane.socket.ws.readyState <= WebSocket.OPEN) {
    return lane.socket;
  }
  closeSocket(lane);
  const ws = new WebSocket(RESPONSES_URL, { headers: { Authorization: `Bearer ${token}` } });
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("ChatGPT socket open timeout")),
      OPEN_TIMEOUT_MS
    );
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`ChatGPT socket refused (HTTP ${res.statusCode})`));
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  opened.catch(() => {
    if (lane.socket?.ws === ws) closeSocket(lane);
  });
  ws.on("error", () => {});
  ws.on("close", () => {
    if (lane.socket?.ws === ws) {
      lane.socket = null;
      lane.warm = null;
    }
  });
  lane.socket = { ws, token, opened };
  return lane.socket;
}

function closeSocket(lane) {
  if (!lane.socket) return;
  try {
    lane.socket.ws.close();
  } catch {}
  lane.socket = null;
  lane.warm = null;
}

function touchIdleTimer(lane) {
  clearTimeout(lane.idleTimer);
  lane.idleTimer = setTimeout(() => closeSocket(lane), IDLE_CLOSE_MS);
}

// Sends one response.create and collects its text deltas. Requests run one at
// a time, so every event on the socket belongs to the current request.
function send(lane, body, timeoutMs) {
  const run = async () => {
    const token = await chatgptAuth.getAccessToken();
    if (!token) throw new Error("Not signed in with ChatGPT");
    const current = openSocket(lane, token);
    await current.opened;
    touchIdleTimer(lane);
    const ws = current.ws;
    return new Promise((resolve, reject) => {
      let text = "";
      let firstTokenMs;
      const finish = (error, result) => {
        clearTimeout(timer);
        ws.off("message", onMessage);
        ws.off("close", onClose);
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        // A late reply would mix into the next request, so drop the socket.
        if (lane.socket?.ws === ws) closeSocket(lane);
        finish(new Error("ChatGPT socket response timeout"));
      }, timeoutMs);
      const onClose = () => finish(new Error("ChatGPT socket closed"));
      const onMessage = (data) => {
        let event;
        try {
          event = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (event.type === "response.output_text.delta") {
          // Logged: the time before the first token is Luna reading, the rest is writing.
          firstTokenMs ??= Date.now() - sentAt;
          text += event.delta || "";
        }
        // With store:false the completed event has no text, so the deltas are the reply.
        if (event.type === "response.completed") {
          finish(null, { id: event.response?.id, text, firstTokenMs });
        }
        if (["response.failed", "response.incomplete", "error"].includes(event.type)) {
          const error = event.response?.error ?? event.error ?? {};
          finish(
            new Error(
              `ChatGPT socket error: ${error.code ?? event.type} ${error.message ?? ""}`.trim()
            )
          );
        }
      };
      ws.on("message", onMessage);
      ws.on("close", onClose);
      const sentAt = Date.now();
      ws.send(JSON.stringify({ type: "response.create", ...body }));
    });
  };
  const result = lane.queue.then(run, run);
  lane.queue = result.catch(() => {});
  return result;
}

// Called at dictation start. Without a cleanup in this app session it only opens the sockets.
function warmup() {
  dictation += 1;
  guesses = [];
  for (const lane of [main, ...spares]) {
    lane.prefill = null;
    lane.warming = runWarmup(lane);
  }
  return main.warming;
}

async function runWarmup(lane) {
  try {
    if (!lastPrompt) {
      const token = await chatgptAuth.getAccessToken();
      if (!token) return { success: false };
      await openSocket(lane, token).opened;
      touchIdleTimer(lane);
      return { success: true };
    }
    const prompt = lastPrompt;
    const result = await send(
      lane,
      { ...prompt, store: false, input: [], generate: false },
      OPEN_TIMEOUT_MS
    );
    lane.warm = { key: promptKey(prompt), id: result.id };
    return { success: true };
  } catch (error) {
    debugLogger.debug("ChatGPT socket warmup failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

// Called with the start of the user message (the words Mistral has so far): at
// key release, and while the user speaks (`rolling`). Luna reads it with
// generate:false, so a cleanup or a guess then sends only the rest. It replaces
// the warmup, since only the latest response can be continued. Rolling prefills
// skip the main socket: its prefill at release already ends before Mistral does.
function prefillTranscript(text, { rolling = false } = {}) {
  const lanes = spares.filter((lane) => !lane.guessing);
  if (!rolling) lanes.unshift(main);
  return Promise.all(
    lanes.map((lane) => {
      lane.prefilling = runPrefill(lane, text);
      return lane.prefilling;
    })
  ).then((results) => results[0] ?? { success: false });
}

async function runPrefill(lane, text) {
  const current = dictation;
  const startedAt = Date.now();
  await lane.warming;
  if (!lastPrompt || !text) return { success: false };
  const prompt = lastPrompt;
  lane.warm = null;
  try {
    const result = await send(
      lane,
      { ...prompt, store: false, input: [userMessage(text)], generate: false },
      PREFILL_TIMEOUT_MS
    );
    if (current === dictation) {
      lane.prefill = { key: promptKey(prompt), id: result.id, text, ms: Date.now() - startedAt };
    }
    return { success: true };
  } catch (error) {
    debugLogger.debug("ChatGPT socket prefill failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

// Continues the lane's prefill when the user message starts with its text, so
// only the rest is sent, or else its warmup. Either is used once.
// Instructions are not carried over by previous_response_id, so they are sent again.
function continueLane(lane, body, key, userText) {
  const { prefill, warm } = lane;
  lane.prefill = null;
  lane.warm = null;
  if (prefill?.key === key && userText.startsWith(prefill.text)) {
    const rest = userMessage(userText.slice(prefill.text.length));
    return {
      request: { ...body, previous_response_id: prefill.id, input: [rest] },
      prefilled: true,
      prefillMs: prefill.ms,
    };
  }
  if (warm?.key === key) {
    return { request: { ...body, previous_response_id: warm.id }, prefilled: false };
  }
  return { request: body, prefilled: false };
}

// A cleanup guess: called when the live text may be complete (the lag rule in
// audioManager.js), before or after key release, and again when the text changes.
// Luna cleans it on a free spare socket while Mistral finishes. The cleanup uses
// a guess only if its user message is exactly the same.
function sendEarly(userText) {
  if (!lastPrompt || !userText) return Promise.resolve({ success: false });
  const lane = spares.find((spare) => !spare.guessing);
  if (!lane) {
    debugLogger.debug("ChatGPT socket early cleanup skipped: every spare socket is busy");
    return Promise.resolve({ success: false, error: "No free socket" });
  }
  lane.guessing = true;
  const prompt = lastPrompt;
  const key = promptKey(prompt);
  const result = (async () => {
    await lane.warming;
    await lane.prefilling;
    const body = { ...prompt, store: false, input: [userMessage(userText)] };
    const { request, prefilled } = continueLane(lane, body, key, userText);
    const reply = await send(lane, request, EARLY_TIMEOUT_MS);
    return { ...reply, warm: !!request.previous_response_id, prefilled };
  })().finally(() => {
    lane.guessing = false;
  });
  guesses.push({ key, userText, result });
  return result.then(
    () => ({ success: true }),
    (error) => {
      debugLogger.debug("ChatGPT socket early cleanup failed", { error: error.message });
      return { success: false, error: error.message };
    }
  );
}

// body is the HTTP request body without `stream`.
async function createResponse(body, timeoutMs) {
  const prompt = {
    model: body.model,
    instructions: body.instructions,
    reasoning: body.reasoning,
    service_tier: body.service_tier,
  };
  const key = promptKey(prompt);
  const content = body.input?.length === 1 ? body.input[0].content : null;
  const userText = content?.length === 1 && content[0].type === "input_text" ? content[0].text : "";

  // "hit": a guess had this exact transcript (the first such guess is the furthest
  // along), "miss": none did.
  const sent = guesses;
  guesses = [];
  const guess = sent.find((item) => item.key === key && item.userText === userText);
  let earlyResult = sent.length ? "miss" : "none";
  if (guess) {
    try {
      const result = await guess.result;
      if (result.text.trim()) {
        lastPrompt = prompt;
        return {
          text: result.text,
          warm: result.warm,
          prefilled: result.prefilled,
          early: "hit",
          guesses: sent.length,
          firstTokenMs: result.firstTokenMs,
        };
      }
    } catch {}
    earlyResult = "failed";
  }

  // A warmup or prefill still in flight would leave an id that is no longer the latest response.
  // The wait is logged: it is what a prefill sent earlier could save.
  const waitStart = Date.now();
  await main.warming;
  await main.prefilling;
  const prefillWaitMs = Date.now() - waitStart;
  // The warm or prefilled response is reused only when the prompt is the same.
  const { request, prefilled, prefillMs } = continueLane(main, body, key, userText);
  lastPrompt = prompt;
  const result = await send(main, request, timeoutMs);
  return {
    text: result.text,
    warm: !!request.previous_response_id,
    prefilled,
    early: earlyResult,
    guesses: sent.length,
    prefillWaitMs,
    prefillMs,
    // How much of the transcript Luna still had to read.
    restChars: prefilled ? request.input[0].content[0].text.length : undefined,
    firstTokenMs: result.firstTokenMs,
  };
}

module.exports = { warmup, prefillTranscript, sendEarly, createResponse };
