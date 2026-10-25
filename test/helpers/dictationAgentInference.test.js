const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/dictationAgentInference.js");

const baseSettings = {
  useDictationAgent: true,
  dictationAgentMode: "providers",
  dictationAgentProvider: "openai",
  dictationAgentModel: "gpt-5-mini",
  dictationAgentRemoteUrl: "",
  dictationAgentCloudBaseUrl: "",
  dictationAgentDisableThinking: true,
  dictationAgentReasoningEffort: "high",
};

test("uses the dictation agent scope, not the cleanup scope", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({
    ...baseSettings,
    // Cleanup is configured completely differently; it must not leak through.
    cleanupProvider: "openai",
    cleanupModel: "gpt-4.1-mini",
    cleanupReasoningEffort: "low",
  });

  assert.equal(result.model, "gpt-5-mini");
  assert.equal(result.config.provider, "openai");
  assert.equal(result.config.reasoningEffort, "high");
});

test("a model-required agent is unreachable without an explicit model", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({ ...baseSettings, dictationAgentModel: "" });

  assert.equal(result.reachable, false);
});

test("a disabled agent is unreachable", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({ ...baseSettings, useDictationAgent: false });

  assert.equal(result.reachable, false);
});

test("local mode with a leftover cloud provider still routes to llama.cpp", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({
    useDictationAgent: true,
    dictationAgentMode: "local",
    dictationAgentProvider: "openai",
    dictationAgentModel: "qwen2.5-coder",
  });

  assert.equal(result.config.provider, "local");
});

test("local mode with an empty provider routes to llama.cpp", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({
    ...baseSettings,
    dictationAgentMode: "local",
    dictationAgentProvider: "",
  });

  assert.equal(result.config.provider, "local");
});

test("self-hosted mode without a remote url never keeps a leftover provider", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({
    ...baseSettings,
    dictationAgentMode: "self-hosted",
    dictationAgentProvider: "openai",
    dictationAgentModel: "gpt-5-mini",
    dictationAgentRemoteUrl: "",
  });

  assert.equal(result.reachable, false);
  assert.equal(result.displayProvider, "self-hosted");
  assert.equal(result.config.provider, undefined);
});

test("providers mode keeps an explicit cloud provider", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({
    ...baseSettings,
    dictationAgentProvider: "openai",
    dictationAgentModel: "gpt-5-mini",
  });

  assert.equal(result.config.provider, "openai");
});

test("providers mode rejects a stale local provider", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({
    ...baseSettings,
    dictationAgentProvider: "qwen",
    dictationAgentModel: "qwen2.5-coder",
  });

  assert.equal(result.reachable, false);
  assert.equal(result.displayProvider, "none");
  assert.equal(result.config.provider, undefined);
});

test("enterprise mode with a missing provider fails closed", async () => {
  const { resolveDictationAgentInference } = await load();

  const result = resolveDictationAgentInference({
    ...baseSettings,
    dictationAgentMode: "enterprise",
    dictationAgentProvider: "",
    dictationAgentModel: "anthropic.claude-sonnet-4",
  });

  assert.equal(result.reachable, false);
  assert.equal(result.config.provider, undefined);
});

// The assistant panel answers spoken commands on the Voice Assistant scope —
// the tab the user actually edits — and gates screenshots exactly like the
// dictation route does.
const imageWired = (providerId) => ["openai", "anthropic", "gemini"].includes(providerId);
const panelSettings = {
  ...baseSettings,
  chatAgentMode: "providers",
  chatAgentProvider: "openai",
  chatAgentModel: "gpt-6-luna",
  useDictationAgentVisionModel: false,
  dictationAgentVisionMode: "",
  dictationAgentVisionProvider: "",
  dictationAgentVisionModel: "",
  dictationAgentVisionCloudBaseUrl: "",
};
const panel = (settings, options = {}) =>
  resolveChatStreamingInference(settings, {
    inferenceScope: "dictationAgent",
    isProviderImageWired: imageWired,
    ...options,
  });
let resolveChatStreamingInference;
test.before(async () => {
  ({ resolveChatStreamingInference } = await load());
});

