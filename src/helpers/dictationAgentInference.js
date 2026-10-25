import {
  resolveAgentImageTarget,
  resolveDictationAgentDisplayProvider,
  resolveDictationAgentProvider,
  resolveDictationAgentReachability,
  resolveModeProvider,
  resolveModeReachability,
} from "./dictationRouting.js";
import { getCloudModel, isProviderValidForMode } from "../models/ModelRegistry";
import { selectResolvedLLMConfig } from "../stores/settingsStore";

// The dictation agent's inference scope, used by the dictation route in
// audioManager.
//
// Callers must add `systemPrompt` to the config: ReasoningService treats a
// missing one as its cleanup path, which echoes the input back instead of
// running the instruction.
export function resolveDictationAgentInference(settings) {
  const model = settings.dictationAgentModel?.trim() || "";
  const isSelfHosted =
    settings.dictationAgentMode === "self-hosted" && !!settings.dictationAgentRemoteUrl?.trim();
  const storedProvider = settings.dictationAgentProvider?.trim() || "";
  const providerForMode = isProviderValidForMode(storedProvider, settings.dictationAgentMode)
    ? storedProvider
    : undefined;
  const provider = resolveDictationAgentProvider({
    dictationAgentMode: settings.dictationAgentMode,
    dictationAgentProvider: providerForMode,
  });

  return {
    reachable: resolveDictationAgentReachability({
      useDictationAgent: settings.useDictationAgent,
      dictationAgentMode: settings.dictationAgentMode,
      dictationAgentProvider: provider,
      dictationAgentModel: model,
      isSelfHostedAgent: isSelfHosted,
    }),
    model,
    displayProvider: resolveDictationAgentDisplayProvider({
      dictationAgentMode: settings.dictationAgentMode,
      dictationAgentProvider: providerForMode,
    }),
    config: {
      inferenceScope: /** @type {const} */ ("dictationAgent"),
      provider,
      disableThinking: settings.dictationAgentDisableThinking,
      reasoningEffort: settings.dictationAgentReasoningEffort,
    },
  };
}

// The optional vision override: the scope a voice-agent request uses when it
// carries a screen-context screenshot. Resolved through the store selector so
// unset fields inherit the agent's own config, and treated as "active" only
// once the user has actually chosen a target — an inherited config is the
// agent scope, which the base routing rules already cover.
export function resolveDictationAgentVisionInference(settings) {
  const resolved = selectResolvedLLMConfig(settings, "dictationAgentVision");
  const mode = resolved.mode;
  const model = resolved.model?.trim() || "";
  const storedProvider = resolved.provider?.trim() || "";
  const providerForMode = isProviderValidForMode(storedProvider, mode) ? storedProvider : undefined;
  const provider = resolveModeProvider({ mode, provider: providerForMode });

  // The user must have picked a model for this scope specifically.
  const chosen = !!settings.dictationAgentVisionModel?.trim();

  return {
    active:
      !!settings.useDictationAgentVisionModel &&
      chosen &&
      resolveModeReachability({ mode, provider, model, isSelfHosted: false }),
    mode,
    model,
    config: {
      // The vision override is the agent's image lane, so it runs as the agent
      // scope, not dictation cleanup.
      inferenceScope: /** @type {const} */ ("dictationAgent"),
      provider,
      disableThinking: resolved.disableThinking,
      reasoningEffort: resolved.reasoningEffort,
    },
  };
}

/**
 * What a chat conversation streams on, and whether its screenshot rides along.
 *
 * Typed chat surfaces resolve the Chat scope. The voice assistant panel resolves
 * the Voice Assistant scope — the tab that also governs selection edits — so the
 * model picked there answers spoken commands; while that scope is unreachable
 * (assistant toggled off, a BYOK mode with no model) the panel falls back to
 * Chat, its previous home. Profiles from before onboarding fanned selections out
 * are seeded from Chat on upgrade (settingsStore).
 *
 * Screenshots follow the dictation route's rules (resolveAgentImageTarget): a
 * configured vision override is trusted to see images and swapped in; an
 * override that cannot drops the screenshot rather than redirecting it to a
 * model the user did not choose; the base scope attaches only where its
 * provider is image-wired and the registry says its model has vision.
 *
 * `isProviderImageWired` is injected: the provider registry reads Vite env at
 * load, which this helper's callers and tests do not all have.
 *
 * @param {import("../stores/settingsStore").SettingsState} settings
 * @param {{
 *   inferenceScope?: "chatIntelligence" | "dictationAgent",
 *   hasScreenContext?: boolean,
 *   isProviderImageWired?: (providerId: string | undefined) => boolean,
 * }} [options]
 * @returns {{
 *   config: import("../stores/settingsStore").ResolvedLLMConfig,
 *   attachScreenContext: boolean,
 * }}
 */
export function resolveChatStreamingInference(
  settings,
  {
    inferenceScope = "chatIntelligence",
    hasScreenContext = false,
    isProviderImageWired = () => false,
  } = {}
) {
  const onAgentScope =
    inferenceScope === "dictationAgent" && resolveDictationAgentInference(settings).reachable;
  const config = selectResolvedLLMConfig(
    settings,
    onAgentScope ? "dictationAgent" : "chatIntelligence"
  );
  const vision =
    onAgentScope && hasScreenContext ? resolveDictationAgentVisionInference(settings) : null;

  const { attach, useVisionOverride } = resolveAgentImageTarget({
    hasScreenContext,
    visionOverrideActive: !!vision?.active,
    visionProviderImageWired: isProviderImageWired(vision?.config.provider),
    baseProviderImageWired: isProviderImageWired(
      resolveModeProvider({ mode: config.mode, provider: config.provider })
    ),
    baseModelSupportsVision: !!getCloudModel(config.model)?.supportsVision,
  });
  if (!useVisionOverride) return { config, attachScreenContext: attach };
  return {
    config: {
      scope: "dictationAgentVision",
      mode: vision.mode,
      provider: vision.config.provider,
      model: vision.model,
      disableThinking: vision.config.disableThinking,
      reasoningEffort: vision.config.reasoningEffort,
    },
    attachScreenContext: true,
  };
}
