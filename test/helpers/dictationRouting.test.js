const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/dictationRouting.js");

test("voice agent hotkey routes to the agent without a wake word", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: true,
    }),
    "agent"
  );
});

test("voice agent hotkey never triggers cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  // Even with the dictation agent unreachable, a voice assistant recording
  // takes the agent route: standalone commands run on the chat scope in the
  // panel, so only selection edits (decided later) need this scope.
  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: false,
      agentInvoked: false,
      voiceAgentRequested: true,
    }),
    "agent"
  );
});

test("voice agent hotkey ignores the wake word state", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: true,
    }),
    "agent"
  );
});

test("normal dictation with wake word routes to the agent", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: false,
    }),
    "agent"
  );
});

test("normal dictation without wake word routes to cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: false,
    }),
    "cleanup"
  );
});

test("wake word with unreachable agent falls back to cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: false,
      agentInvoked: true,
      voiceAgentRequested: false,
    }),
    "cleanup"
  );
});

test("skips reasoning when nothing is reachable", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: false,
      agentInvoked: false,
      voiceAgentRequested: false,
    }),
    "skip"
  );
});

test("agent is reachable in self-hosted mode without an explicit model", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentMode: "self-hosted",
      dictationAgentProvider: undefined,
      dictationAgentModel: "",
      isSelfHostedAgent: true,
    }),
    true
  );
});

test("agent is unreachable with an empty model on a model-required provider", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentMode: "providers",
      dictationAgentProvider: "openai",
      dictationAgentModel: "   ",
      isSelfHostedAgent: false,
    }),
    false
  );
});

test("agent is reachable with an explicit model (BYOK/local/enterprise)", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentMode: "providers",
      dictationAgentProvider: "openai",
      dictationAgentModel: "gpt-5.5",
      isSelfHostedAgent: false,
    }),
    true
  );
});

test("disabling the dictation agent overrides reachability", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: false,
      dictationAgentMode: "providers",
      dictationAgentProvider: "openai",
      dictationAgentModel: "gpt-5",
      isSelfHostedAgent: true,
    }),
    false
  );
});

test("local mode resolves the local provider, not stale provider state", async () => {
  const { resolveDictationAgentProvider } = await load();

  assert.equal(
    resolveDictationAgentProvider({
      dictationAgentMode: "local",
      dictationAgentProvider: "qwen",
    }),
    "local"
  );
});

test("BYOK providers mode passes the stored provider through", async () => {
  const { resolveDictationAgentProvider } = await load();

  assert.equal(
    resolveDictationAgentProvider({
      dictationAgentMode: "providers",
      dictationAgentProvider: "anthropic",
    }),
    "anthropic"
  );
});

test("blank stored provider resolves to undefined outside local mode", async () => {
  const { resolveDictationAgentProvider } = await load();

  assert.equal(
    resolveDictationAgentProvider({
      dictationAgentMode: "providers",
      dictationAgentProvider: "  ",
    }),
    undefined
  );
});

test("self-hosted mode clears stale providers", async () => {
  const { resolveDictationAgentProvider } = await load();

  assert.equal(
    resolveDictationAgentProvider({
      dictationAgentMode: "self-hosted",
      dictationAgentProvider: "openai",
    }),
    undefined
  );
});

test("self-hosted mode is unreachable without its endpoint", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentMode: "self-hosted",
      dictationAgentProvider: undefined,
      dictationAgentModel: "gpt-5-mini",
      isSelfHostedAgent: false,
    }),
    false
  );
});

test("provider and enterprise modes require an explicit provider", async () => {
  const { resolveDictationAgentReachability } = await load();

  for (const dictationAgentMode of ["providers", "enterprise"]) {
    assert.equal(
      resolveDictationAgentReachability({
        useDictationAgent: true,
        dictationAgentMode,
        dictationAgentProvider: undefined,
        dictationAgentModel: "gpt-5-mini",
        isSelfHostedAgent: false,
      }),
      false
    );
  }
});

