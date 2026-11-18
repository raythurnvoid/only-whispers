const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const localResult = { text: "raw words", source: "parakeet", model: "model", modelRevision: "rev" };
const header = new Blob(["opening ".repeat(60)]);
const stream = { getTracks: () => [] };

function installMediaRecorder(t) {
  const previous = globalThis.MediaRecorder;
  globalThis.MediaRecorder = class {
    start() {}
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = previous;
  });
}

async function setup(t) {
  const { window, createManager } = await loadAudioManager(t, {
    cachePrefix: "only-whispers-live-local-test-",
    settingsKey: "__liveLocalSettings",
    settings: { customDictionary: [] },
  });
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const writes = [],
    batches = [],
    cancels = [],
    results = [];
  const api = Object.assign(window.electronAPI, {
    warmLocalModel: async () => true,
    writeLocalRecordingChunk: async (id, bytes) => {
      writes.push([id, new TextDecoder().decode(bytes)]);
      return true;
    },
    finishLocalRecording: async () => localResult,
    cancelLocalRecording: async (id) => {
      cancels.push(id);
    },
    proxyMistralTranscription: async (payload) => {
      batches.push(new TextDecoder().decode(payload.audioBuffer));
      return { ...localResult, text: "batch words" };
    },
  });
  const manager = createManager({
    isRecording: true,
    recordingStartTime: now,
    _batchSegments: [],
    micRecovery: { stop() {} },
    cleanupPreview() {},
    _markCaptureStreamReleased() {},
    getEffectiveSttLanguage: () => "en",
    getWhisperPrompt: () => "",
    processTranscription: async (text) => "cleaned " + text,
    isReasoningAvailable: async () => true,
    onTranscriptionComplete: (result) => results.push(result),
  });
  const recorder = manager.createBatchRecorder(stream, {
    recorder: { mimeType: "audio/webm;codecs=opus" },
    chunks: [header],
  });
  manager.warmLocalRecording();
  await tick();
  return {
    manager,
    api,
    writes,
    batches,
    cancels,
    results,
    recorder,
    advance: (ms) => {
      now += ms;
    },
    add: (text) => recorder.ondataavailable({ data: new Blob([text]) }),
  };
}

test("a long local recording uses the same pre-roll and chunks for recognition and history", async (t) => {
  const { manager, api, recorder, advance, add, writes, batches, results } = await setup(t);
  add("early");
  assert.equal(writes.length, 0);
  advance(24000);
  add("middle");
  await tick();
  assert.equal(writes.length, 1, "the first write starts before release");
  assert.equal(writes[0][0], 1);
  advance(-1000); // The clock can move back while the microphone is still open.
  add("last");
  let finished;
  api.finishLocalRecording = async (id) => {
    finished = id;
    return localResult;
  };
  await recorder.onstop();
  const expected = (await header.text()) + "earlymiddlelast";
  assert.equal(writes.map(([, text]) => text).join(""), expected);
  assert.ok(writes.every(([id]) => id === finished));
  assert.equal(await manager.lastAudioBlob.text(), expected);
  assert.deepEqual(batches, []);
  assert.equal(results[0].rawText, "raw words");
  assert.equal(results[0].text, "cleaned raw words");
  assert.equal(results[0].stt.model, "model@rev");
});

test("a short recording runs once using the saved audio", async (t) => {
  const { recorder, add, writes, batches } = await setup(t);
  add("short");
  await recorder.onstop();
  assert.deepEqual(writes, []);
  assert.deepEqual(batches, [(await header.text()) + "short"]);
});

test("a refused live writer uses the complete saved audio", async (t) => {
  const { api, recorder, advance, add, batches, results, cancels } = await setup(t);
  advance(24000);
  api.writeLocalRecordingChunk = async () => false;
  add("later");
  await recorder.onstop();
  assert.equal(cancels.length, 1);
  assert.deepEqual(batches, [(await header.text()) + "later"]);
  assert.equal(results[0].rawText, "batch words");
});

test("a cancelled finish cannot deliver text or start another transcription", async (t) => {
  const { manager, api, recorder, advance, add, batches, results, cancels } = await setup(t);
  const started = Promise.withResolvers();
  const delayed = Promise.withResolvers();
  api.finishLocalRecording = (id) => {
    started.resolve(id);
    return delayed.promise;
  };
  advance(24000);
  add("last");
  const stopped = recorder.onstop();
  const id = await started.promise;
  manager.cancelProcessing();
  await stopped;
  delayed.resolve(localResult);
  await tick();
  assert.deepEqual(cancels, [id]);
  assert.deepEqual(results, []);
  assert.deepEqual(batches, []);
});

test("the recording silence gate discards live work before cleanup or paste", async (t) => {
  const { manager, api, recorder, advance, add, writes, batches, cancels, results } =
    await setup(t);
  let finishes = 0;
  api.finishLocalRecording = async () => {
    finishes++;
    return localResult;
  };
  advance(24000);
  add("silence");
  await tick();
  manager._localSpeechGateState = { windowCount: 20, peakRms: 0 };
  await recorder.onstop();
  assert.deepEqual(cancels, [writes[0][0]]);
  assert.equal(finishes, 0);
  assert.deepEqual(batches, []);
  assert.deepEqual(results, [{ success: true, text: "" }]);
});

