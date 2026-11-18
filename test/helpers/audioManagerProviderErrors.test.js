const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// processWithOpenAIAPI classifies Mistral transcription failures from the
// { error } fields main serialises for the proxied request.
async function loadManager(t, settings, window = {}) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "only-whispers-provider-errors-test-",
    settingsKey: "__providerErrorsSettings",
    settings: { useLocalWhisper: false, allowLocalFallback: false, ...settings },
  });
  Object.assign(loaded.window.electronAPI, window);
  return loaded.createManager({
    isProcessing: true,
    getEffectiveSttLanguage: () => "auto",
    getAPIKey: async () => "test-key",
    getWhisperPrompt: () => null,
    getKeyterms: () => [],
    isDictionaryEcho: () => false,
    processTranscription: async (text) => text,
    isReasoningAvailable: async () => false,
  });
}

const recording = () => new Blob(["recording"], { type: "audio/webm" });

test("history pairs the first speech result with its own audio even if the next clip finishes", async (t) => {
  const pending = Promise.withResolvers();
  let rowOptions, savedAudio;
  const manager = await loadManager(
    t,
    { dataRetentionEnabled: true, audioRetentionDays: 7 },
    {
      proxyMistralTranscription: async () => ({
        text: "spoken words",
        source: "parakeet",
        model: "local",
        modelRevision: "revision",
      }),
      saveTranscription: (_text, _rawText, options) => {
        rowOptions = options;
        return pending.promise;
      },
      saveTranscriptionAudio: (id, bytes, metadata) => {
        savedAudio = [id, new TextDecoder().decode(bytes), metadata];
      },
    }
  );
  manager.processTranscription = async () => "cleaned words";
  const clip = recording();
  manager.lastAudioBlob = clip;
  manager.lastAudioMetadata = { durationMs: 125 };
  const result = await manager.processWithOpenAIAPI(clip, {
    stopRequestedAt: performance.now() - 100,
  });
  const saving = manager.saveTranscription(result.text, result.rawText, { stt: result.stt });
  manager.lastAudioBlob = new Blob(["next clip"]);
  manager.lastAudioMetadata = { durationMs: 300 };
  pending.resolve({ id: 8 });
  await saving;

  assert.equal(rowOptions.stt, undefined, "the transcript row must wait for its audio");
  const baseline = savedAudio[2].stt;
  assert.equal(baseline.text, "spoken words");
  assert.equal(baseline.provider, "parakeet");
  assert.equal(baseline.model, "local@revision");
  assert.ok(baseline.latencyMs >= 100);
  assert.deepEqual(savedAudio, [8, "recording", { durationMs: 125, stt: baseline }]);
  assert.equal(await manager.lastAudioBlob.text(), "next clip");
});

test("a rate-limited warmup uses local speech until retry time and applies only to its own key", async (t) => {
  const retryAt = Date.now() + 60000;
  const manager = await loadManager(
    t,
    { mistralApiKey: "old-key" },
    {
      dictationRealtimeWarmup: async () => ({ success: false, retryAt }),
    }
  );
  manager.cacheMicrophoneDeviceId = async () => {};
  await manager.warmupStreamingConnection();
  assert.equal(manager.shouldUseStreaming(), false);

  t.mock.method(Date, "now", () => retryAt);
  assert.equal(manager.shouldUseStreaming(), true);
  manager.cacheMicrophoneDeviceId = async () => {
    globalThis.__providerErrorsSettings.mistralApiKey = "new-key";
  };
  manager.mistralRetryAt = 0;
  await manager.warmupStreamingConnection();
  assert.equal(manager.mistralRetryAt, 0);
});

test("batch dictation reports only the current request's active provider", async (t) => {
  const updates = [];
  let cancelled = false;
  let listener;
  const manager = await loadManager(
    t,
    {},
    {
      onBatchDictationProvider: (callback) => {
        listener = callback;
        return () => {
          listener = null;
        };
      },
      proxyMistralTranscription: async ({ requestId }) => {
        listener("stale-request", "parakeet");
        listener(requestId, "mistral");
        listener(requestId, "parakeet");
        cancelled = true;
        listener(requestId, "mistral");
        return { text: "hello", source: "parakeet", model: "parakeet" };
      },
    }
  );
  manager.onSpeechProvider = (provider) => updates.push(provider);
  await manager.processWithOpenAIAPI(recording(), {}, () => cancelled);
  assert.deepEqual(updates, ["mistral", "parakeet"]);
  assert.equal(listener, null);
});

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected processWithOpenAIAPI to reject");
}

test("a proxied provider's net::ERR_* failure is classified with its display name", async (t) => {
  const manager = await loadManager(
    t,
    { cloudTranscriptionProvider: "mistral", cloudTranscriptionModel: "voxtral-mini-latest" },
    // What serializeIpcError returns for an unclassified net.fetch rejection.
    { proxyMistralTranscription: async () => ({ error: "net::ERR_INTERNET_DISCONNECTED" }) }
  );

  const error = await rejection(manager.processWithOpenAIAPI(recording()));

  assert.equal(error.code, "PROVIDER_UNREACHABLE");
  assert.equal(error.messageParams.provider, "Mistral");
  assert.equal(error.message, "Couldn't reach Mistral. Check your connection.");
});

test("a proxied provider's already-classified failure passes through unchanged", async (t) => {
  const manager = await loadManager(
    t,
    { cloudTranscriptionProvider: "mistral", cloudTranscriptionModel: "voxtral-mini-latest" },
    {
      proxyMistralTranscription: async () => ({
        error: "Mistral rejected your API key.",
        code: "PROVIDER_AUTH_FAILED",
        messageKey: "providerErrors.authFailed",
        messageParams: { provider: "Mistral" },
        settingsTarget: "speechToText",
        status: 401,
        surface: "transcription",
      }),
    }
  );

  const error = await rejection(manager.processWithOpenAIAPI(recording()));

  assert.equal(error.code, "PROVIDER_AUTH_FAILED");
  assert.equal(error.status, 401);
  assert.equal(error.settingsTarget, "speechToText");
});
