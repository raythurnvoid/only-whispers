// Map a reasoning cloud routing to the InferenceMode its Settings tab selects on.
// Mirrors deriveTranscriptionMode (byok custom → self-hosted, other cloud → providers).
export function deriveReasoningMode(cloudMode, provider) {
  return cloudMode === "byok" && provider === "custom" ? "self-hosted" : "providers";
}

const MIRRORED_ROUTING_FIELDS = [
  ["cleanupProvider", "provider"],
  ["cleanupModel", "model"],
  ["cleanupCloudMode", "cloudMode"],
  ["cleanupCloudBaseUrl", "cloudBaseUrl"],
  ["cleanupRemoteUrl", "remoteUrl"],
];

// Fan a cleanup config out to all three LLM scopes; the two non-cleanup scopes
// mirror the routing fields that are set plus the derived mode (each tab selects
// on its mode). The endpoint rides along so a self-hosted or custom
// endpoint is reachable from every scope, not just the one onboarding wrote.
export function buildReasoningScopePatches(settings, mode) {
  const dictationCleanup = { ...settings, cleanupMode: mode };
  const routing = Object.fromEntries(
    MIRRORED_ROUTING_FIELDS.filter(([cleanupKey]) => settings[cleanupKey] !== undefined).map(
      ([cleanupKey, field]) => [field, settings[cleanupKey]]
    )
  );
  return {
    dictationCleanup,
    dictationAgent: { mode, ...routing },
    chatIntelligence: { mode, ...routing },
  };
}
