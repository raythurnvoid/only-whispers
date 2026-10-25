export function resolveModeReachability({ mode, provider, model, isSelfHosted }) {
  if (mode === "self-hosted") return isSelfHosted;

  const hasModel = (model?.trim()?.length ?? 0) > 0;
  if (mode === "local") return hasModel;
  if (mode === "providers" || mode === "enterprise") {
    return !!provider?.trim() && hasModel;
  }
  return false;
}

export function resolveDictationAgentReachability({
  useDictationAgent,
  dictationAgentMode,
  dictationAgentProvider,
  dictationAgentModel,
  isSelfHostedAgent,
}) {
  if (!useDictationAgent) return false;
  return resolveModeReachability({
    mode: dictationAgentMode,
    provider: dictationAgentProvider,
    model: dictationAgentModel,
    isSelfHosted: isSelfHostedAgent,
  });
}

// Picks which model receives a captured screenshot, or drops it. An
// explicitly configured vision override is trusted without a capability check
// (custom and OpenRouter model ids aren't in the registry); an override that
// is toggled on but never configured inherits the agent's own config, so it
// falls through to the base rules rather than forcing an image onto a
// possibly text-only model. Dropping the image always beats failing the
// dictation.
export function resolveAgentImageTarget({
  hasScreenContext,
  visionOverrideActive,
  visionProviderImageWired,
  baseProviderImageWired,
  baseModelSupportsVision,
}) {
  if (!hasScreenContext) {
    return { attach: false, useVisionOverride: false };
  }
  if (visionOverrideActive) {
    // Configured but unable to send images: drop rather than quietly
    // redirecting the screenshot to a model the user didn't choose.
    return visionProviderImageWired
      ? { attach: true, useVisionOverride: true }
      : { attach: false, useVisionOverride: false };
  }
  if (baseProviderImageWired && baseModelSupportsVision) {
    return { attach: true, useVisionOverride: false };
  }
  return { attach: false, useVisionOverride: false };
}

export function resolveModeProvider({ mode, provider }) {
  switch (mode) {
    case "local":
      return "local";
    case "self-hosted":
      return undefined;
    case "providers":
    case "enterprise":
      return provider?.trim() || undefined;
    default:
      return undefined;
  }
}

export function resolveDictationAgentProvider({ dictationAgentMode, dictationAgentProvider }) {
  return resolveModeProvider({
    mode: dictationAgentMode,
    provider: dictationAgentProvider,
  });
}

function resolveModeDisplayProvider(mode, provider) {
  if (mode === "local") return "local";
  if (mode === "self-hosted") return "self-hosted";
  return provider?.trim() || "none";
}

export function resolveDictationAgentDisplayProvider({
  dictationAgentMode,
  dictationAgentProvider,
}) {
  return resolveModeDisplayProvider(dictationAgentMode, dictationAgentProvider);
}

const ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u;

// Wake-word cues gate on the explicit dictation language, then the language
// detected by STT. Some local and streaming providers do not report their
// auto-detected language, so Arabic script is a deterministic hint before the
// UI language fallback. Explicit and provider-reported languages stay
// authoritative, preventing foreign-language cues from broadening those modes.
export function resolveWakeWordLanguage(
  { preferredLanguage, uiLanguage },
  detectedLanguage,
  transcript
) {
  const language = typeof preferredLanguage === "string" ? preferredLanguage.trim() : "";
  if (language && language.toLowerCase() !== "auto") return language;
  const detected = typeof detectedLanguage === "string" ? detectedLanguage.trim() : "";
  if (detected && detected.toLowerCase() !== "auto") return detected;
  if (typeof transcript === "string" && ARABIC_SCRIPT_RE.test(transcript)) return "ar";
  return typeof uiLanguage === "string" ? uiLanguage : undefined;
}

// The renderer-side source of truth for what the main process gates the Agent
// companion pill on.
export function resolveLifecycleInputKind({ voiceAgentRequested }) {
  return voiceAgentRequested ? "assistant" : "dictation";
}

// Decides which reasoning path ("agent" | "cleanup" | "skip") a finished
// dictation takes. A recording started via the voice assistant hotkey always
// takes the agent path — no wake word needed. Standalone commands stream into
// the assistant panel (which resolves the Voice Assistant scope itself and
// reports configuration problems in-conversation), so the dictation
// agent's reachability only gates selection edits — that check happens at the
// selection disposition, not here.
export function resolveDictationRouteKind({
  cleanupReachable,
  agentReachable,
  agentInvoked,
  voiceAgentRequested,
}) {
  if (voiceAgentRequested) {
    return "agent";
  }
  if (agentReachable && agentInvoked) {
    return "agent";
  }
  if (cleanupReachable) {
    return "cleanup";
  }
  return "skip";
}

// A dictation skipped while cleanup is switched on goes out raw, which looks like
// a cleanup that changed nothing, so it carries a notice. `shownKey` names the
// broken setup the user was last warned about: the same one warns once, while a
// different mode or provider warns again. Once cleanup is off or reachable the
// warning is forgotten (`forget`), so the next broken setup warns.
// The "llm" surface gives it the same friendly cleanup toast as a provider failure.
export function cleanupUnconfiguredNotice(shownKey, { skipped, cleanupReachable, settings }) {
  if (!settings.useCleanupModel || cleanupReachable) return { forget: true, notice: null };
  if (!skipped) return { forget: false, notice: null };
  const setupKey = [
    "unconfigured",
    settings.cleanupMode || "",
    settings.cleanupProvider || "",
  ].join("\0");
  if (setupKey === shownKey) return { forget: false, notice: null };
  return {
    forget: false,
    notice: {
      message: "AI cleanup is on, but no cleanup model is set up.",
      messageKey: "hooks.audioRecording.cleanupUnconfigured",
      surface: "llm",
      settingsTarget: "llms",
      setupKey,
    },
  };
}
