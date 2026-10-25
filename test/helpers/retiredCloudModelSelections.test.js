const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("retired cloud model selections are repointed to the provider default", async (t) => {
  installBrowserGlobals(t, {
    initialStorage: {
      _llmScopeKeysMigrated: "1",
      cleanupProvider: "groq",
      cleanupModel: "meta-llama/llama-4-scout-17b-16e-instruct",
      chatAgentProvider: "openai",
      chatAgentModel: "gpt-5.2",
      noteFormattingProvider: "custom",
      noteFormattingModel: "my-endpoint-model",
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-retired-cloud-model-test-",
  });
  const { useSettingsStore, reconcileRetiredCloudModelSelections } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );

  reconcileRetiredCloudModelSelections();

  const state = useSettingsStore.getState();
  assert.notEqual(
    state.cleanupModel,
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "a registry-retired model must be repointed"
  );
  assert.ok(state.cleanupModel, "repointed to a concrete replacement, not cleared");
  assert.equal(state.chatAgentModel, "gpt-5.2", "shipping models stay untouched");
  assert.equal(state.noteFormattingModel, "my-endpoint-model", "custom ids are free-form");
});
