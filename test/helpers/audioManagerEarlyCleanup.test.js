const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const RAW = "um so can you uh send me the report by friday";

// The main process uses the early answer only when its text is exactly the
// cleanup request's user message, so both must be built the same way.
test("cleanup guesses and rolling prefills", async (t) => {
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

  // The guess loop runs every 50 ms from the start of the recording, as in startStreamingRecording.
  const finalize = async (speechEndAt, stopMs = 0) => {
    const early = [];
    const prefills = [];
    window.electronAPI.chatgptSocketPrefill = async (text, options) => {
      prefills.push({ text, rolling: !!options?.rolling });
      return { success: true };
    };
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
      _cleanupGuess: { text: "", prefillWords: 0, prefilling: false, releasedAt: null },
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
    const loop = setInterval(() => manager._sendCleanupGuess(), 50);
    manager._sendCleanupGuess();
    await manager._finalizeStreamingRecording(null);
    clearInterval(loop);
    return { early, cleanupText, prefills };
  };

  await t.test("speech ended long before release: sent once, before release", async () => {
    const { early, cleanupText, prefills } = await finalize(performance.now() - 5000);
    assert.equal(early.length, 1);
    assert.equal(early[0], cleanupText);
    // The prefill at release: the live text without its last word, on every socket.
    assert.deepEqual(prefills, [
      { text: "<transcript>\num so can you uh send me the report by ", rolling: false },
    ]);
  });

  await t.test("speech ended just now: the final text comes first, nothing is sent", async () => {
    // The live text is kept until the stream is closed. Closing takes longer than
    // the 880 ms lag here, so a guess loop left running would send during it.
    const { early, cleanupText } = await finalize(performance.now(), 1100);
    assert.equal(early.length, 0);
    assert.ok(cleanupText.includes(RAW));
  });

  await t.test("rolling prefill: every 15 words while speaking, one at a time", async () => {
    const prefills = [];
    let finishPrefill;
    window.electronAPI.chatgptSocketPrefill = (text, options) => {
      prefills.push({ text, rolling: !!options?.rolling });
      return new Promise((resolve) => {
        finishPrefill = () => resolve({ success: true });
      });
    };
    const manager = Object.assign(Object.create(AudioManager.prototype), {
      streamingFinalText: "",
      streamingPartialText: "",
      _cleanupGuess: { text: "", prefillWords: 0, prefilling: false, releasedAt: null },
    });
    const speak = (words) => {
      manager.streamingPartialText = ` ${Array.from({ length: words }, (_, i) => `w${i}`).join(" ")}`;
      manager._rollCleanupPrefill();
    };

    speak(15); // 14 words before the last one
    assert.equal(prefills.length, 0);
    speak(16);
    assert.equal(prefills.length, 1);
    assert.equal(prefills[0].rolling, true);
    assert.ok(prefills[0].text.endsWith("w14 "));
    speak(40); // the first prefill is still running
    assert.equal(prefills.length, 1);
    finishPrefill();
    await new Promise((resolve) => setImmediate(resolve));
    speak(41);
    assert.equal(prefills.length, 2);
    finishPrefill();
    await new Promise((resolve) => setImmediate(resolve));
    manager._cleanupGuess.releasedAt = performance.now();
    speak(80); // after release, the prefill at release takes over
    assert.equal(prefills.length, 2);
  });
});
