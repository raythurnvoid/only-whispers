const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/reasoningRouting.js");

test("byok cloud provider maps to the providers mode", async () => {
  const { deriveReasoningMode } = await load();
  assert.equal(deriveReasoningMode("byok", "corti"), "providers");
});

test("byok custom provider maps to the self-hosted mode", async () => {
  const { deriveReasoningMode } = await load();
  assert.equal(deriveReasoningMode("byok", "custom"), "self-hosted");
});

test("an unset cloud mode maps to the providers mode", async () => {
  const { deriveReasoningMode } = await load();
  assert.equal(deriveReasoningMode(undefined, "corti"), "providers");
});

test("fan-out routes provider, model and mode to all three scopes", async () => {
  const { buildReasoningScopePatches } = await load();
  const { dictationCleanup, dictationAgent, chatIntelligence } = buildReasoningScopePatches(
    {
      useCleanupModel: true,
      cleanupProvider: "corti",
      cleanupModel: "corti-s1-instant",
      cleanupCloudMode: "byok",
    },
    "providers"
  );

  assert.equal(dictationCleanup.cleanupProvider, "corti");
  assert.equal(dictationCleanup.cleanupModel, "corti-s1-instant");
  assert.equal(dictationCleanup.cleanupMode, "providers");

  for (const scope of [dictationAgent, chatIntelligence]) {
    assert.equal(scope.provider, "corti");
    assert.equal(scope.model, "corti-s1-instant");
    assert.equal(scope.cloudMode, "byok");
    assert.equal(scope.mode, "providers");
  }
});

// A self-hosted endpoint is only reachable from a scope that carries its url
// and key; mirroring provider/model alone left scopes pointing at a
// "self-hosted" mode with no host behind it.
test("fan-out mirrors the endpoint url and key alongside the routing", async () => {
  const { buildReasoningScopePatches } = await load();
  const { dictationCleanup, dictationAgent } = buildReasoningScopePatches(
    {
      cleanupProvider: "custom",
      cleanupModel: "qwen3-8b",
      cleanupCloudMode: "byok",
      cleanupCloudBaseUrl: "",
      cleanupRemoteUrl: "https://llm.lan:8080/v1",
      cleanupCustomApiKey: "lan-key",
    },
    "self-hosted"
  );

  assert.equal(dictationCleanup.cleanupRemoteUrl, "https://llm.lan:8080/v1");
  assert.deepEqual(dictationAgent, {
    mode: "self-hosted",
    provider: "custom",
    model: "qwen3-8b",
    cloudMode: "byok",
    cloudBaseUrl: "",
    remoteUrl: "https://llm.lan:8080/v1",
    customApiKey: "lan-key",
  });
});

test("fan-out with partial settings only mirrors the provided routing fields", async () => {
  const { buildReasoningScopePatches } = await load();
  const { dictationCleanup, dictationAgent, chatIntelligence } = buildReasoningScopePatches(
    { useCleanupModel: true },
    "providers"
  );

  assert.equal(dictationCleanup.useCleanupModel, true);
  assert.equal(dictationCleanup.cleanupMode, "providers");
  assert.equal("cleanupProvider" in dictationCleanup, false);

  for (const scope of [dictationAgent, chatIntelligence]) {
    assert.deepEqual(scope, { mode: "providers" });
  }
});

test("a scope inherits the fallback key when it inherits the endpoint", async () => {
  const { inheritsFallbackEndpoint } = await load();
  assert.equal(inheritsFallbackEndpoint({ mode: "self-hosted" }, "self-hosted"), true);
});

test("a scope on its own remote url keeps its own key", async () => {
  const { inheritsFallbackEndpoint } = await load();
  assert.equal(
    inheritsFallbackEndpoint(
      { mode: "self-hosted", remoteUrl: "http://host:8080/v1" },
      "self-hosted"
    ),
    false
  );
});

test("a scope on its own cloud base url keeps its own key", async () => {
  const { inheritsFallbackEndpoint } = await load();
  assert.equal(
    inheritsFallbackEndpoint(
      { mode: "providers", cloudBaseUrl: "https://api.example.com/v1" },
      "providers"
    ),
    false
  );
});

test("a differing mode never borrows the key (regression: key sent to the wrong host)", async () => {
  const { inheritsFallbackEndpoint } = await load();
  assert.equal(inheritsFallbackEndpoint({ mode: "providers" }, "self-hosted"), false);
});

test("no fallback scope means nothing to inherit", async () => {
  const { inheritsFallbackEndpoint } = await load();
  assert.equal(inheritsFallbackEndpoint({ mode: "providers" }, undefined), false);
});
