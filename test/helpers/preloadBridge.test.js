const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPreloadApi() {
  let exposedApi;
  const listeners = new Map();
  const invocations = [];
  const sends = [];
  const ipcRenderer = {
    invoke: async (...args) => {
      invocations.push(args);
      return undefined;
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    send: (...args) => sends.push(args),
    sendSync: () => undefined,
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld: (_name, api) => {
        exposedApi = api;
      },
    },
    ipcRenderer,
    webUtils: {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8");
  vm.runInNewContext(source, {
    require: (specifier) => {
      if (specifier === "electron") return electron;
      throw new Error(`Unexpected preload dependency: ${specifier}`);
    },
    process,
  });
  return { api: exposedApi, invocations, listeners, sends };
}

test("assistant busy state is forwarded to the main-process hotkey guard", async () => {
  const { api, invocations } = loadPreloadApi();

  await api.setAssistantPanelBusy(true);

  assert.deepEqual(invocations, [["set-assistant-panel-busy", true]]);
});

test("dictation lifecycle and audio levels preserve companion routing metadata", () => {
  const { api, sends } = loadPreloadApi();

  api.dictationLifecycleStateChanged("recording", "assistant");
  api.dictationAudioLevelChanged(0.42);

  assert.deepEqual(sends, [
    ["dictation-lifecycle-state-changed", "recording", "assistant"],
    ["dictation-audio-level-changed", 0.42],
  ]);
});

test("the Agent companion owns only its scoped window bridges", async () => {
  const { api, invocations, sends } = loadPreloadApi();

  await api.resizeAgentDictationPillToContent(240);
  await api.resizeAgentDictationPillToContent(null);
  await api.setAgentDictationPillInteractivity(true);
  await api.cancelAgentPanelDictation();
  api.showAgentDictationFinalTranscript("recovered text");

  assert.deepEqual(invocations, [
    ["resize-agent-dictation-pill-to-content", 240],
    ["resize-agent-dictation-pill-to-content", null],
    ["set-agent-dictation-pill-interactivity", true],
    ["cancel-agent-panel-dictation"],
  ]);
  assert.deepEqual(
    sends.filter(([channel]) => channel === "show-agent-dictation-final-transcript"),
    [["show-agent-dictation-final-transcript", "recovered text"]]
  );
});

test("enterprise reasoning cancellation is forwarded to the main process", () => {
  const { api, sends } = loadPreloadApi();

  api.cancelEnterpriseReasoning();

  assert.deepEqual(sends, [["enterprise-reasoning-cancel"]]);
});

test("prepare-dictation forwards the input kind without the Electron event", () => {
  const { api, listeners } = loadPreloadApi();
  const received = [];
  const dispose = api.onPrepareDictation((options) => received.push(options));

  listeners.get("prepare-dictation")?.({ senderId: 1 }, { inputKind: "assistant" });

  dispose();
  assert.deepEqual(received, [{ inputKind: "assistant" }]);
  assert.equal(listeners.has("prepare-dictation"), false);
});