test("display provider follows the active mode instead of stale state", async () => {
  const { resolveDictationAgentDisplayProvider } = await load();

  assert.equal(
    resolveDictationAgentDisplayProvider({
      dictationAgentMode: "local",
      dictationAgentProvider: "openai",
    }),
    "local"
  );
  assert.equal(
    resolveDictationAgentDisplayProvider({
      dictationAgentMode: "self-hosted",
      dictationAgentProvider: "openai",
    }),
    "self-hosted"
  );
});

// Screen-context image routing on the agent route.
const imageTarget = {
  hasScreenContext: true,
  visionOverrideActive: false,
  visionProviderImageWired: false,
  baseProviderImageWired: true,
  baseModelSupportsVision: false,
};

test("no captured screenshot never attaches", async () => {
  const { resolveAgentImageTarget } = await load();

  assert.deepEqual(
    resolveAgentImageTarget({
      ...imageTarget,
      hasScreenContext: false,
      visionOverrideActive: true,
      visionProviderImageWired: true,
      baseModelSupportsVision: true,
    }),
    { attach: false, useVisionOverride: false }
  );
});

test("BYOK base model attaches only when the registry marks it vision-capable", async () => {
  const { resolveAgentImageTarget } = await load();

  assert.deepEqual(resolveAgentImageTarget({ ...imageTarget, baseModelSupportsVision: true }), {
    attach: true,
    useVisionOverride: false,
  });
  assert.deepEqual(resolveAgentImageTarget(imageTarget), {
    attach: false,
    useVisionOverride: false,
  });
});

test("an unwired base provider never gets the image", async () => {
  const { resolveAgentImageTarget } = await load();

  assert.deepEqual(
    resolveAgentImageTarget({
      ...imageTarget,
      baseProviderImageWired: false,
      baseModelSupportsVision: true,
    }),
    { attach: false, useVisionOverride: false }
  );
});

test("an active vision override wins over the base model", async () => {
  const { resolveAgentImageTarget } = await load();

  assert.deepEqual(
    resolveAgentImageTarget({
      ...imageTarget,
      visionOverrideActive: true,
      visionProviderImageWired: true,
      baseModelSupportsVision: true,
    }),
    { attach: true, useVisionOverride: true }
  );
});

test("an active override lets a text-only base agent still get screen context", async () => {
  const { resolveAgentImageTarget } = await load();

  assert.deepEqual(
    resolveAgentImageTarget({
      ...imageTarget,
      visionOverrideActive: true,
      visionProviderImageWired: true,
      baseProviderImageWired: false,
    }),
    { attach: true, useVisionOverride: true }
  );
});

test("an override on a provider that can't send images drops the screenshot", async () => {
  const { resolveAgentImageTarget } = await load();

  // The user pointed the override at a provider whose client has no image
  // path; quietly using the base model instead would ignore that choice.
  assert.deepEqual(
    resolveAgentImageTarget({
      ...imageTarget,
      visionOverrideActive: true,
      visionProviderImageWired: false,
    }),
    { attach: false, useVisionOverride: false }
  );
});

test("an override toggled on but never configured falls back to the base rules", async () => {
  const { resolveAgentImageTarget } = await load();

  // Unconfigured, the vision scope just inherits the agent's own config, so
  // the base capability checks decide — never force an image onto a
  // text-only model.
  assert.deepEqual(
    resolveAgentImageTarget({
      ...imageTarget,
      visionOverrideActive: false,
      baseModelSupportsVision: true,
    }),
    { attach: true, useVisionOverride: false }
  );
  assert.deepEqual(resolveAgentImageTarget({ ...imageTarget, visionOverrideActive: false }), {
    attach: false,
    useVisionOverride: false,
  });
});

test("wake-word language follows the dictation language when it is explicit", async () => {
  const { resolveWakeWordLanguage } = await load();

  assert.equal(resolveWakeWordLanguage({ preferredLanguage: "it", uiLanguage: "en" }, "fr"), "it");
  assert.equal(resolveWakeWordLanguage({ preferredLanguage: "zh-CN", uiLanguage: "en" }), "zh-CN");
});

