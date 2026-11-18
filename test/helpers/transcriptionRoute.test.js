const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/transcriptionRoute.ts");

test("a blank or example key keeps audio on the device", async () => {
  const { hasMistralKey } = await load();
  for (const key of [undefined, "", "   ", " your_mistral_api_key_here "]) {
    assert.equal(hasMistralKey(key), false);
  }
  assert.equal(hasMistralKey("saved-key"), true);
});

test("a configured Voxtral model is kept", async () => {
  const { resolveMistralModel } = await load();
  assert.equal(resolveMistralModel(" voxtral-small-latest "), "voxtral-small-latest");
});

test("a missing or non-Voxtral model falls back to the default Voxtral model", async () => {
  const { resolveMistralModel } = await load();
  for (const model of [undefined, "", "gpt-4o-mini-transcribe", "whisper-1"]) {
    assert.equal(resolveMistralModel(model), "voxtral-mini-transcribe-3-0");
  }
});

test("the upload limit matches Mistral's 25 MB cap", async () => {
  const { MISTRAL_FILE_SIZE_LIMIT } = await load();
  assert.equal(MISTRAL_FILE_SIZE_LIMIT, 25 * 1024 * 1024);
});
