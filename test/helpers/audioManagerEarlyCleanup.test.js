const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const RAW = "um so can you uh send me the report by friday";

// The main process uses the early answer only when its text is exactly the
// cleanup request's user message, so both must be built the same way.
test("early cleanup sends the cleanup's own user message, once the lag has passed", async (t) => {
  const { window } = installBrowserGlobals(t, { window: { dispatchEvent() {} } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-audio-early-cleanup-",
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
    cleanupMode: "providers",
    cleanupProvider: "openai",
    cleanupModel: "gpt-6-luna",
    useDictationAgent: false,
    customPrompts: { cleanup: "" },
    preferredLanguage: "en",
  });
  window.electronAPI.getChatGPTAccessToken = async () => "plan-token";
  window.electronAPI.chatgptSocketPrefill = async () => ({ success: true });

  const finalize = async (speechEndAt, stopMs = 0) => {
    const early = [];
    let cleanupText;
    window.electronAPI.chatgptSocketEarly = async (text) => {
      early.push(text);
      return { success: true };
    };
    window.electronAPI.chatgptSocketResponse = async (body) => {
      cleanupText = body.input[0].content[0].text;
      return { success: true, text: "Send me the report by Friday." };
    };
    const manager = Object.assign(Object.create(AudioManager.prototype), {
      voiceAgentRequested: false,
      pendingCleanupFailure: null,
      getEffectiveSttLanguage: () => "en",
      isDictionaryEcho: () => false,
      isReasoningAvailable: async () => true,
      finalizeChineseScript: async (text) => text,
      streamingFinalText: "",
      streamingPartialText: ` ${RAW}`,
      _streamingSpeechEndAt: speechEndAt,
      _streamingTextAt: 0,
      streamingCleanupFns: [],
      micRecovery: { stop() {} },
      finishStreamingFallbackSegment: async () => {},
      mergeRecordedSegments: async () => null,
      // Mistral's final text, trimmed as mistralRealtimeStreaming.js does.
      awaitStreamingTextSettled: async () => {
        manager.streamingFinalText = RAW;
      },
      getStreamingProvider: () => ({
        awaitsFinalTranscript: true,
        stop: async () => {
          await new Promise((resolve) => setTimeout(resolve, stopMs));
          return { success: true };
        },
      }),
      getStreamingProviderName: () => "mistral-realtime",
      shouldUseStreaming: () => false,
      onTranscriptionComplete: () => {},
    });
    await manager._finalizeStreamingRecording(null);
    return { early, cleanupText };
  };

  await t.test("speech ended long before release: sent at release", async () => {
    const { early, cleanupText } = await finalize(performance.now() - 5000);
    assert.equal(early.length, 1);
    assert.equal(early[0], cleanupText);
  });

  await t.test("speech ended just now: the final text comes first, nothing is sent", async () => {
    // The live text is kept until the stream is closed. Closing takes longer than
    // the 880 ms lag here, so a timer left running would send during it.
    const { early, cleanupText } = await finalize(performance.now(), 1100);
    assert.equal(early.length, 0);
    assert.ok(cleanupText.includes(RAW));
  });
});
