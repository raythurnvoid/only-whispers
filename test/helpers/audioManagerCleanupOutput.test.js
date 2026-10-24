const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const RAW = "um so can you uh send me the report by friday";
const CLEAN = "Can you send me the report by Friday?";
const DUPLICATE = `**Cleaned transcript:**\n${CLEAN}\n${CLEAN}`;
const MESSAGE_KEY = "hooks.audioRecording.errorDescriptions.cleanupDuplicated";

test("invalid completed cleanup keeps raw text across dictation routes", async (t) => {
  const { window } = installBrowserGlobals(t, { window: { dispatchEvent() {} } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-audio-cleanup-output-",
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
    dataRetentionEnabled: true,
  });
  window.electronAPI.proxyMistralTranscription = async () => ({ text: RAW });
  const createManager = () =>
    Object.assign(Object.create(AudioManager.prototype), {
      voiceAgentRequested: false,
      pendingCleanupFailure: null,
      getEffectiveSttLanguage: () => "en",
      getAPIKey: async () => "mk-mistral",
      getWhisperPrompt: () => null,
      isDictionaryEcho: () => false,
      isReasoningAvailable: async () => true,
      finalizeChineseScript: async (text) => text,
    });

  for (const route of ["batch", "streaming"]) {
    await t.test(
      `${route} cleanup snapshots its custom prompt and rejects duplicated output`,
      async () => {
        for (const customPrompt of ["", "Repeat twice"]) {
          useSettingsStore.setState({ customPrompts: { cleanup: customPrompt } });
          window.electronAPI.processLocalReasoning = async (text) => {
            assert.ok(text.includes(RAW));
            // A prompt edit mid-request must not change how this result is checked.
            useSettingsStore.setState({
              customPrompts: { cleanup: customPrompt ? "" : "Repeat twice" },
            });
            return { success: true, text: DUPLICATE };
          };
          const manager = createManager();
          let result;
          if (route === "batch") {
            result = await manager.processWithOpenAIAPI(new Blob(["synthetic audio"]));
            result = { ...result, ...manager._takePendingResultExtras() };
            assert.equal(result.rawText, RAW);
          } else {
            Object.assign(manager, {
              streamingFinalText: RAW,
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
              onTranscriptionComplete: (value) => {
                result = value;
              },
            });
            await manager._finalizeStreamingRecording(null);
            await new Promise(setImmediate);
            assert.equal(result.rawText, RAW);
          }
          assert.equal(result.text, customPrompt ? DUPLICATE : RAW);
          assert.equal(result.cleanupFailure?.messageKey, customPrompt ? undefined : MESSAGE_KEY);
        }
      }
    );
  }

  await t.test("local cleanup failure flows through raw fallback and persistence", async () => {
    useSettingsStore.setState({
      cleanupMode: "local",
      cleanupProvider: "local",
      cleanupModel: "test-model",
      customPrompts: { cleanup: "" },
    });
    window.electronAPI.processLocalReasoning = async () => ({ success: true, text: DUPLICATE });
    const manager = createManager();
    const result = await manager.processTranscriptionCore(RAW, "local");
    assert.equal(result, RAW);
    assert.equal(manager._takePendingResultExtras().cleanupFailure.messageKey, MESSAGE_KEY);
    let saved;
    window.electronAPI.saveTranscription = async (text, rawText) => {
      saved = { text, rawText };
      return { success: true };
    };
    await manager.saveTranscription(result, RAW);
    assert.deepEqual(saved, { text: RAW, rawText: RAW });
  });
});
