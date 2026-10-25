const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// Pin both cleanup routes against bridge defaults (local: 0.7, Anthropic/enterprise: 0.3).
// Only direct Gemini defers to model defaults; stale provider selections must not leak.
async function loadRouteResolver(t, provider = "test", mode = "providers") {
  const { vite } = await loadAudioManager(t, {
    cachePrefix: "only-whispers-cleanup-route-config-test-",
    settingsKey: "__cleanupRouteConfigSettings",
    mockModules: {
      "/stores/settingsStore": `
        export const getSettings = () => globalThis.__cleanupRouteConfigSettings;
        export const getEffectiveCleanupModel = () => "cleanup-model";
        export const selectResolvedLLMConfig = () => ({ model: "cleanup-model", provider: ${JSON.stringify(provider)}, mode: ${JSON.stringify(mode)} });
      `,
      "/dictationAgentInference": `
        export const resolveDictationAgentInference = () => ({
          reachable: true,
          model: "agent-model",
          displayProvider: "test",
          config: { provider: "test" },
        });
        export const resolveDictationAgentVisionInference = () => ({
          active: false,
          model: "",
          config: {},
        });
      `,
      "/config/prompts": `
        export const resolvePrompt = () => "route prompt";
        export const appendScreenContextSuffix = (prompt) => prompt;
        export const wrapCleanupTranscript = (text) => text;
        export const getCleanupSystemPrompt = () => "cleanup prompt";
      `,
    },
  });
  const settings = {
    useCleanupModel: true,
    cleanupDisableThinking: true,
    cleanupReasoningEffort: "medium",
  };
  const resolveReasoningRoute = (await vite.ssrLoadModule("/helpers/audioManager.js"))
    .resolveReasoningRoute;
  return (text, { voiceAgentRequested = false } = {}) =>
    resolveReasoningRoute(text, settings, "Jarvis", voiceAgentRequested);
}

test("the cleanup route pins temperature 0 and requires complete output", async (t) => {
  const resolveRoute = await loadRouteResolver(t);

  const route = resolveRoute("so um clean this up");

  assert.equal(route.kind, "cleanup");
  assert.equal(route.config.inferenceScope, "dictationCleanup");
  assert.equal(route.config.temperature, 0);
  assert.equal(route.config.requireCompleteOutput, true);
  assert.equal(route.config.reasoningEffort, "medium");
});

test("Gemini cleanup defers temperature to the provider", async (t) => {
  const resolveRoute = await loadRouteResolver(t, "gemini");
  assert.equal(resolveRoute("clean this").config.temperature, undefined);
});

test("a stale Gemini selection does not change other cleanup modes", async (t) => {
  const resolveRoute = await loadRouteResolver(t, "gemini", "local");
  assert.equal(resolveRoute("clean this").config.temperature, 0);
});

test("the agent route keeps its provider defaults", async (t) => {
  const resolveRoute = await loadRouteResolver(t);

  const route = resolveRoute("Jarvis, what is on my calendar", { voiceAgentRequested: true });

  assert.equal(route.kind, "agent");
  assert.equal(route.config.temperature, undefined);
  assert.equal(route.config.requireCompleteOutput, undefined);
});
