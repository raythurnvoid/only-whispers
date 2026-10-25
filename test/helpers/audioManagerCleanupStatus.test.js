const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const RAW = "um so can you uh send me the report by friday";

// The pill names the cleanup model only after the manager reports that
// cleanup started, so an empty transcript must never report it.
test("cleanup status is reported only when cleanup runs", async (t) => {
  const { window } = installBrowserGlobals(t, { window: { dispatchEvent() {} } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-audio-cleanup-status-",
    mockModules: {
      "/utils/logger":
        "export default { debug() {}, info() {}, warn() {}, error() {}, logReasoning() {} };",
    },
  });
  const AudioManager = (await vite.ssrLoadModule("/helpers/audioManager.js")).default;
  const service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => service.destroy());
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({
    useCleanupModel: true,
    cleanupMode: "local",
    cleanupProvider: "local",
    cleanupModel: "test-model",
    useDictationAgent: false,
    customPrompts: { cleanup: "" },
    preferredLanguage: "en",
  });
  window.electronAPI.processLocalReasoning = async () => ({ success: true, text: "Clean." });
  const createManager = (states) =>
    Object.assign(Object.create(AudioManager.prototype), {
      voiceAgentRequested: false,
      pendingCleanupFailure: null,
      getEffectiveSttLanguage: () => "en",
      isDictionaryEcho: () => false,
      isReasoningAvailable: async () => true,
      finalizeChineseScript: async (text) => text,
      onStateChange: (state) => states.push(state),
    });
  const cleanupReported = (states) => states.some((state) => state.isCleaningUp);

  for (const text of [RAW, ""]) {
    await t.test(`batch with ${text ? "text" : "an empty transcript"}`, async () => {
      const states = [];
      await createManager(states).processTranscriptionCore(text, "mistral");
      assert.equal(cleanupReported(states), Boolean(text));
    });

    await t.test(`streaming with ${text ? "text" : "an empty transcript"}`, async () => {
      const states = [];
      const manager = Object.assign(createManager(states), {
        streamingFinalText: text,
        streamingCleanupFns: [],
        micRecovery: { stop() {} },
        finishStreamingFallbackSegment: async () => {},
        mergeRecordedSegments: async () => null,
        awaitStreamingTextSettled: async () => {},
        getStreamingProvider: () => ({
          awaitsFinalTranscript: true,
          stop: async () => ({ success: true }),
        }),
        getStreamingProviderName: () => "mistral-realtime",
        shouldUseStreaming: () => false,
        onTranscriptionComplete: () => {},
      });
      await manager._finalizeStreamingRecording(null);
      assert.equal(cleanupReported(states), Boolean(text));
    });
  }
});
