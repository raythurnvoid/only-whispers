const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/transcriptionPreview.ts");

test("live preview joins completed cloud turns with the current partial turn", async () => {
  const { buildLiveTranscriptionPreview } = await load();

  assert.equal(
    buildLiveTranscriptionPreview("First sentence.", "Second sentence"),
    "First sentence. Second sentence"
  );
  assert.equal(buildLiveTranscriptionPreview("", "  Starting now  "), "Starting now");
});

test("assistant-routed recordings never show the dictation preview", async () => {
  const { shouldDisplayDictationPreview } = await load();

  assert.equal(shouldDisplayDictationPreview(true, false), true);
  assert.equal(shouldDisplayDictationPreview(true, true), false);
  assert.equal(shouldDisplayDictationPreview(false, false), false);
});