test("switching microphones drops the live session and transcribes the merged file", async (t) => {
  const { manager, api, recorder, advance, add, writes, batches, cancels } = await setup(t);
  installMediaRecorder(t);
  api.mergeAudioSegments = async (parts) => ({
    success: true,
    buffer: await new Blob(parts.map((part) => part.buffer)).arrayBuffer(),
    mimeType: "audio/webm",
  });
  advance(24000);
  add("old mic");
  await tick();
  manager.micRecovery.started = true;
  manager.micRecovery.recover = async () => {};
  await recorder.onstop();
  await manager.replaceBatchMic(stream);
  const next = "new mic ".repeat(60);
  manager.mediaRecorder.ondataavailable({ data: new Blob([next]) });
  manager.micRecovery.started = false;
  await manager.mediaRecorder.onstop();
  assert.deepEqual(cancels, [writes[0][0]]);
  assert.deepEqual(batches, [(await header.text()) + "old mic" + next]);
  assert.equal(writes.length, 1);
});

test("a late Voxtral failure feeds Parakeet the capture from before and after the switch", async (t) => {
  const { manager, advance, writes, batches, results } = await setup(t);
  manager.cancelLiveLocalRecording();
  installMediaRecorder(t);
  Object.assign(manager, {
    isStreaming: true,
    streamingCleanupFns: [],
    _streamingFallbackSegments: [],
    getStreamingProvider: () => ({
      finalizeAcknowledged: true,
      failsOverToBatch: true,
      stop: async () => ({ text: "partial" }),
    }),
  });
  const recorder = manager.startStreamingFallbackRecorder(stream);
  recorder.ondataavailable({ data: header });
  advance(35000);
  recorder.ondataavailable({ data: new Blob(["before"]) });
  assert.deepEqual(writes, []);
  manager._streamingFailoverReason = "stream_no_final";
  manager.warmLocalRecording();
  await tick();
  recorder.ondataavailable({ data: new Blob(["after"]) });
  await manager.stopStreamingRecording();
  assert.equal(writes.map(([, text]) => text).join(""), (await header.text()) + "beforeafter");
  assert.deepEqual(batches, []);
  assert.equal(results[0].rawText, "raw words");
});

test("a stalled write has bounded backlog and falls back without waiting for the writer", async (t) => {
  const { manager, api, recorder, advance, add, batches, cancels, results } = await setup(t);
  const started = Promise.withResolvers(),
    blocked = Promise.withResolvers();
  api.writeLocalRecordingChunk = (id) => {
    started.resolve(id);
    return blocked.promise;
  };
  advance(24000);
  add("a");
  const id = await started.promise;
  for (let i = 0; i < 20; i++) add("b");
  await recorder.onstop();
  blocked.resolve(true);
  assert.deepEqual(cancels, [id]);
  assert.deepEqual(batches, [await manager.lastAudioBlob.text()]);
  assert.equal(results[0].rawText, "batch words");
});

test("release finishes the original recorder, even if its merge settles after the pointer changes", async (t) => {
  const { manager, recorder, advance, add, batches, results } = await setup(t);
  const merging = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  manager.mergeRecordedSegments = async ([segment]) => {
    merging.resolve();
    await unblock.promise;
    return segment;
  };
  advance(24000);
  add("last");
  const stopped = recorder.onstop();
  await merging.promise;
  const newer = {
    finish: () => assert.fail("next session must not be finalized"),
    cancel: () => assert.fail("next session must not be cancelled"),
  };
  manager.liveLocalRecording = newer;
  unblock.resolve();
  await stopped;
  assert.deepEqual(batches, []);
  assert.equal(results[0].rawText, "raw words");
  assert.equal(manager.liveLocalRecording, newer);
});

test("a stuck finish on a long dictation falls back within 15 seconds of release", async (t) => {
  const { api, recorder, advance, add, batches, cancels } = await setup(t);
  const started = Promise.withResolvers();
  api.finishLocalRecording = (id) => {
    started.resolve(id);
    return new Promise(() => {});
  };
  advance(20 * 60 * 1000);
  add("last");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stopped = recorder.onstop();
  const id = await started.promise;
  t.mock.timers.tick(15000);
  await stopped;
  assert.deepEqual(cancels, [id]);
  assert.deepEqual(batches, [(await header.text()) + "last"]);
});

test("a real empty local result is handled as no speech", async (t) => {
  const { manager, api, recorder, advance, add, batches, results } = await setup(t);
  api.finishLocalRecording = async () => ({ ...localResult, text: "" });
  let failed,
    noAudio = false;
  manager.saveFailedTranscription = (_message, code, { stt }) => {
    failed = { code, stt };
  };
  manager.onNoAudio = () => {
    noAudio = true;
  };
  advance(24000);
  add("noise");
  await recorder.onstop();
  assert.equal(failed.code, "NO_SPEECH_DETECTED");
  assert.equal(failed.stt.text, "");
  assert.equal(noAudio, true);
  assert.deepEqual(batches, []);
  assert.deepEqual(results, []);
});

test("a restarted recorder has a fresh ID and ignores the cancelled recorder's late chunk", async (t) => {
  const { manager, advance, add, writes, batches, cancels } = await setup(t);
  advance(24000);
  add("first");
  await tick();
  manager.resetDiscardedBatchRecordingState();
  manager.isRecording = true;
  manager.recordingStartTime = Date.now();
  const next = manager.createBatchRecorder(stream, {
    recorder: { mimeType: "audio/webm" },
    chunks: [header],
  });
  manager.warmLocalRecording();
  await tick();
  advance(24000);
  add("discarded late frame");
  next.ondataavailable({ data: new Blob(["second"]) });
  await next.onstop();
  const opening = await header.text();
  assert.deepEqual(writes, [
    [1, opening + "first"],
    [2, opening + "second"],
  ]);
  assert.deepEqual(cancels, [1]);
  assert.deepEqual(batches, []);
});
