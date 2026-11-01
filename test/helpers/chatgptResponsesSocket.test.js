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
class FakeSocket extends EventEmitter {
  static OPEN = 1;
  constructor() {
    super();
    this.readyState = FakeSocket.OPEN;
    FakeSocket.sent = [];
    setImmediate(() => this.emit("open"));
  }
  send(json) {
    const body = JSON.parse(json);
    FakeSocket.sent.push(body);
    const id = `resp_${FakeSocket.sent.length}`;
    setImmediate(() => {
      if (body.generate !== false) {
        this.emit("message", JSON.stringify({ type: "response.output_text.delta", delta: "Hi." }));
      }
      this.emit("message", JSON.stringify({ type: "response.completed", response: { id } }));
    });
  }
  close() {}
}

// Loads a fresh socket module with ws, the auth and the logger stubbed.
function loadSocket() {
  delete require.cache[modulePath];
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

test("the cleanup after a prefill sends only the rest of the transcript", async () => {
  const socket = loadSocket();
  await socket.createResponse(cleanupBody("<transcript>\nfirst one</transcript>"), 1000);
  await socket.warmup();

  await socket.prefillTranscript("<transcript>\nhello there ");
  const result = await socket.createResponse(
    cleanupBody("<transcript>\nhello there world</transcript>"),
    1000
  );

  const [prefill, cleanup] = FakeSocket.sent.slice(-2);
  assert.equal(prefill.generate, false);
  assert.deepEqual(inputText(prefill), ["<transcript>\nhello there "]);
  assert.equal(cleanup.previous_response_id, `resp_${FakeSocket.sent.length - 1}`);
  assert.deepEqual(inputText(cleanup), ["world</transcript>"]);
  assert.equal(cleanup.instructions, "Clean up the transcript.");
  assert.equal(result.prefilled, true);
});

test("a final transcript that does not start with the prefill is sent whole", async () => {
  const socket = loadSocket();
  await socket.createResponse(cleanupBody("<transcript>\nfirst one</transcript>"), 1000);
  await socket.warmup();

  await socket.prefillTranscript("<transcript>\nhello there ");
  const result = await socket.createResponse(
    cleanupBody("<transcript>\nhello, there world</transcript>"),
    1000
  );

  const cleanup = FakeSocket.sent.at(-1);
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
  assert.equal(FakeSocket.sent.length, 0);
});
