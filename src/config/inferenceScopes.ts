import type { SettingsState } from "../stores/settingsStore";

export interface InferenceScopeStoreKeys {
  mode: keyof SettingsState;
  provider: keyof SettingsState;
  model: keyof SettingsState;
  cloudMode?: keyof SettingsState;
  cloudBaseUrl?: keyof SettingsState;
  remoteUrl?: keyof SettingsState;
  disableThinking?: keyof SettingsState;
  reasoningEffort?: keyof SettingsState;
}

export interface InferenceScopeDefinition {
  storeKeys: InferenceScopeStoreKeys;
  fallbackScope?: string;
  /**
   * Inert until the user picks its own model, inheriting the fallback scope
   * meanwhile. Only for scopes whose every offered mode needs a model.
   */
  optional?: true;
}

export const INFERENCE_SCOPES = {
  dictationCleanup: {
    storeKeys: {
      mode: "cleanupMode",
      provider: "cleanupProvider",
      model: "cleanupModel",
      cloudMode: "cleanupCloudMode",
      cloudBaseUrl: "cleanupCloudBaseUrl",
      remoteUrl: "cleanupRemoteUrl",
      disableThinking: "cleanupDisableThinking",
      reasoningEffort: "cleanupReasoningEffort",
    },
  },
  dictationAgent: {
    storeKeys: {
      mode: "dictationAgentMode",
      provider: "dictationAgentProvider",
      model: "dictationAgentModel",
      cloudMode: "dictationAgentCloudMode",
      cloudBaseUrl: "dictationAgentCloudBaseUrl",
      remoteUrl: "dictationAgentRemoteUrl",
      disableThinking: "dictationAgentDisableThinking",
      reasoningEffort: "dictationAgentReasoningEffort",
    },
  },
  // Optional override used only when a voice-agent request carries a screen
  // context screenshot. Unset fields resolve to the dictationAgent scope, and
  // the UI offers only provider modes, so remoteUrl is deliberately absent.
  dictationAgentVision: {
    storeKeys: {
      mode: "dictationAgentVisionMode",
      provider: "dictationAgentVisionProvider",
      model: "dictationAgentVisionModel",
      cloudMode: "dictationAgentVisionCloudMode",
      cloudBaseUrl: "dictationAgentVisionCloudBaseUrl",
      disableThinking: "dictationAgentVisionDisableThinking",
      reasoningEffort: "dictationAgentVisionReasoningEffort",
    },
    fallbackScope: "dictationAgent",
    optional: true,
  },
  // Runs typed chat conversations (Control Panel).
  // The voice assistant panel's spoken commands, like selection edits, run on
  // dictationAgent(Vision) — see resolveChatStreamingInference.
  chatIntelligence: {
    storeKeys: {
      mode: "chatAgentMode",
      provider: "chatAgentProvider",
      model: "chatAgentModel",
      cloudMode: "chatAgentCloudMode",
      cloudBaseUrl: "chatAgentCloudBaseUrl",
      remoteUrl: "chatAgentRemoteUrl",
      disableThinking: "chatAgentDisableThinking",
      reasoningEffort: "chatAgentReasoningEffort",
    },
  },
} as const satisfies Record<string, InferenceScopeDefinition>;

export type InferenceScope = keyof typeof INFERENCE_SCOPES;

/**
 * Whether a scope in this mode runs its provider/model pair against a cloud
 * catalog. Self-hosted, local and enterprise modes share the model key but can
 * keep an old cloud provider, so catalog repairs must leave them alone.
 */
export function usesCloudModelCatalog(mode: unknown): boolean {
  return mode === "providers";
}