test("typed chat surfaces stay on the Chat scope even when the Voice Assistant scope is reachable", () => {
  const { config, attachScreenContext } = resolveChatStreamingInference(panelSettings, {
    hasScreenContext: true,
    isProviderImageWired: imageWired,
  });

  assert.equal(config.scope, "chatIntelligence");
  assert.equal(config.model, "gpt-6-luna");
  assert.equal(attachScreenContext, true, "Chat's own model can see images");
});

test("an unreachable Voice Assistant scope falls the panel back to the Chat scope", () => {
  const { config, attachScreenContext } = panel(
    {
      ...panelSettings,
      dictationAgentMode: "providers",
      dictationAgentProvider: "",
      dictationAgentModel: "",
    },
    { hasScreenContext: true }
  );

  assert.equal(config.scope, "chatIntelligence");
  assert.equal(config.provider, "openai");
  assert.equal(config.model, "gpt-6-luna");
  assert.equal(attachScreenContext, true, "the fallback is gated on Chat's model, not the agent's");
});

test("the assistant toggled off keeps the panel on the Chat scope", () => {
  const { config } = panel({ ...panelSettings, useDictationAgent: false });

  assert.equal(config.scope, "chatIntelligence");
});

test("the assistant panel resolves the Voice Assistant scope, not the Chat scope", () => {
  const { config, attachScreenContext } = panel(panelSettings);

  assert.equal(config.scope, "dictationAgent");
  assert.equal(config.provider, "openai");
  assert.equal(config.model, "gpt-5-mini");
  assert.equal(attachScreenContext, false, "nothing to attach without a screenshot");
});

test("a screenshot attaches to the base scope when its model can see images", () => {
  const { config, attachScreenContext } = panel(
    { ...panelSettings, dictationAgentModel: "gpt-6-luna" },
    { hasScreenContext: true }
  );

  assert.equal(config.scope, "dictationAgent");
  assert.equal(config.model, "gpt-6-luna");
  assert.equal(attachScreenContext, true);
});

test("a screenshot is dropped when the base scope's provider is not image-wired", () => {
  const { config, attachScreenContext } = panel(
    { ...panelSettings, dictationAgentModel: "gpt-6-luna" },
    { hasScreenContext: true, isProviderImageWired: () => false }
  );

  assert.equal(config.scope, "dictationAgent");
  assert.equal(attachScreenContext, false);
});

const visionOverride = {
  useDictationAgentVisionModel: true,
  dictationAgentVisionMode: "providers",
  dictationAgentVisionProvider: "openai",
  dictationAgentVisionModel: "gpt-6-luna",
};

test("a screenshot swaps the panel onto the vision override and keeps the image", () => {
  const { config, attachScreenContext } = panel(
    { ...panelSettings, ...visionOverride },
    { hasScreenContext: true }
  );

  assert.equal(config.scope, "dictationAgentVision");
  assert.equal(config.mode, "providers");
  assert.equal(config.provider, "openai");
  assert.equal(config.model, "gpt-6-luna");
  assert.equal(attachScreenContext, true);
});

test("the vision override is ignored without a screenshot", () => {
  const { config } = panel({ ...panelSettings, ...visionOverride });

  assert.equal(config.scope, "dictationAgent");
});

test("the vision override toggle alone does not redirect without a chosen model", () => {
  const { config, attachScreenContext } = panel(
    {
      ...panelSettings,
      dictationAgentModel: "gpt-6-luna",
      useDictationAgentVisionModel: true,
      dictationAgentVisionMode: "providers",
    },
    { hasScreenContext: true }
  );

  assert.equal(config.scope, "dictationAgent");
  assert.equal(attachScreenContext, true, "the base scope's own gate decides");
});

test("a vision override that cannot see images drops the screenshot instead of redirecting", () => {
  const { config, attachScreenContext } = panel(
    { ...panelSettings, ...visionOverride },
    { hasScreenContext: true, isProviderImageWired: () => false }
  );

  assert.equal(config.scope, "dictationAgent");
  assert.equal(attachScreenContext, false);
});
