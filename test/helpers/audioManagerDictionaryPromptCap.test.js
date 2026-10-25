const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// A ~100-term custom dictionary joined the way getCustomDictionaryPrompt does.
function buildLongDictionaryPrompt(count = 100) {
  const words = [];
  for (let i = 0; i < count; i++) {
    words.push(`SpecializedTerm${String(i).padStart(3, "0")}`);
  }
  return words.join(", ");
}

test("the dictionary reaches Mistral as at most 100 context-bias words, head first", async (t) => {
  const { window, createManager } = await loadAudioManager(t, {
    cachePrefix: "only-whispers-dictionary-prompt-cap-test-",
    settingsKey: "__dictionaryPromptCapSettings",
    settings: {},
  });
  const payloads = [];
  window.electronAPI.proxyMistralTranscription = async (payload) => {
    payloads.push(payload);
    return { text: "transcribed text" };
  };
  const hugePrompt = buildLongDictionaryPrompt(150);
  const manager = createManager({
    getEffectiveSttLanguage: () => "auto",
    getAPIKey: async () => "mk-mistral",
    getWhisperPrompt: () => hugePrompt,
    isDictionaryEcho: () => false,
    processTranscription: async (text) => text,
    isReasoningAvailable: async () => false,
  });

  const result = await manager.processWithOpenAIAPI(new Blob([new ArrayBuffer(8)]), {});

  assert.equal(result.success, true);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].contextBias, hugePrompt.split(", ").slice(0, 100));
});
