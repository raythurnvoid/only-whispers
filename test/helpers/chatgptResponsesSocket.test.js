const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const modulePath = require.resolve("../../src/helpers/chatgptResponsesSocket");
const originalLoad = Module._load;
test.afterEach(() => {
  Module._load = originalLoad;
});

// A socket that answers every response.create with a completed response "resp_<n>".
// Its answer names the socket, so a test can tell which socket answered.
class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  static count = 0;
  constructor() {
    super();
    this.readyState = FakeSocket.OPEN;
    this.index = FakeSocket.instances.push(this) - 1;
    this.sent = [];
    setImmediate(() => this.emit("open"));
  }
  send(json) {
    const body = JSON.parse(json);
    body.id = `resp_${++FakeSocket.count}`;
    this.sent.push(body);
    setImmediate(() => {
      if (body.generate !== false) {
        const delta = `Hi from socket ${this.index}.`;
        this.emit("message", JSON.stringify({ type: "response.output_text.delta", delta }));
      }
      this.emit(
        "message",
        JSON.stringify({ type: "response.completed", response: { id: body.id } })
      );
    });
  }
  close() {}
}

// Loads a fresh socket module with ws, the auth and the logger stubbed.
function loadSocket() {
  delete require.cache[modulePath];
  FakeSocket.instances = [];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (parent?.filename !== modulePath) return originalLoad.call(this, request, parent, isMain);
    if (request === "ws") return FakeSocket;
    if (request === "./chatgptAuth") return { getAccessToken: async () => "token" };
    if (request === "./debugLogger") return { debug() {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  return require(modulePath);
}

const cleanupBody = (text) => ({
  model: "gpt-6-luna",
  instructions: "Clean up the transcript.",
  store: false,
  service_tier: "priority",
  reasoning: { effort: "none" },
  input: [{ role: "user", content: [{ type: "input_text", text }] }],
});
const inputText = (body) => body.input.map((item) => item.content[0].text);

// One cleanup, so the next dictation has a prompt to warm, prefill and send early with.
async function afterFirstCleanup() {
  const socket = loadSocket();
  await socket.createResponse(cleanupBody("<transcript>\nfirst one</transcript>"), 1000);
  await socket.warmup();
  const [main, spare] = FakeSocket.instances;
  return { socket, main, spare };
}

test("the cleanup after a prefill sends only the rest of the transcript", async () => {
  const { socket, main } = await afterFirstCleanup();

  await socket.prefillTranscript("<transcript>\nhello there ");
  const result = await socket.createResponse(
    cleanupBody("<transcript>\nhello there world</transcript>"),
    1000
  );

  const [prefill, cleanup] = main.sent.slice(-2);
  assert.equal(prefill.generate, false);
  assert.deepEqual(inputText(prefill), ["<transcript>\nhello there "]);
  assert.equal(cleanup.previous_response_id, prefill.id);
  assert.deepEqual(inputText(cleanup), ["world</transcript>"]);
  assert.equal(cleanup.instructions, "Clean up the transcript.");
  assert.equal(result.prefilled, true);
  // Logged, to see how much an earlier prefill could save.
  assert.equal(result.restChars, "world</transcript>".length);
  assert.equal(typeof result.prefillMs, "number");
  assert.equal(typeof result.prefillWaitMs, "number");
});

test("a final transcript that does not start with the prefill is sent whole", async () => {
  const { socket, main } = await afterFirstCleanup();

  await socket.prefillTranscript("<transcript>\nhello there ");
  const result = await socket.createResponse(
    cleanupBody("<transcript>\nhello, there world</transcript>"),
    1000
  );

  const cleanup = main.sent.at(-1);
  // The prefill replaced the warmup, so nothing is continued.
  assert.equal(cleanup.previous_response_id, undefined);
  assert.deepEqual(inputText(cleanup), ["<transcript>\nhello, there world</transcript>"]);
  assert.equal(result.prefilled, false);
});

test("no prefill is sent before the first cleanup of the app session", async () => {
  const socket = loadSocket();
  await socket.warmup();

  const result = await socket.prefillTranscript("<transcript>\nhello ");

  assert.equal(result.success, false);
  assert.equal(FakeSocket.instances.flatMap((ws) => ws.sent).length, 0);
});

test("an early cleanup of the same transcript is used, on the spare socket", async () => {
  const { socket, main, spare } = await afterFirstCleanup();
  const text = "<transcript>\nhello there world</transcript>";
  const mainSent = main.sent.length;

  socket.sendEarly(text);
  const result = await socket.createResponse(cleanupBody(text), 1000);

  assert.equal(result.early, "hit");
  assert.equal(result.text, "Hi from socket 1.");
  const early = spare.sent.at(-1);
  assert.deepEqual(inputText(early), [text]);
  // It continues the spare socket's warmup.
  assert.equal(early.previous_response_id, spare.sent.at(-2).id);
  assert.equal(main.sent.length, mainSent);
});

test("an early cleanup of another transcript is not used", async () => {
  const { socket, main } = await afterFirstCleanup();

  socket.sendEarly("<transcript>\nhello there</transcript>");
  const result = await socket.createResponse(
    cleanupBody("<transcript>\nhello there world</transcript>"),
    1000
  );

  assert.equal(result.early, "miss");
  assert.equal(result.text, "Hi from socket 0.");
  assert.deepEqual(inputText(main.sent.at(-1)), ["<transcript>\nhello there world</transcript>"]);
});
