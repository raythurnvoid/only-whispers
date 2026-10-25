const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// #2581 through the Mistral batch path: the server recites the dictionary sent
// as context bias after the real speech, and the recited tail must not reach
// the saved transcript.
test("Mistral transcription drops a dictionary list recited after the speech", async (t) => {
  const { window, setSettings, createManager } = await loadAudioManager(t, {
    cachePrefix: "only-whispers-trailing-dictionary-echo-test-",
    settingsKey: "__trailingDictionaryEchoSettings",
  });
  const audioBlob = new Blob([new ArrayBuffer(8)], { type: "audio/webm" });
  const respondWith = (text) => {
    const payloads = [];
    window.electronAPI.proxyMistralTranscription = async (payload) => {
      payloads.push(payload);
      return { text };
    };
    return payloads;
  };
  // The dictionary is built by the real getCustomDictionaryPrompt/getWhisperPrompt
  // from these settings, snippet triggers included.
  const makeManager = (customDictionary, snippets = []) => {
    setSettings({ customDictionary, snippets });
    return createManager({
      getEffectiveSttLanguage: () => "auto",
      getAPIKey: async () => "mk-mistral",
      processTranscription: async (text) => text,
      isReasoningAvailable: async () => false,
    });
  };

  await t.test("the recited tail is removed from text and rawText", async () => {
    const payloads = respondWith(
      "Appreciate the time. Thanks, all. Thanks, you. only-whispers, n8n."
    );

    const result = await makeManager(["only-whispers", "n8n"]).processWithOpenAIAPI(audioBlob, {});

    assert.deepEqual(payloads[0].contextBias, ["only-whispers", "n8n"]);
    assert.equal(result.success, true);
    assert.equal(result.rawText, "Appreciate the time. Thanks, all. Thanks, you.");
    assert.equal(result.text, "Appreciate the time. Thanks, all. Thanks, you.");
  });

  await t.test("a whole-response echo is discarded", async () => {
    respondWith("only-whispers, n8n.");

    await assert.rejects(
      makeManager(["only-whispers", "n8n"]).processWithOpenAIAPI(audioBlob, {}),
      {
        code: "DICTIONARY_ECHO",
      }
    );
  });

  await t.test("a snippet trigger said as its own sentence is kept", async () => {
    respondWith("Text him. On my way, see you.");
    const manager = makeManager(
      ["only-whispers", "n8n"],
      [{ trigger: "on my way, see you", replacement: "On my way, see you soon!" }]
    );

    const result = await manager.processWithOpenAIAPI(audioBlob, {});

    assert.equal(result.rawText, "Text him. On my way, see you.");
  });

  await t.test("a request sent no dictionary keeps its whole transcript", async () => {
    const payloads = respondWith("Thanks, you. only-whispers, n8n.");

    const result = await makeManager([]).processWithOpenAIAPI(audioBlob, {});

    assert.equal(payloads[0].contextBias, undefined);
    assert.equal(result.rawText, "Thanks, you. only-whispers, n8n.");
  });
});
