const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;

// Captures every ipcMain.handle registration and every net.fetch request so the
// registered handler closures can be invoked directly against a fake `this`.
const handlers = new Map();
const fetches = [];
let fetchResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({ text: "transcribed" }),
  text: async () => JSON.stringify({ text: "transcribed" }),
});

const electronStub = {
  app: {
    getPath: () => "/tmp",
    getName: () => "test",
    getVersion: () => "0.0.0",
    isPackaged: false,
    on: () => {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  net: {
    fetch: async (url, init) => {
      fetches.push({ url: String(url), init });
      return fetchResponse(String(url), init);
    },
  },
  BrowserWindow: class BrowserWindow {
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
  session: {
    fromPartition: () => ({
      webRequest: { onBeforeSendHeaders: () => {} },
      fetch: (url, init) => electronStub.net.fetch(url, init),
      closeAllConnections: async () => {},
    }),
  },
  clipboard: {},
  nativeImage: {},
  globalShortcut: {},
  utilityProcess: {},
  MessageChannelMain: class {},
};

const textUpdates = [];
const statusUpdates = [];

Module._load = function loadWithMocks(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (parent?.filename === handlersModulePath) {
    if (request === "./windowBroadcast") {
      return { broadcastToWindows: () => {} };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

// A permissive `this` for setupHandlers: registration only stores closures, so
// any manager not exercised by the retry handler can be an inert stub.
function anything() {
  return new Proxy(function () {}, {
    get: (t, prop) => {
      if (prop === Symbol.toPrimitive || prop === "toString") return () => "";
      if (prop === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

function buildFakeThis() {
  const dbRows = new Map([[7, { id: 7, audio_duration_ms: 1200 }]]);
  const target = {
    sessionId: "test-session",
    audioStorageManager: {
      // 7 is a stored WebM recording.
      getAudioBuffer: (id) => (id === 7 ? Buffer.from([1, 2, 3]) : null),
    },
    databaseManager: {
      updateTranscriptionText: (id, text) => textUpdates.push({ id, text }),
      updateTranscriptionStatus: (id, status) => statusUpdates.push({ id, status }),
      updateTranscriptionAudio: () => {},
      getTranscriptionById: (id) => dbRows.get(id),
    },
    environmentManager: {
      getMistralKey: () => "mk-mistral",
    },
  };
  return new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : anything()),
  });
}

let retryHandler;
let fakeThis;
test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  fakeThis = buildFakeThis();
  Ctor.prototype.setupHandlers.call(fakeThis);
  retryHandler = handlers.get("retry-transcription");
  assert.ok(retryHandler, "retry-transcription must be registered");
});

test.after(() => {
  Module._load = originalLoad;
});

const invoke = (settings, id = 7) => retryHandler({ sender: {} }, id, settings);

test("retry: sends the stored audio to Mistral with x-api-key and saves the text", async () => {
  fetches.length = 0;
  textUpdates.length = 0;
  statusUpdates.length = 0;
  const result = await invoke({
    cloudTranscriptionModel: "voxtral-small-latest",
    preferredLanguage: "de-DE",
  });
  assert.equal(result.success, true);
  assert.match(fetches[0].url, /api.mistral.ai/);
  assert.equal(fetches[0].init.headers["x-api-key"], "mk-mistral");
  const body = fetches[0].init.body;
  assert.equal(body.get("model"), "voxtral-small-latest");
  assert.equal(body.get("language"), "en", "English whatever the saved language");
  assert.equal(body.get("file").name, "audio.webm");
  assert.deepEqual(textUpdates, [{ id: 7, text: "transcribed" }]);
  assert.deepEqual(statusUpdates, [{ id: 7, status: "completed" }]);
});

test("retry: a stale non-Voxtral model and auto language fall back to Voxtral and English", async () => {
  fetches.length = 0;
  const result = await invoke({ cloudTranscriptionModel: "whisper-1", preferredLanguage: "auto" });
  assert.equal(result.success, true);
  const body = fetches[0].init.body;
  assert.equal(body.get("model"), "voxtral-mini-transcribe-3-0");
  assert.equal(body.get("language"), "en");
});

test("retry: an empty answer from Mistral is no speech", async (t) => {
  const originalFetchResponse = fetchResponse;
  t.after(() => {
    fetchResponse = originalFetchResponse;
  });
  fetchResponse = () => ({ ok: true, status: 200, json: async () => ({ text: "" }) });
  textUpdates.length = 0;
  const result = await invoke({});
  assert.equal(result.success, false);
  assert.equal(result.code, "NO_SPEECH_DETECTED");
  assert.equal(result.messageKey, "notes.upload.noSpeechDetected");
  assert.equal(textUpdates.length, 0);
});

test("retry: a missing Mistral key is a classified error", async () => {
  fetches.length = 0;
  const originalGetMistralKey = fakeThis.environmentManager.getMistralKey;
  fakeThis.environmentManager.getMistralKey = () => "";
  try {
    const result = await invoke({});
    assert.equal(result.success, false);
    assert.equal(result.code, "API_KEY_MISSING");
    assert.equal(result.messageKey, "hooks.audioRecording.errorDescriptions.providerKeyMissing");
    assert.deepEqual(result.messageParams, { provider: "Mistral" });
    assert.equal(fetches.length, 0, "a missing key must fail before any request is sent");
  } finally {
    fakeThis.environmentManager.getMistralKey = originalGetMistralKey;
  }
});

test("proxy-mistral-transcription resolves to a structured error instead of rejecting", async (t) => {
  const originalFetchResponse = fetchResponse;
  t.after(() => {
    fetchResponse = originalFetchResponse;
  });
  fetchResponse = () => ({
    ok: false,
    status: 401,
    text: async () => "unauthorized",
    json: async () => ({}),
  });
  const fn = handlers.get("proxy-mistral-transcription");
  assert.ok(fn, "proxy-mistral-transcription must be registered");
  const result = await fn({ sender: {} }, { audioBuffer: new ArrayBuffer(4) });
  assert.equal(typeof result.error, "string");
});

const uploadTempFile = path.join(os.tmpdir(), "only-whispers-upload-handler-test.webm");

const invokeUpload = (payload) => {
  const uploadHandler = handlers.get("transcribe-audio-file-byok");
  assert.ok(uploadHandler, "transcribe-audio-file-byok must be registered");
  fs.writeFileSync(uploadTempFile, Buffer.from([1, 2, 3, 4]));
  return uploadHandler({ sender: {} }, { filePath: uploadTempFile, ...payload });
};

// Uploads are English only, like dictation.
test("upload: mistral sends x-api-key with a Voxtral model and English", async () => {
  fetches.length = 0;
  const result = await invokeUpload({ model: "gpt-4o-mini-transcribe" });
  assert.equal(result.success, true);
  assert.match(fetches[0].url, /api.mistral.ai/);
  assert.equal(fetches[0].init.headers["x-api-key"], "mk-mistral");
  assert.equal(fetches[0].init.headers.Authorization, undefined);
  const body = fetches[0].init.body.toString();
  assert.match(body, /voxtral-mini-transcribe-3-0/);
  assert.match(body, /name="language"\r\n\r\nen\r\n/);
});

// Electron's net.fetch rejects with a plain Error whose message is the Chromium
// net error and no code; both BYOK handlers must classify it before replying.
async function withFetchRejecting(message, run) {
  const originalFetchResponse = fetchResponse;
  fetchResponse = () => {
    throw new Error(message);
  };
  try {
    return await run();
  } finally {
    fetchResponse = originalFetchResponse;
  }
}

test("retry: a net::ERR_* failure from a BYOK provider is classified as unreachable", async () => {
  const result = await withFetchRejecting("net::ERR_INTERNET_DISCONNECTED", () => invoke({}));
  assert.equal(result.success, false);
  assert.equal(result.code, "PROVIDER_UNREACHABLE");
  assert.equal(result.messageKey, "providerErrors.unreachable");
  assert.equal(result.messageParams.provider, "Mistral");
  assert.equal(result.surface, "transcription");
});

test("retry: a cancelled request (net::ERR_ABORTED) is not classified", async () => {
  const result = await withFetchRejecting("net::ERR_ABORTED", () => invoke({}));
  assert.equal(result.success, false);
  assert.equal(result.messageKey, undefined);
  assert.equal(result.error, "net::ERR_ABORTED");
});

test("upload: a net::ERR_* failure from a BYOK provider is classified as unreachable", async () => {
  const result = await withFetchRejecting("net::ERR_NAME_NOT_RESOLVED", () =>
    invokeUpload({ model: "voxtral-mini-transcribe-3-0" })
  );
  assert.equal(result.success, false);
  assert.equal(result.code, "PROVIDER_UNREACHABLE");
  assert.equal(result.messageParams.provider, "Mistral");
  assert.equal(result.surface, "transcription");
  assert.equal(result.error, "Couldn't reach Mistral. Check your connection.");
});

test("upload: an HTTP failure logs its status and a redacted body", async (t) => {
  const debugLogger = require("../../src/helpers/debugLogger");
  const warnings = [];
  t.mock.method(debugLogger, "warn", (message, meta) => warnings.push({ message, meta }));
  const originalFetchResponse = fetchResponse;
  t.after(() => {
    fetchResponse = originalFetchResponse;
  });
  const body = '{"error":{"message":"Incorrect API key provided: sk-proj-leakedKey12345"}}';
  fetchResponse = () => ({
    ok: false,
    status: 401,
    headers: new Headers(),
    text: async () => body,
    json: async () => JSON.parse(body),
  });

  const result = await invokeUpload({ model: "voxtral-mini-transcribe-3-0" });

  assert.equal(result.code, "PROVIDER_AUTH_FAILED");
  const failure = warnings.find(({ message }) => message === "BYOK file transcription failed");
  assert.ok(failure, "the failure must be logged");
  assert.equal(failure.meta.status, 401);
  assert.match(failure.meta.body, /Incorrect API key provided/);
  assert.equal(failure.meta.body.includes("sk-proj-leakedKey12345"), false);
});
