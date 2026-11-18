const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// #2050: the dictation language must reach the Mistral session on every path
// the dictation-realtime-* handlers own, including a warm connection opened for
// a different language.

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const handlers = new Map();
const listeners = new Map();
const electronStub = {
  app: {
    getPath: () => "/tmp",
    getName: () => "test",
    getVersion: () => "0.0.0",
    isPackaged: false,
    on() {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, handler) => listeners.set(channel, handler),
    removeHandler() {},
  },
  net: { fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
  BrowserWindow: class {
    static getAllWindows() {
      return [];
    }
    static fromWebContents() {
      return null;
    }
  },
  shell: {},
  dialog: {},
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  session: { fromPartition: () => ({}) },
  clipboard: {},
  nativeImage: {},
  globalShortcut: {},
  utilityProcess: {},
  MessageChannelMain: class {},
};

const calls = { connects: [], disconnects: [], audio: [], sent: [], instances: [] };
let nextInstance = 0;

class FakeRealtimeStreaming {
  constructor() {
    this.id = ++nextInstance;
    this.isConnected = false;
    this.audioBytesSent = 0;
    this.options = null;
    calls.instances.push(this);
  }
  beginConnecting() {}
  async connect(options) {
    this.options = options;
    this.isConnected = true;
    calls.connects.push({ id: this.id, options });
  }
  async disconnect({ commit = true } = {}) {
    this.isConnected = false;
    calls.disconnects.push({ id: this.id, commit });
    return { text: "" };
  }
  sendAudio() {
    calls.audio.push(this.id);
    return true;
  }
}
Module._load = function loadWithMocks(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (parent?.filename === handlersModulePath) {
    if (request === "./debugLogger") return new Proxy({}, { get: () => () => {} });
    if (request === "./mistralRealtimeStreaming") {
      return {
        MistralRealtimeStreaming: FakeRealtimeStreaming,
        MISTRAL_REALTIME_MODEL: "voxtral-rt",
      };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => {
  Module._load = originalLoad;
});

function anything() {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === Symbol.toPrimitive || property === "toString") return () => "";
      if (property === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

let mistralKey;

function scenario(t) {
  mistralKey = "mistral-key";
  for (const record of Object.values(calls)) record.length = 0;
  // Seed the constructor's dictation fields: the proxy's catch-all would make
  // `this._dictationStreaming?.isConnected` truthy on a cold start.
  const target = {
    _dictationStreaming: null,
    _dictationConnectPromise: null,
    _dictationIdleTimer: null,
    environmentManager: { getMistralKey: () => mistralKey },
    windowManager: { hideTranscriptionPreview() {}, showTranscriptionPreview() {} },
  };
  const IPCHandlers = require(handlersModulePath);
  IPCHandlers.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (value, property) => (property in value ? value[property] : anything()),
    })
  );
  const event = { sender: { send: (channel, payload) => calls.sent.push({ channel, payload }) } };
  const invoke = (channel, options) => handlers.get(channel)(event, options);
  const sendAudio = () => listeners.get("dictation-realtime-send")(event, new Uint8Array(4));
  t.after(() => invoke("dictation-realtime-stop"));
  return { invoke, sendAudio };
}

const dictation = (overrides) => ({ language: "de", keyterms: ["Voxtral"], ...overrides });

test("a rate-limited warmup skips more connections until Mistral's retry time", async (t) => {
  const s = scenario(t);
  const retryAt = Date.now() + 60_000;
  const connect = t.mock.method(FakeRealtimeStreaming.prototype, "connect");
  connect.mock.mockImplementationOnce(async () => {
    throw Object.assign(new Error("Rate limited"), { retryAt });
  });
  const failed = await s.invoke("dictation-realtime-warmup", dictation());
  assert.equal(failed.retryAt, retryAt);
  assert.deepEqual(await s.invoke("dictation-realtime-start", dictation()), failed);
  assert.equal(connect.mock.callCount(), 1);
  t.mock.method(Date, "now", () => retryAt);
  assert.equal((await s.invoke("dictation-realtime-start", dictation())).success, true);
  assert.equal(connect.mock.callCount(), 2);
});

test("a cold start passes the key, model, language and word list to the Mistral session", async (t) => {
  const s = scenario(t);
  assert.deepEqual(await s.invoke("dictation-realtime-start", dictation()), { success: true });
  assert.equal(calls.connects.length, 1);
  assert.deepEqual(calls.connects[0].options, {
    apiKey: "mistral-key",
    model: "voxtral-rt",
    language: "de",
    keyterms: ["Voxtral"],
  });
});

test("a start without a saved Mistral key fails with NO_API", async (t) => {
  const s = scenario(t);
  mistralKey = "";
  const result = await s.invoke("dictation-realtime-start", dictation());
  assert.equal(result.success, false);
  assert.equal(result.code, "NO_API");
  assert.equal(calls.connects.length, 0);
});

test("a start reuses a warm connection opened for the same language and word list", async (t) => {
  const s = scenario(t);
  await s.invoke("dictation-realtime-warmup", dictation());
  await s.invoke("dictation-realtime-start", dictation());
  assert.equal(calls.connects.length, 1, "no redial");
  assert.deepEqual(calls.disconnects, []);
});

test("a start redials when the warm connection was opened for another language", async (t) => {
  const s = scenario(t);
  await s.invoke("dictation-realtime-warmup", dictation({ language: "de" }));
  await s.invoke("dictation-realtime-start", dictation({ language: undefined }));
  assert.equal(calls.connects.length, 2, "warm German session cannot serve an Auto dictation");
  assert.deepEqual(calls.disconnects, [{ id: calls.connects[0].id, commit: false }]);
  assert.equal("language" in calls.connects[1].options, true);
  assert.equal(calls.connects[1].options.language, undefined);
});

// The renderer streams worklet frames before dictation-realtime-start arrives,
// so a redial happens with audio already in flight. The retiring session is
// neither committed (its head would come back as a wrong-language final) nor
// waited on, so frames sent once the start is handled reach the new session.
test("frames sent once a mismatch redial starts buffer into the new session, not the retiring one", async (t) => {
  const s = scenario(t);
  await s.invoke("dictation-realtime-warmup", dictation({ language: "en" }));
  const started = s.invoke("dictation-realtime-start", dictation({ language: "de" }));
  s.sendAudio();
  await started;
  const [warm, fresh] = calls.instances;
  assert.deepEqual(calls.audio, [fresh.id]);
  assert.deepEqual(calls.disconnects, [{ id: warm.id, commit: false }]);
});

test("a retiring warm session's late events never reach the renderer", async (t) => {
  const s = scenario(t);
  await s.invoke("dictation-realtime-warmup", dictation({ language: "en" }));
  await s.invoke("dictation-realtime-start", dictation({ language: "de" }));
  const [warm] = calls.instances;
  warm.onPartialTranscript?.("hel");
  warm.onFinalTranscript?.("hello");
  warm.onError?.(new Error("closed"));
  warm.onSessionEnd?.({ text: "hello" });
  assert.deepEqual(calls.sent, []);
});

test("a start redials when the warm connection was opened for another word list", async (t) => {
  const s = scenario(t);
  await s.invoke("dictation-realtime-warmup", dictation({ keyterms: ["Voxtral"] }));
  await s.invoke("dictation-realtime-start", dictation({ keyterms: ["Voxtral", "Luna"] }));
  assert.equal(calls.connects.length, 2);
  assert.deepEqual(calls.connects[1].options.keyterms, ["Voxtral", "Luna"]);
});

test("after stop, the next start dials fresh", async (t) => {
  const s = scenario(t);
  await s.invoke("dictation-realtime-start", dictation());
  await s.invoke("dictation-realtime-stop");
  await s.invoke("dictation-realtime-start", dictation());
  assert.equal(calls.connects.length, 2);
});