test("wake-word language uses detected speech before the UI language on auto", async () => {
  const { resolveWakeWordLanguage } = await load();

  assert.equal(
    resolveWakeWordLanguage({ preferredLanguage: "auto", uiLanguage: "it" }, "en"),
    "en"
  );
  assert.equal(resolveWakeWordLanguage({ preferredLanguage: "", uiLanguage: "en" }, "it"), "it");
});

test("wake-word language infers Arabic script before the UI fallback on auto", async () => {
  const { resolveWakeWordLanguage } = await load();

  assert.equal(
    resolveWakeWordLanguage(
      { preferredLanguage: "auto", uiLanguage: "en" },
      undefined,
      "يا Max، لخّص هذه الملاحظة"
    ),
    "ar"
  );
  assert.equal(
    resolveWakeWordLanguage(
      { preferredLanguage: "en", uiLanguage: "ar" },
      undefined,
      "يا Max، summarize this note"
    ),
    "en",
    "an explicit dictation language must remain authoritative"
  );
  assert.equal(
    resolveWakeWordLanguage(
      { preferredLanguage: "auto", uiLanguage: "ar" },
      "en",
      "يا Max، summarize this note"
    ),
    "en",
    "provider detection must remain authoritative"
  );
});

test("wake-word language falls back to the UI language on auto or unset", async () => {
  const { resolveWakeWordLanguage } = await load();

  assert.equal(resolveWakeWordLanguage({ preferredLanguage: "auto", uiLanguage: "it" }), "it");
  assert.equal(resolveWakeWordLanguage({ preferredLanguage: "", uiLanguage: "pt" }), "pt");
  assert.equal(resolveWakeWordLanguage({ preferredLanguage: "  ", uiLanguage: "de" }), "de");
  assert.equal(resolveWakeWordLanguage({ preferredLanguage: undefined, uiLanguage: "fr" }), "fr");
});

test("wake-word language is undefined when no usable hint exists", async () => {
  const { resolveWakeWordLanguage } = await load();

  assert.equal(
    resolveWakeWordLanguage({ preferredLanguage: "auto", uiLanguage: undefined }),
    undefined
  );
  assert.equal(resolveWakeWordLanguage({}), undefined);
});

test("lifecycle input kind is assistant for a voice-agent request, else dictation", async () => {
  const { resolveLifecycleInputKind } = await load();
  assert.equal(resolveLifecycleInputKind({ voiceAgentRequested: true }), "assistant");
  assert.equal(resolveLifecycleInputKind({}), "dictation");
});

test("an unconfigured cleanup warns once per broken setup, and again once it was fixed", async () => {
  const { cleanupUnconfiguredNotice } = await load();
  const settings = {
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "openai",
  };
  const skipped = { skipped: true, cleanupReachable: false, settings };

  const first = cleanupUnconfiguredNotice(null, skipped);
  assert.equal(first.forget, false);
  assert.equal(first.notice.messageKey, "hooks.audioRecording.cleanupUnconfigured");
  assert.equal(first.notice.settingsTarget, "llms");
  assert.equal(first.notice.surface, "llm", "it gets the friendly cleanup toast");

  const shownKey = first.notice.setupKey;
  assert.equal(cleanupUnconfiguredNotice(shownKey, skipped).notice, null);
  const otherProvider = cleanupUnconfiguredNotice(shownKey, {
    ...skipped,
    settings: { ...settings, cleanupProvider: "anthropic" },
  });
  assert.notEqual(otherProvider.notice, null, "a different broken setup warns again");

  // Only a skipped dictation warns; a wake-word command was handled by the agent.
  assert.deepEqual(cleanupUnconfiguredNotice(null, { ...skipped, skipped: false }), {
    forget: false,
    notice: null,
  });

  for (const fixed of [
    { ...skipped, cleanupReachable: true },
    { ...skipped, settings: { ...settings, useCleanupModel: false } },
  ]) {
    assert.deepEqual(cleanupUnconfiguredNotice(shownKey, fixed), { forget: true, notice: null });
  }
});
