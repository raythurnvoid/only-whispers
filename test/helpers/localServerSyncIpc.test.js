const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const handlers = new Map();
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "local-server-sync-ipc-"));

const MODEL = "qwen3.5-4b-q4_k_m";
const modelManager = {
  currentServerModelId: null,
  stops: 0,
  getServerStatus: () => ({ running: true }),
  stopServer: async () => {
    modelManager.stops += 1;
  },
  serverManager: {
    keepResident: null,
    setKeepResident: (keepResident) => {
      modelManager.serverManager.keepResident = keepResident;
    },
  },
};

const electronStub = {
  app: {
    getPath: () => userDataDirectory,
    getName: () => "test",
    getVersion: () => "0.0.0",
    isPackaged: false,
    on: () => {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: () => {},
    removeHandler: () => {},
  },
  net: { fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
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
  session: { fromPartition: () => ({}) },
  clipboard: {},
  nativeImage: {},
  globalShortcut: {},
  utilityProcess: {},
  MessageChannelMain: class {},
};

Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (parent?.filename === handlersModulePath && request === "./debugLogger") {
    return new Proxy({}, { get: () => () => {} });
  }
  if (parent?.filename === handlersModulePath && request === "./modelManagerBridge") {
    return { default: modelManager };
  }
  return originalLoad.call(this, request, parent, isMain);
};

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

let target;
test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  target = { envKeys: [] };
  target._syncStartupEnv = (setVars, clearVars) => {
    target.envKeys = [...Object.keys(setVars), ...clearVars];
  };
  Ctor.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (value, property) => (property in value ? value[property] : anything()),
    })
  );
  assert.ok(handlers.get("sync-startup-preferences"), "sync handler must be registered");
});

test.after(() => {
  Module._load = originalLoad;
  fs.rmSync(userDataDirectory, { recursive: true, force: true });
});

function sync({ loaded, ...scopes }) {
  modelManager.currentServerModelId = loaded;
  modelManager.stops = 0;
  return handlers.get("sync-startup-preferences")(
    {},
    {
      useLocalWhisper: false,
      useCleanupModel: true,
      cleanupMode: "providers",
      useDictationAgent: true,
      dictationAgentMode: "providers",
      chatAgentMode: "providers",
      ...scopes,
    }
  );
}

test("a window sync keeps the server while another scope still needs its model", async () => {
  await sync({ loaded: MODEL, chatAgentMode: "local", chatAgentModel: MODEL });
  assert.equal(modelManager.stops, 0);
});

test("a window sync stops the server once no scope needs its model", async () => {
  await sync({ loaded: MODEL, chatAgentMode: "local", chatAgentModel: "gemma-4-e2b" });
  assert.equal(modelManager.stops, 1);
});

test("Keep model loaded follows each window sync", async () => {
  await sync({ loaded: MODEL, keepLocalModelLoaded: true });
  assert.equal(modelManager.serverManager.keepResident, true);

  await sync({ loaded: MODEL });
  assert.equal(modelManager.serverManager.keepResident, false, "missing means off");
});
