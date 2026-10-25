const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { BYOK_API_KEYS } = require("../../src/config/secretKeys");

const bindings = [
  ...BYOK_API_KEYS.map((key) => ({ ...key, channel: `save-${key.base}-key` })),
  ...[
    ["corti-client-id", "cortiClientId", "saveCortiClientId"],
    ["corti-client-secret", "cortiClientSecret", "saveCortiClientSecret"],
    ["custom-transcription-key", "customTranscriptionApiKey", "saveCustomTranscriptionKey"],
  ].map(([channel, storeKey, save]) => ({
    channel: `save-${channel}`,
    storeKey,
    save,
    get: save.replace(/^save/, "get"),
  })),
];
const handlers = new Map();
const keys = new Map();
const notifications = [];
const editor = { id: 1 };
const windows = [1, 2, 3].map((id) => ({
  isDestroyed: () => id === 3,
  webContents: { id, send: (...args) => notifications.push([id, ...args]) },
}));
const environmentManager = Object.fromEntries(
  bindings.flatMap(({ get, save, storeKey }) => [
    [get, () => keys.get(storeKey) || ""],
    [
      save,
      (key) => {
        keys.set(storeKey, key);
        return { success: true };
      },
    ],
  ])
);

// The parts of the Mistral client the dictation handlers read.
class FakeStreaming {
  isConnected = false;
  audioBytesSent = 0;
  disconnects = 0;
  beginConnecting() {}
  async connect({ apiKey }) {
    this.token = apiKey;
    this.isConnected = true;
  }
  async disconnect() {
    this.disconnects += 1;
    this.isConnected = false;
    return { text: "" };
  }
}

const modulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const electron = {
  app: {
    getPath: () => "/tmp",
    getName: () => "test",
    getVersion: () => "0.0.0",
    on() {},
    isPackaged: false,
  },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {}, removeHandler() {} },
  BrowserWindow: {
    getAllWindows: () => windows,
    fromWebContents: () => windows[1],
  },
  shell: {},
  dialog: {},
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  session: { fromPartition: () => ({}) },
};
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electron;
  if (parent?.filename === modulePath) {
    if (request === "./mistralRealtimeStreaming")
      return { MistralRealtimeStreaming: FakeStreaming, MISTRAL_REALTIME_MODEL: "voxtral-rt" };
    if (request === "./debugLogger") return new Proxy({}, { get: () => () => {} });
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
const target = {
  environmentManager,
  _dictationStreaming: null,
  _dictationConnectPromise: null,
  _dictationIdleTimer: null,
};
test.before(() => {
  const IPCHandlers = require(modulePath);
  IPCHandlers.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (value, property) => (property in value ? value[property] : anything()),
    })
  );
});
const invoke = (channel, ...args) => handlers.get(channel)({ sender: editor }, ...args);

test("every secret saver notifies peers by name only, including removal", () => {
  for (const { channel, storeKey, get } of bindings) {
    for (const value of ["secret-sentinel", ""]) {
      notifications.length = 0;
      assert.deepEqual(invoke(channel, value), { success: true });
      assert.equal(environmentManager[get](), value);
      assert.deepEqual(notifications, [[2, "api-key-updated", storeKey]]);
      notifications.length = 0;
      assert.deepEqual(invoke(channel, value), { success: true });
      assert.deepEqual(notifications, [], `${storeKey} re-saved unchanged`);
    }
  }
  assert.throws(
    () => invoke("save-custom-transcription-key", { key: "secret-sentinel" }),
    TypeError
  );
});

const options = { language: "de", keyterms: [] };

test("mistral: a start rides the connection its warmup opened", async (t) => {
  t.after(() => invoke("dictation-realtime-stop"));
  invoke("save-mistral-key", "A");
  assert.deepEqual(await invoke("dictation-realtime-warmup", options), { success: true });
  const warmed = target._dictationStreaming;
  assert.equal((await invoke("dictation-realtime-start", options)).success, true);
  assert.equal(target._dictationStreaming, warmed);
  assert.equal(warmed.token, "A");
});

test("mistral: a key saved after the warmup reaches the next start", async (t) => {
  t.after(() => invoke("dictation-realtime-stop"));
  invoke("save-mistral-key", "A");
  await invoke("dictation-realtime-warmup", options);
  const warmed = target._dictationStreaming;
  invoke("save-mistral-key", "B");
  assert.equal((await invoke("dictation-realtime-start", options)).success, true);
  assert.notEqual(target._dictationStreaming, warmed);
  assert.equal(target._dictationStreaming.token, "B");
});

test("mistral: a key saved mid-session leaves the live session alone", async (t) => {
  t.after(() => invoke("dictation-realtime-stop"));
  invoke("save-mistral-key", "A");
  await invoke("dictation-realtime-warmup", options);
  await invoke("dictation-realtime-start", options);
  const live = target._dictationStreaming;
  invoke("save-mistral-key", "B");
  assert.equal(target._dictationStreaming, live);
  assert.equal(live.isConnected, true);
  assert.equal(live.disconnects, 0);
});
