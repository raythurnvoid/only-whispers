const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const RAW = "hey are you around this evening thinking coffee around six";

// Tone & Style classifies the dictation's app at recording start and the
// cleanup request carries the tone picked for that kind of app.
test("dictation cleanup carries the tone for the app it was captured in", async (t) => {
  const { window } = installBrowserGlobals(t, { window: { dispatchEvent() {} } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  t.after(() => delete navigator.onLine);
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-audio-tone-style-",
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
    cleanupModel: "gpt-test",
    useDictationAgent: false,
    customPrompts: { cleanup: "" },
    preferredLanguage: "en",
    dataRetentionEnabled: true,
    toneStyleEnabled: true,
    toneStyles: { personal: "very_casual", work: "casual", email: "excited", other: "formal" },
  });
  window.electronAPI.proxyMistralTranscription = async () => ({ text: RAW });
  let capturedCategory;
  window.electronAPI.captureDictationAppCategory = async () => capturedCategory;
  const reasonRequests = [];
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
      processWithReasoningModel: async (_text, _model, _agentName, config) => {
        reasonRequests.push(config.toneStyle ?? {});
        return "hey u around this evening? thinking coffee around 6 lmk";
      },
    });
  const lastRequest = () => reasonRequests[reasonRequests.length - 1];

  await t.test("batch cleanup sends the captured app's tone", async () => {
    capturedCategory = "personal";
    const manager = createManager();
    manager.beginToneStyleCapture();
    await manager.processWithOpenAIAPI(new Blob(["synthetic audio"]));
    assert.equal(lastRequest().tone, "very_casual");
    assert.equal(lastRequest().appCategory, "personal");
  });

  await t.test("streaming cleanup sends the captured app's tone", async () => {
    capturedCategory = "email";
    const manager = Object.assign(createManager(), {
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
      onTranscriptionComplete: () => {},
    });
    manager.beginToneStyleCapture();
    await manager._finalizeStreamingRecording(null);
    assert.equal(lastRequest().tone, "excited");
    assert.equal(lastRequest().appCategory, "email");
  });

  await t.test("an app the classifier can't place gets the other-apps tone", async () => {
    capturedCategory = null;
    const manager = createManager();
    manager.beginToneStyleCapture();
    await manager.processWithOpenAIAPI(new Blob(["synthetic audio"]));
    assert.equal(lastRequest().tone, "formal");
    assert.equal(lastRequest().appCategory, "other");
  });

  await t.test("no tone without a capture, or once Tone & Style is off", async () => {
    capturedCategory = "email";
    await createManager().processWithOpenAIAPI(new Blob(["synthetic audio"]));
    assert.equal("tone" in lastRequest(), false);

    const manager = createManager();
    manager.beginToneStyleCapture();
    useSettingsStore.setState({ toneStyleEnabled: false });
    await manager.processWithOpenAIAPI(new Blob(["synthetic audio"]));
    useSettingsStore.setState({ toneStyleEnabled: true });
    assert.equal("tone" in lastRequest(), false);
  });

  await t.test("an app classified after 1.5 s of speech still gets its tone", async (st) => {
    st.mock.timers.enable({ apis: ["setTimeout"] });
    let classify;
    capturedCategory = new Promise((resolve) => (classify = resolve));
    const manager = createManager();
    manager.beginToneStyleCapture();
    st.mock.timers.tick(1600);
    classify("email");
    assert.deepEqual(await manager.consumeToneStyle(), { appCategory: "email", tone: "excited" });
  });

  await t.test(
    "a cancelled transcription that still resolves leaves the next dictation's tone alone",
    async () => {
      capturedCategory = "work";
      const manager = createManager();
      // The next dictation started while the cancelled one's request was in flight.
      manager.beginToneStyleCapture();
      const requestsBefore = reasonRequests.length;
      await manager.processWithOpenAIAPI(new Blob(["synthetic audio"]), {}, () => true);
      assert.equal(reasonRequests.length, requestsBefore, "a cancelled dictation sends no cleanup");
      assert.deepEqual(await manager.consumeToneStyle(), { appCategory: "work", tone: "casual" });
    }
  );

  await t.test("a new recording drops the previous recording's capture", async () => {
    capturedCategory = "work";
    const manager = createManager();
    manager.beginToneStyleCapture();
    manager.setVoiceAgentRequested(false);
    assert.equal(await manager.consumeToneStyle(), null);
  });

  await t.test("local and BYOK cleanup get the tone through the reasoning config", async () => {
    capturedCategory = "email";
    const configs = [];
    const manager = createManager();
    manager.processWithReasoningModel = async (_text, _model, _agentName, config) => {
      configs.push(config);
      return "Thanks so much for today!";
    };
    manager.beginToneStyleCapture();
    await manager.processTranscription(RAW, "local");
    assert.deepEqual(configs[0].toneStyle, { appCategory: "email", tone: "excited" });
    assert.equal(configs[0].inferenceScope, "dictationCleanup");
  });
});
