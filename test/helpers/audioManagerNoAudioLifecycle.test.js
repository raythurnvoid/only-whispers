const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

const LOCAL_WHISPER_SETTINGS = {
  cloudTranscriptionMode: "byok",
};

async function loadManagerClass(t, settings = LOCAL_WHISPER_SETTINGS) {
  const { AudioManager } = await loadAudioManager(t, {
    cachePrefix: "only-whispers-no-audio-lifecycle-test-",
    settingsKey: "__noAudioLifecycleSettings",
    settings,
  });
  return AudioManager;
}

function createManager(AudioManager, failure) {
  const order = [];
  const saved = [];
  const manager = Object.assign(Object.create(AudioManager.prototype), {
    isProcessing: true,
    _localSpeechGateState: null,
    pendingAssistantConversation: null,
    pendingSelectionEdit: null,
    lastAudioBlob: {},
    processWithOpenAIAPI: async () => {
      throw failure;
    },
    onStateChange: (state) => order.push(state.isProcessing ? "processing" : "idle"),
    onNoAudio: () => order.push("no-audio"),
    onError: () => order.push("error"),
    saveFailedTranscription: (message, code) => saved.push({ message, code }),
  });
  return { manager, order, saved };
}

test("silence becomes one no-audio outcome after processing is idle", async (t) => {
  const AudioManager = await loadManagerClass(t);
  const { manager, order, saved } = createManager(AudioManager, new Error("No audio detected"));

  await manager.processAudio({ size: 256, type: "audio/webm" });

  assert.equal(manager.isProcessing, false);
  assert.deepEqual(order, ["idle", "no-audio"]);
  assert.deepEqual(saved, []);
});

test("dictionary-echo silence keeps the recording but shares the settled outcome", async (t) => {
  const AudioManager = await loadManagerClass(t);
  const { DICTIONARY_ECHO_CODE } = await import("../../src/utils/dictionaryEchoFilter.js");
  const failure = new Error("No audio detected");
  failure.code = DICTIONARY_ECHO_CODE;
  const { manager, order, saved } = createManager(AudioManager, failure);

  await manager.processAudio({ size: 256, type: "audio/webm" });

  assert.deepEqual(order, ["idle", "no-audio"]);
  assert.deepEqual(saved, [{ message: "No audio detected", code: DICTIONARY_ECHO_CODE }]);
});

test("A provider finding no speech is the no-audio outcome and keeps the recording", async (t) => {
  const AudioManager = await loadManagerClass(t, {
    useLocalWhisper: false,
    cloudTranscriptionMode: "byok",
  });
  // cloud-transcribe's shape for the API's 422 (ipcHandlers.js).
  const failure = Object.assign(new Error("No speech detected in audio"), {
    code: "NO_SPEECH_DETECTED",
  });
  const { manager, order, saved } = createManager(AudioManager, failure);

  await manager.processAudio({ size: 256, type: "audio/webm" });

  assert.deepEqual(order, ["idle", "no-audio"]);
  assert.deepEqual(saved, [{ message: "No speech detected in audio", code: "NO_SPEECH_DETECTED" }]);
});

test("an empty model result is paired with its audio, but a broken response has no prediction", async (t) => {
  const { window, createManager } = await loadAudioManager(t, {
    cachePrefix: "only-whispers-empty-model-result-",
    settingsKey: "__noAudioLifecycleSettings",
    settings: { dataRetentionEnabled: true, audioRetentionDays: 7 },
  });
  const clip = new Blob(["recording"]);
  const saved = [];
  let prediction = { source: "parakeet", model: "local", modelRevision: "rev", text: "" };
  Object.assign(window.electronAPI, {
    proxyMistralTranscription: async () => prediction,
    saveTranscription: async () => ({ id: 1 }),
    saveTranscriptionAudio: async (_id, bytes, metadata) =>
      saved.push({ audio: new TextDecoder().decode(bytes), stt: metadata.stt }),
  });
  const manager = createManager({
    getEffectiveSttLanguage: () => "en",
    getWhisperPrompt: () => null,
  });
  for (const response of [prediction, { ...prediction, text: undefined }]) {
    prediction = response;
    manager.isProcessing = true;
    manager.lastAudioBlob = clip;
    const pipeline = manager._startProcessingPipeline();
    await manager.processAudio(clip, { stopRequestedAt: performance.now() - 20 }, pipeline);
    await pipeline.resultHandled;
  }
  assert.equal(saved[0].audio, "recording");
  assert.equal(saved[0].stt?.text, "");
  assert.equal(saved[0].stt.provider, "parakeet");
  assert.equal(saved[0].stt.model, "local@rev");
  assert.ok(saved[0].stt.latencyMs >= 20);
  assert.equal(saved[1].stt, undefined);
});
