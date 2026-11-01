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

// A socket runs one request at a time. The early cleanup gets its own socket, so
// a wrong guess never blocks the real request: response.cancel does nothing here.
const newLane = () => ({
  socket: null, // { ws, token, opened: Promise<void> }
  queue: Promise.resolve(),
  warm: null, // { key, id } from the generate:false warmup
  idleTimer: null,
});
const main = newLane();
const spare = newLane();

let lastPrompt = null; // model, instructions, reasoning and tier of the last cleanup
let warming = null;
let spareWarming = null;
let prefill = null; // { key, id, text, ms } from the generate:false prefill
let prefilling = null;
let early = null; // { key, userText, result } from the early cleanup
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
        if (event.type === "response.output_text.delta") text += event.delta || "";
        // With store:false the completed event has no text, so the deltas are the reply.
        if (event.type === "response.completed") finish(null, { id: event.response?.id, text });
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
  prefill = null;
  early = null;
  spareWarming = runWarmup(spare);
  warming = runWarmup(main);
  return warming;
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

// Called at key release with the start of the user message (the words Mistral
// has so far). Luna reads it with generate:false while Mistral finishes, so the
// cleanup request sends only the rest: its first token came about 150 ms sooner
// in tests. It replaces the warmup, since only the latest response can be continued.
function prefillTranscript(text) {
  prefilling = runPrefill(text);
  return prefilling;
}

async function runPrefill(text) {
  const current = dictation;
  const startedAt = Date.now();
  await warming;
  if (!lastPrompt || !text) return { success: false };
  const prompt = lastPrompt;
  main.warm = null;
  try {
    const result = await send(
      main,
      { ...prompt, store: false, input: [userMessage(text)], generate: false },
      PREFILL_TIMEOUT_MS
    );
    if (current === dictation) {
      prefill = { key: promptKey(prompt), id: result.id, text, ms: Date.now() - startedAt };
    }
    return { success: true };
  } catch (error) {
    debugLogger.debug("ChatGPT socket prefill failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

// Called after key release when the live text is likely complete (the lag rule in
// audioManager.js). Luna cleans it on the spare socket while Mistral finishes. The
// cleanup uses this answer only if its user message is exactly the same.
function sendEarly(userText) {
  if (!lastPrompt || !userText) return Promise.resolve({ success: false });
  const prompt = lastPrompt;
  const key = promptKey(prompt);
  const result = Promise.resolve(spareWarming).then(async () => {
    const previous = spare.warm?.key === key ? spare.warm.id : undefined;
    spare.warm = null;
    const reply = await send(
      spare,
      { ...prompt, store: false, input: [userMessage(userText)], previous_response_id: previous },
      EARLY_TIMEOUT_MS
    );
    return { ...reply, warm: !!previous };
  });
  early = { key, userText, result };
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

  // "hit": the early cleanup had this exact transcript, "miss": it did not.
  const guess = early;
  early = null;
  let earlyResult = "none";
  if (guess) earlyResult = guess.key === key && guess.userText === userText ? "hit" : "miss";
  if (earlyResult === "hit") {
    try {
      const result = await guess.result;
      if (result.text.trim()) {
        lastPrompt = prompt;
        return { text: result.text, warm: result.warm, prefilled: false, early: earlyResult };
      }
    } catch {}
    earlyResult = "failed";
  }

  // A warmup or prefill still in flight would leave an id that is no longer the latest response.
  // The wait is logged: it is what a prefill sent earlier could save.
  const waitStart = Date.now();
  await warming;
  await prefilling;
  const prefillWaitMs = Date.now() - waitStart;
  // The warm or prefilled response is reused only when the prompt is the same.
  // Instructions are not carried over by previous_response_id, so they are sent again.
  let request = body;
  let prefilled = false;
  const prefillMs = prefill?.ms;
  if (prefill?.key === key && userText.startsWith(prefill.text)) {
    request = {
      ...body,
      previous_response_id: prefill.id,
      input: [userMessage(userText.slice(prefill.text.length))],
    };
    prefilled = true;
  } else if (main.warm?.key === key) {
    request = { ...body, previous_response_id: main.warm.id };
  }
  main.warm = null;
  prefill = null;
  lastPrompt = prompt;
  const result = await send(main, request, timeoutMs);
  return {
    text: result.text,
    warm: !!request.previous_response_id,
    prefilled,
    early: earlyResult,
    prefillWaitMs,
    prefillMs: prefilled ? prefillMs : undefined,
    // How much of the transcript Luna still had to read.
    restChars: prefilled ? request.input[0].content[0].text.length : undefined,
  };
}

module.exports = { warmup, prefillTranscript, sendEarly, createResponse };
