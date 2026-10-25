const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Voxtral's auto detection sometimes heard English as French, Italian or German,
// so dictation always asks for English: a fresh setup and any old setting read "en".
test("dictation language is English for a fresh setup and any old setting", async (t) => {
  const { storage } = installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-english-language-test-",
  });

  for (const [stored, expected] of [
    [null, "en"],
    ["auto", "en"],
    ["fr", "en"],
    ["zh", "en"],
  ]) {
    storage.clear();
    if (stored) storage.setItem("preferredLanguage", stored);

    // The migration runs once per module evaluation.
    vite.moduleGraph.invalidateAll();
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");

    assert.equal(useSettingsStore.getState().preferredLanguage, expected, `stored ${stored}`);
  }
});
