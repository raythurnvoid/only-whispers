const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Dictation is English only: Luna's cleanup prompt is the English one, whatever
// the UI language, and tells it to write English even when the transcript isn't.
test("the cleanup prompt is English and asks for English output", async (t) => {
  installBrowserGlobals(t, { window: { dispatchEvent() {} } });
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-english-cleanup-test-",
    mockModules: {
      "/utils/logger":
        "export default { debug() {}, info() {}, warn() {}, error() {}, logReasoning() {} };",
    },
  });
  const service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => service.destroy());
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({
    uiLanguage: "fr",
    preferredLanguage: "en",
    customPrompts: { cleanup: "" },
  });

  const prompt = service.getSystemPrompt(null);
  assert.match(prompt, /^You are a transcript cleanup engine/);
  assert.match(prompt, /You MUST write your entire output in English/);
  assert.doesNotMatch(prompt, /write your output in that same language/);
});
