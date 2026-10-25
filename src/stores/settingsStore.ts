import { create } from "zustand";
import { API_ENDPOINTS } from "../config/constants";
import i18n, { normalizeUiLanguage } from "../i18n";
import { ensureAgentNameInDictionary } from "../utils/agentName";
import { chooseDictionaryStartupAction } from "../helpers/dictionaryStartup";
import logger from "../utils/logger";
import type {
  ChineseScriptPreference,
  LocalTranscriptionProvider,
  InferenceMode,
  SelfHostedType,
} from "../types/electron";
import { normalizeEmailDraftTarget, type EmailDraftTargetSetting } from "../utils/emailDraftTarget";
import { normalizeToneStyles, type ToneStyles } from "../config/toneStyle";
import { PROMPT_KIND_LIST, type PromptKind } from "../config/prompts/registry";
import { sweepRetiredPromptOverrides } from "../config/retiredPrompts";
import { deriveReasoningMode, buildReasoningScopePatches } from "../helpers/reasoningRouting";
import {
  INFERENCE_SCOPES,
  type InferenceScope,
  type InferenceScopeDefinition,
  type InferenceScopeStoreKeys,
  usesCloudModelCatalog,
} from "../config/inferenceScopes";
import { normalizeChineseScriptPreference } from "../utils/chineseScript";
import modelRegistryData from "../models/modelRegistryData.json";
import { pickDefaultModelId } from "../models/providerDefaultModel";
import type {
  TranscriptionSettings,
  CleanupSettings,
  HotkeySettings,
  OnboardingSettings,
  MicrophoneSettings,
  ApiKeySettings,
  PrivacySettings,
  ThemeSettings,
  ChatAgentSettings,
} from "../hooks/useSettings";
import type { Snippet } from "../utils/snippets";

let _ReasoningService: typeof import("../services/ReasoningService").default | null = null;

// Requires localStorage as well as window: the module-scope migrations below
// dereference the bare localStorage global, and test harnesses import this
// store with partial window stubs that don't define it.
const isBrowser = typeof window !== "undefined" && typeof localStorage !== "undefined";

const DEFAULT_CLOUD_TRANSCRIPTION_PROVIDER = "openai";

/** Where a transcription runs from; each has its own provider and model settings. */
export type TranscriptionContext = "dictation" | "upload";

function transcriptionProviderModels(providerId: string): Array<{ id: string }> {
  return (
    modelRegistryData.transcriptionProviders.find((provider) => provider.id === providerId)
      ?.models ?? []
  );
}

function defaultTranscriptionModel(providerId: string): string {
  return transcriptionProviderModels(providerId)[0]?.id ?? "whisper-1";
}

function transcriptionModelBelongsToProvider(providerId: string, modelId: string): boolean {
  if (providerId === "custom") return Boolean(modelId);
  return transcriptionProviderModels(providerId).some((model) => model.id === modelId);
}

export function reasoningModelBelongsToProvider(providerId: string, modelId: string): boolean {
  if (!modelId) return false;
  return (
    modelRegistryData.cloudProviders
      .find((provider) => provider.id === providerId)
      ?.models.some((model) => model.id === modelId) ?? false
  );
}

function readString(key: string, fallback: string): string {
  if (!isBrowser) return fallback;
  return localStorage.getItem(key) ?? fallback;
}

// Literal rather than an import from ModelRegistry: ModelRegistry imports this
// store, so importing back would create a require cycle.
const DEFAULT_COHERE_MODEL = "cohere-transcribe-03-2026";

function readLocalProvider(key: string): LocalTranscriptionProvider {
  const stored = readString(key, "whisper");
  return stored === "nvidia" || stored === "cohere" ? stored : "whisper";
}

// Upload keys defaulted to "whisper" even when never stored, so a
// fresh Parakeet/Cohere install resolved uploads against Whisper `base`.
function readScopedLocalProvider(scopeKey: string): LocalTranscriptionProvider {
  if (isBrowser && localStorage.getItem(scopeKey) === null) {
    return readLocalProvider("localTranscriptionProvider");
  }
  return readLocalProvider(scopeKey);
}

function readBoolean(key: string, fallback: boolean): boolean {
  if (!isBrowser) return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  if (fallback === true) return stored !== "false";
  return stored === "true";
}

function readNumber(key: string, fallback: number): number {
  if (!isBrowser) return fallback;
  const parsed = parseInt(localStorage.getItem(key) ?? "", 10);
  return isNaN(parsed) ? fallback : parsed;
}

// Durations offered by the mic warm-hold select; unknown values snap to 0 (off)
// so a hand-edited localStorage entry can never hold the mic open indefinitely.
export const MIC_WARM_HOLD_CHOICES = [0, 10, 60, 900] as const;

function snapMicWarmHold(value: number): number {
  return (MIC_WARM_HOLD_CHOICES as readonly number[]).includes(value) ? value : 0;
}

function readStringArray(key: string, fallback: string[]): string[] {
  if (!isBrowser) return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

type MicrophoneSelectionMode = "system" | "built-in" | "specific";

// `message` is main's translated reason, when it gave one.
export type HotkeyRegistrationResult = { success: boolean; message?: string };

function migrateMicrophoneSelectionMode() {
  if (!isBrowser) return;
  const current = localStorage.getItem("microphoneSelectionMode");
  if (current === "system" || current === "built-in" || current === "specific") return;

  const selectedDeviceId = localStorage.getItem("selectedMicDeviceId") || "";
  const legacyBuiltIn = localStorage.getItem("preferBuiltInMic");
  const mode: MicrophoneSelectionMode =
    legacyBuiltIn === "true"
      ? "built-in"
      : selectedDeviceId && selectedDeviceId !== "default"
        ? "specific"
        : "system";
  localStorage.setItem("microphoneSelectionMode", mode);
}

migrateMicrophoneSelectionMode();

const BOOLEAN_SETTINGS = new Set([
  "useLocalWhisper",
  "uploadUseLocalWhisper",
  "allowOpenAIFallback",
  "allowLocalFallback",
  "assemblyAiStreaming",
  "useCleanupModel",
  "toneStyleEnabled",
  "useDictationAgent",
  "voiceAgentScreenContext",
  "useDictationAgentVisionModel",
  "preferBuiltInMic",
  "cloudBackupEnabled",
  "insightsSyncEnabled",
  "telemetryEnabled",
  "audioCuesEnabled",
  "pauseMediaOnDictation",
  "muteAppsOnDictation",
  "floatingIconAutoHide",
  "startMinimized",
  "autoPasteEnabled",
  "keepTranscriptionInClipboard",
  "dataRetentionEnabled",
  "saveDiscardedTranscriptions",
  "showTranscriptionPreview",
  "cleanupDisableThinking",
  "dictationAgentDisableThinking",
  "dictationAgentVisionDisableThinking",
  "chatAgentDisableThinking",
]);

const ARRAY_SETTINGS = new Set([
  "customDictionary",
  "snippets",
  "onboardingUseCases",
  "spokenLanguages",
]);

const NUMERIC_SETTINGS = new Set([
  "micWarmHoldSeconds",
  "audioRetentionDays",
  "transcriptRetentionDays",
]);

// Dictation is English only (there is no language picker), so any language
// saved by an older setup ("auto", "fr", ...) becomes "en": auto detection
// sometimes heard French, Italian or German.
function migratePreferredLanguage() {
  if (!isBrowser) return;
  const stored = localStorage.getItem("preferredLanguage");
  if (stored && stored !== "en") {
    localStorage.setItem("preferredLanguage", "en");
  }
}

migratePreferredLanguage();

// Map the underlying transcription fields to the InferenceMode the Settings
// tabs select on. Single source of truth shared by the provider-settings
// migration and the onboarding "use this provider everywhere" action.
function deriveTranscriptionMode(
  useLocalWhisper: boolean,
  cloudTranscriptionMode: string | null,
  cloudTranscriptionProvider: string | null
): InferenceMode {
  if (useLocalWhisper) return "local";
  if (cloudTranscriptionMode === "byok") {
    return cloudTranscriptionProvider === "custom" ? "self-hosted" : "providers";
  }
  return "providers";
}

// Map the legacy `cloudReasoningMode` + provider pair to the InferenceMode the
// Settings tabs select on. Shared by the provider-settings and agent-mode
// migrations. Distinct from the imported
// deriveReasoningMode(), which collapses local and enterprise into "providers"
// on purpose for the cloud-only "use everywhere" action.
function deriveLegacyReasoningMode(
  cloudMode: string | null,
  provider: string | null
): InferenceMode {
  if (cloudMode !== "byok") return "providers";
  if (provider === "custom") return "self-hosted";
  return "providers";
}

function migrateProviderSettings() {
  if (!isBrowser) return;
  if (localStorage.getItem("_providerSettingsMigrated") === "1") return;

  const cloudMode = localStorage.getItem("cloudTranscriptionMode");
  const useLocal = localStorage.getItem("useLocalWhisper") === "true";
  const provider = localStorage.getItem("cloudTranscriptionProvider");

  const transcriptionMode = deriveTranscriptionMode(useLocal, cloudMode, provider);
  localStorage.setItem("transcriptionMode", transcriptionMode);

  if (provider === "custom" && cloudMode === "byok") {
    localStorage.setItem("remoteTranscriptionType", "openai-compatible");
    const legacyBaseUrl = localStorage.getItem("cloudTranscriptionBaseUrl");
    const existingRemoteUrl = localStorage.getItem("remoteTranscriptionUrl");
    if (!existingRemoteUrl && legacyBaseUrl && legacyBaseUrl !== API_ENDPOINTS.TRANSCRIPTION_BASE) {
      localStorage.setItem("remoteTranscriptionUrl", legacyBaseUrl);
    }
  }

  const reasoningMode = localStorage.getItem("cloudReasoningMode");
  const reasoningProvider = localStorage.getItem("reasoningProvider");
  localStorage.setItem(
    "reasoningMode",
    deriveLegacyReasoningMode(reasoningMode, reasoningProvider)
  );

  if (reasoningProvider === "custom" && reasoningMode === "byok") {
    localStorage.setItem("remoteReasoningType", "openai-compatible");
  }

  localStorage.setItem("_providerSettingsMigrated", "1");
}

migrateProviderSettings();

// One-time seed of the dedicated audio-upload transcription settings. Runs
// after migrateProviderSettings() so the `transcriptionMode` it derives and
// persists is available to copy. Before this context existed the upload page
// used the base dictation settings, so copy each value the user actually set
// into the matching `upload*` key. Fresh installs have no base keys persisted,
// so nothing is copied and the upload context falls through to its defaults.
const UPLOAD_TRANSCRIPTION_PAIRS: ReadonlyArray<[string, string]> = [
  ["useLocalWhisper", "uploadUseLocalWhisper"],
  ["whisperModel", "uploadWhisperModel"],
  ["localTranscriptionProvider", "uploadLocalTranscriptionProvider"],
  ["parakeetModel", "uploadParakeetModel"],
  ["cohereModel", "uploadCohereModel"],
  ["cloudTranscriptionProvider", "uploadCloudTranscriptionProvider"],
  ["cloudTranscriptionModel", "uploadCloudTranscriptionModel"],
  ["cloudTranscriptionBaseUrl", "uploadCloudTranscriptionBaseUrl"],
  ["cloudTranscriptionMode", "uploadCloudTranscriptionMode"],
  ["transcriptionMode", "uploadTranscriptionMode"],
];

function migrateUploadTranscription() {
  if (!isBrowser) return;
  if (localStorage.getItem("uploadTranscriptionMigrated") === "true") return;
  for (const [src, dst] of UPLOAD_TRANSCRIPTION_PAIRS) {
    const v = localStorage.getItem(src);
    if (v !== null) localStorage.setItem(dst, v);
  }
  localStorage.setItem("uploadTranscriptionMigrated", "true");
}

migrateUploadTranscription();

// One-time seed of the upload self-hosted server. These keys arrived after
// migrateUploadTranscription() had latched (1.7.3), and until then the Upload
// tab edited dictation's server (#2049), so copy the values a profile has been
// uploading with; the tab then shows the server it actually uses. Fresh installs
// have nothing to copy, and an upload key the user already set is kept.
const UPLOAD_SELF_HOSTED_PAIRS: ReadonlyArray<[string, string]> = [
  ["remoteTranscriptionUrl", "uploadRemoteTranscriptionUrl"],
  ["remoteTranscriptionModel", "uploadRemoteTranscriptionModel"],
];

function migrateUploadSelfHosted() {
  if (!isBrowser) return;
  if (localStorage.getItem("uploadSelfHostedMigrated") === "true") return;
  for (const [src, dst] of UPLOAD_SELF_HOSTED_PAIRS) {
    if (localStorage.getItem(dst) !== null) continue;
    const v = localStorage.getItem(src);
    if (v !== null) localStorage.setItem(dst, v);
  }
  localStorage.setItem("uploadSelfHostedMigrated", "true");
}

migrateUploadSelfHosted();

// Dictation and upload render `*TranscriptionMode` in their picker but route on
// `*UseLocalWhisper` (audioManager, fileTranscription) and `*CloudTranscriptionMode`,
// so routing can disagree with what the user sees
// (#2086). Must run after the upload one-shot copy, which mirrors the dictation
// keys desync-and-all and then latches.
//
// Never complete either rule symmetrically — it would start uploading audio from
// profiles that exist: the mode-less Settings toggle wrote the local flag alone
// until 6fb0c906, and ProviderSetupStep writes `cloudTranscriptionMode` before the
// commit that derives the mode.
const TRANSCRIPTION_ROUTING_KEYS: ReadonlyArray<{
  mode: keyof SettingsState;
  useLocal: keyof SettingsState;
  cloudMode: keyof SettingsState;
}> = [
  { mode: "transcriptionMode", useLocal: "useLocalWhisper", cloudMode: "cloudTranscriptionMode" },
  {
    mode: "uploadTranscriptionMode",
    useLocal: "uploadUseLocalWhisper",
    cloudMode: "uploadCloudTranscriptionMode",
  },
];

function reconcileTranscriptionRouting(): void {
  if (!isBrowser) return;
  const repaired: string[] = [];
  for (const keys of TRANSCRIPTION_ROUTING_KEYS) {
    const mode = localStorage.getItem(keys.mode);
    if (mode === "local" && localStorage.getItem(keys.useLocal) !== "true") {
      localStorage.setItem(keys.useLocal, "true");
      repaired.push(keys.useLocal);
    }
    // Stored value, not the upload resolver's inherited one: these modes are only
    // derivable when the scope's own cloud key is set, so unset is not a desync.
    if (
      (mode === "providers" || mode === "self-hosted") &&
      localStorage.getItem(keys.cloudMode) !== "byok"
    ) {
      localStorage.setItem(keys.cloudMode, "byok");
      repaired.push(keys.cloudMode);
    }
  }
  if (repaired.length === 0) return;

  logger.info(
    "Repaired transcription routing that disagreed with the selected mode",
    { keys: repaired },
    "settings"
  );
}

reconcileTranscriptionRouting();

function migrateAgentMode() {
  if (!isBrowser) return;
  if (localStorage.getItem("_agentModeMigrated") === "1") return;

  localStorage.setItem(
    "agentInferenceMode",
    deriveLegacyReasoningMode(
      localStorage.getItem("cloudAgentMode"),
      localStorage.getItem("agentProvider")
    )
  );

  localStorage.setItem("_agentModeMigrated", "1");
}

migrateAgentMode();

function migrateCustomPrompts() {
  if (!isBrowser) return;
  if (localStorage.getItem("_promptsMigrated") === "1") return;

  const legacyUnified = localStorage.getItem("customUnifiedPrompt");
  if (legacyUnified) {
    try {
      const parsed = JSON.parse(legacyUnified);
      if (typeof parsed === "string" && parsed.length > 0) {
        if (!localStorage.getItem("customPrompt.cleanup")) {
          localStorage.setItem("customPrompt.cleanup", parsed);
        }
        if (!localStorage.getItem("customPrompt.dictationAgent")) {
          localStorage.setItem("customPrompt.dictationAgent", parsed);
        }
      }
    } catch {}
    localStorage.removeItem("customUnifiedPrompt");
  }

  const legacyChat = localStorage.getItem("agentSystemPrompt");
  if (legacyChat && legacyChat.length > 0 && !localStorage.getItem("customPrompt.chatAgent")) {
    localStorage.setItem("customPrompt.chatAgent", legacyChat);
  }
  if (legacyChat !== null) localStorage.removeItem("agentSystemPrompt");

  localStorage.setItem("_promptsMigrated", "1");
}

migrateCustomPrompts();

// Overrides that byte-match a retired shipped default were persisted defaults,
// not user customizations; clear them so current defaults apply again.
function sweepRetiredCustomPrompts() {
  if (!isBrowser) return;
  void sweepRetiredPromptOverrides(localStorage, PROMPT_KIND_LIST)
    .then((swept) => {
      if (swept.length === 0) return;
      useSettingsStore.setState((s) => ({
        customPrompts: {
          ...s.customPrompts,
          ...Object.fromEntries(swept.map((kind) => [kind, ""])),
        },
      }));
      logger.info("Cleared retired default prompt overrides", { kinds: swept }, "settings");
    })
    .catch((error) => {
      logger.warn(
        "Retired prompt sweep failed",
        { error: error instanceof Error ? error.message : String(error) },
        "settings"
      );
    });
}

sweepRetiredCustomPrompts();

// One-time migration of legacy LLM-scope localStorage keys. Safe to delete
// after a few releases.
const LLM_SCOPE_KEY_PAIRS: ReadonlyArray<[string, string]> = [
  ["reasoningModel", "cleanupModel"],
  ["reasoningProvider", "cleanupProvider"],
  ["reasoningMode", "cleanupMode"],
  ["useReasoningModel", "useCleanupModel"],
  ["cloudReasoningMode", "cleanupCloudMode"],
  ["cloudReasoningBaseUrl", "cleanupCloudBaseUrl"],
  ["customReasoningApiKey", "cleanupCustomApiKey"],
  ["remoteReasoningUrl", "cleanupRemoteUrl"],
  ["agentInferenceMode", "chatAgentMode"],
  ["agentProvider", "chatAgentProvider"],
  ["agentModel", "chatAgentModel"],
  ["cloudAgentMode", "chatAgentCloudMode"],
  ["remoteAgentUrl", "chatAgentRemoteUrl"],
];

function migrateLLMScopeKeys() {
  if (!isBrowser) return;
  if (localStorage.getItem("_llmScopeKeysMigrated") === "1") return;

  for (const [oldKey, newKey] of LLM_SCOPE_KEY_PAIRS) {
    const value = localStorage.getItem(oldKey);
    if (value === null) continue;
    if (localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, value);
    }
    localStorage.removeItem(oldKey);
  }

  localStorage.setItem("_llmScopeKeysMigrated", "1");
}

migrateLLMScopeKeys();

// The Voice Assistant scope shipped unseeded — empty provider and model, mode
// left at its default — while the assistant panel answered on the Chat scope.
// The panel now answers on the Voice Assistant scope, so a profile that never
// configured it (no onboarding fan-out or Settings edit wrote its mode,
// provider or model) copies the Chat scope over once; otherwise a
// profile whose Chat runs local or BYOK would have its spoken commands move to
// the default silently.
const SEEDED_SCOPE_FIELDS = [
  "mode",
  "provider",
  "model",
  "cloudMode",
  "cloudBaseUrl",
  "remoteUrl",
] as const;

function seedDictationAgentScopeFromChat() {
  if (!isBrowser) return;
  if (localStorage.getItem("_dictationAgentSeeded") !== null) return;

  const chat = INFERENCE_SCOPES.chatIntelligence.storeKeys;
  const agent = INFERENCE_SCOPES.dictationAgent.storeKeys;
  const configured = [agent.mode, agent.provider, agent.model].some(
    (key) => localStorage.getItem(key) !== null
  );
  if (configured) {
    localStorage.setItem("_dictationAgentSeeded", "1");
    return;
  }
  for (const field of SEEDED_SCOPE_FIELDS) {
    const value = localStorage.getItem(chat[field] as string);
    if (value !== null) localStorage.setItem(agent[field] as string, value);
  }
  localStorage.setItem("_dictationAgentSeeded", "1");
}

seedDictationAgentScopeFromChat();

export interface SettingsState
  extends
    TranscriptionSettings,
    CleanupSettings,
    HotkeySettings,
    OnboardingSettings,
    MicrophoneSettings,
    ApiKeySettings,
    PrivacySettings,
    ThemeSettings,
    ChatAgentSettings {
  audioCuesEnabled: boolean;
  pauseMediaOnDictation: boolean;
  muteAppsOnDictation: boolean;
  floatingIconAutoHide: boolean;
  startMinimized: boolean;
  panelStartPosition: "bottom-right" | "center" | "bottom-left";
  showTranscriptionPreview: boolean;
  autoPasteEnabled: boolean;
  keepTranscriptionInClipboard: boolean;

  transcriptionMode: InferenceMode;
  remoteTranscriptionType: SelfHostedType;
  remoteTranscriptionUrl: string;
  remoteTranscriptionModel: string;
  cleanupMode: InferenceMode;
  cleanupRemoteUrl: string;

  uploadTranscriptionMode: InferenceMode;
  uploadUseLocalWhisper: boolean;
  uploadWhisperModel: string;
  uploadLocalTranscriptionProvider: LocalTranscriptionProvider;
  uploadParakeetModel: string;
  uploadCohereModel: string;
  uploadCloudTranscriptionProvider: string;
  uploadCloudTranscriptionModel: string;
  uploadCloudTranscriptionBaseUrl: string;
  uploadCloudTranscriptionMode: string;
  uploadRemoteTranscriptionUrl: string;
  uploadRemoteTranscriptionModel: string;

  /** Last model used per scope+provider (`"<context>:<providerId>"`), so switching providers restores it. */
  transcriptionModelByProvider: Record<string, string>;

  dictationAgentMode: InferenceMode;
  dictationAgentProvider: string;
  dictationAgentModel: string;
  dictationAgentCloudMode: string;
  dictationAgentCloudBaseUrl: string;
  dictationAgentRemoteUrl: string;

  // Voice-agent screen context: opt-in screenshot capture, plus an optional
  // dedicated model used only when a screenshot is attached.
  voiceAgentScreenContext: boolean;
  emailDraftTarget: EmailDraftTargetSetting;
  toneStyleEnabled: boolean;
  toneStyles: ToneStyles;
  useDictationAgentVisionModel: boolean;
  dictationAgentVisionMode: InferenceMode;
  dictationAgentVisionProvider: string;
  dictationAgentVisionModel: string;
  dictationAgentVisionCloudMode: string;
  dictationAgentVisionCloudBaseUrl: string;

  cleanupDisableThinking: boolean;
  dictationAgentDisableThinking: boolean;
  dictationAgentVisionDisableThinking: boolean;
  chatAgentDisableThinking: boolean;
  cleanupReasoningEffort: string;
  dictationAgentReasoningEffort: string;
  dictationAgentVisionReasoningEffort: string;
  chatAgentReasoningEffort: string;

  customPrompts: Record<PromptKind, string>;
  setCustomPrompt: (kind: PromptKind, value: string) => void;

  setVoiceAgentScreenContext: (value: boolean) => void;
  setToneStyleEnabled: (value: boolean) => void;
  setToneStyles: (styles: ToneStyles) => void;
  setUseDictationAgentVisionModel: (value: boolean) => void;

  setTranscriptionMode: (mode: InferenceMode) => void;
  setCleanupMode: (mode: InferenceMode) => void;
  setCleanupRemoteUrl: (url: string) => void;

  setUploadTranscriptionMode: (mode: InferenceMode) => void;
  setUploadUseLocalWhisper: (value: boolean) => void;
  setUploadLocalTranscriptionProvider: (value: LocalTranscriptionProvider) => void;
  setUploadCloudTranscriptionProvider: (value: string) => void;
  setUploadCloudTranscriptionModel: (value: string) => void;
  setUploadCloudTranscriptionMode: (value: string) => void;

  setUseLocalWhisper: (value: boolean) => void;
  setWhisperModel: (value: string) => void;
  setLocalTranscriptionProvider: (value: LocalTranscriptionProvider) => void;
  setParakeetModel: (value: string) => void;
  setCohereModel: (value: string) => void;
  setAllowOpenAIFallback: (value: boolean) => void;
  setAllowLocalFallback: (value: boolean) => void;
  setFallbackWhisperModel: (value: string) => void;
  setPreferredLanguage: (value: string) => void;
  setChineseScriptPreference: (value: ChineseScriptPreference) => void;
  setCloudTranscriptionProvider: (value: string) => void;
  setCloudTranscriptionModel: (value: string) => void;
  setCloudTranscriptionBaseUrl: (value: string) => void;
  setCloudTranscriptionMode: (value: string) => void;
  switchCloudTranscriptionProvider: (context: TranscriptionContext, providerId: string) => void;
  setCleanupCloudMode: (value: string) => void;
  setCleanupCloudBaseUrl: (value: string) => void;
  setCustomDictionary: (words: string[]) => void;
  updateCustomDictionary: (changes: { add?: string[]; remove?: string[] }) => void;
  applyCustomDictionaryFromExternal: (words: string[]) => void;
  setSnippets: (snippets: Snippet[]) => void;
  applySnippetsFromExternal: (snippets: Snippet[]) => void;
  setAssemblyAiStreaming: (value: boolean) => void;
  setUseCleanupModel: (value: boolean) => void;
  setUseDictationAgent: (value: boolean) => void;
  setCleanupModel: (value: string) => void;
  setCleanupProvider: (value: string) => void;
  setUiLanguage: (language: string) => void;

  setOpenaiApiKey: (key: string) => void;
  setGroqApiKey: (key: string) => void;
  setXaiApiKey: (key: string) => void;
  setMistralApiKey: (key: string) => void;
  setCortiClientId: (key: string) => void;
  setCortiClientSecret: (key: string) => void;
  setDeepgramApiKey: (key: string) => void;
  setAssemblyaiApiKey: (key: string) => void;
  setCustomTranscriptionApiKey: (key: string) => void;

  // Corti (BYOK)
  cortiEnvironment: string;
  cortiTenant: string;

  setDictationKey: (key: string) => void;
  setVoiceAgentKey: (key: string) => Promise<HotkeyRegistrationResult>;
  setActivationMode: (mode: "tap" | "push") => void;
  setMicrophoneSelectionMode: (mode: MicrophoneSelectionMode) => void;
  setSelectedMicDevice: (deviceId: string, label: string) => void;
  setMicWarmHoldSeconds: (seconds: number) => void;

  setTheme: (value: "light" | "dark" | "auto") => void;
  setFloatingIconAutoHide: (enabled: boolean) => void;
  setMuteAppsOnDictation: (value: boolean) => void;
  setPanelStartPosition: (position: "bottom-right" | "center" | "bottom-left") => void;
  setShowTranscriptionPreview: (value: boolean) => void;

  setChatAgentModel: (value: string) => void;
  setChatAgentProvider: (value: string) => void;
  setChatAgentCloudMode: (value: string) => void;

  updateTranscriptionSettings: (settings: Partial<TranscriptionSettings>) => void;
  setCloudTranscriptionForAllScopes: (settings: Partial<TranscriptionSettings>) => void;
  updateCleanupSettings: (settings: Partial<CleanupSettings>) => void;
  setCloudReasoningForAllScopes: (settings: Partial<CleanupSettings>) => void;
}

function createStringSetter(key: string) {
  return (value: string) => {
    if (isBrowser) localStorage.setItem(key, value);
    useSettingsStore.setState({ [key]: value });
  };
}

function persistTranscriptionModelMemory(memory: Record<string, string>) {
  if (isBrowser) localStorage.setItem("transcriptionModelByProvider", JSON.stringify(memory));
  useSettingsStore.setState({ transcriptionModelByProvider: memory });
}

function readModelMemory(key: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readString(key, "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** Writes a string setting whose key is computed rather than known up front. */
export function setStringSetting(key: keyof SettingsState, value: string): void {
  createStringSetter(key)(value);
}

function createBooleanSetter(key: string) {
  return (value: boolean) => {
    if (isBrowser) localStorage.setItem(key, String(value));
    useSettingsStore.setState({ [key]: value });
  };
}

// Setter for hotkeys that must be registered with the main process before
// being persisted. Rolls back to the previous key if registration fails.
// Resolves to false on failure so optimistic UIs (HotkeyListInput) can revert.
function createRegisteredHotkeySetter(
  key: "voiceAgentKey",
  label: string,
  getRegisterFn: () => ((hotkey: string) => Promise<HotkeyRegistrationResult>) | undefined,
  fallbackSave?: (hotkey: string) => void
) {
  return async (hotkey: string): Promise<HotkeyRegistrationResult> => {
    if (!isBrowser) {
      useSettingsStore.setState({ [key]: hotkey });
      return { success: true };
    }

    const registerFn = getRegisterFn();
    if (!registerFn) {
      localStorage.setItem(key, hotkey);
      useSettingsStore.setState({ [key]: hotkey });
      fallbackSave?.(hotkey);
      return { success: true };
    }

    const previousKey = useSettingsStore.getState()[key];

    try {
      const result = await registerFn(hotkey);
      if (!result?.success) {
        localStorage.setItem(key, previousKey);
        useSettingsStore.setState({ [key]: previousKey });
        logger.warn(`Failed to update ${label}`, { hotkey, message: result?.message }, "settings");
        return { success: false, message: result?.message };
      }

      localStorage.setItem(key, hotkey);
      useSettingsStore.setState({ [key]: hotkey });
      return { success: true };
    } catch (error) {
      logger.warn(
        `Failed to update ${label}`,
        { hotkey, error: error instanceof Error ? error.message : String(error) },
        "settings"
      );
      return { success: false };
    }
  };
}

let envPersistTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPersistToEnv() {
  if (!isBrowser) return;
  if (envPersistTimer) clearTimeout(envPersistTimer);
  envPersistTimer = setTimeout(() => {
    window.electronAPI?.saveAllKeysToEnv?.().catch((err) => {
      logger.warn(
        "Failed to persist API keys to .env",
        { error: (err as Error).message },
        "settings"
      );
    });
  }, 1000);
}

const SECRET_IPC_SAVERS = {
  openai: "saveOpenAIKey",
  groq: "saveGroqKey",
  xai: "saveXaiKey",
  mistral: "saveMistralKey",
  cortiClientId: "saveCortiClientId",
  cortiClientSecret: "saveCortiClientSecret",
  deepgram: "saveDeepgramKey",
  assemblyai: "saveAssemblyAIKey",
  customTranscription: "saveCustomTranscriptionKey",
} as const;

type SecretProvider = keyof typeof SECRET_IPC_SAVERS;

const secretSaveTimers: Partial<Record<SecretProvider, ReturnType<typeof setTimeout>>> = {};
function debouncedSaveSecret(provider: SecretProvider, key: string) {
  if (!isBrowser) return;
  debouncedPersistToEnv();
  const timer = secretSaveTimers[provider];
  if (timer) clearTimeout(timer);
  secretSaveTimers[provider] = setTimeout(() => {
    const api = window.electronAPI;
    const save = api?.[SECRET_IPC_SAVERS[provider]] as
      ((k: string) => Promise<unknown>) | undefined;
    save?.(key)?.catch((err) => {
      logger.warn(
        "Failed to persist secret",
        { provider, error: (err as Error).message },
        "settings"
      );
    });
  }, 250);
}

const STALE_SECRET_LOCALSTORAGE_KEYS = [
  "openaiApiKey",
  "anthropicApiKey",
  "geminiApiKey",
  "groqApiKey",
  "xaiApiKey",
  "mistralApiKey",
  "openrouterApiKey",
  "cortiClientId",
  "cortiClientSecret",
  "cortiApiKey",
  "tinfoilApiKey",
  "deepgramApiKey",
  "assemblyaiApiKey",
  "customTranscriptionApiKey",
  "customReasoningApiKey",
  "cleanupCustomApiKey",
  "noteFormattingCustomApiKey",
  "dictationAgentCustomApiKey",
  "dictationAgentVisionCustomApiKey",
  "chatAgentCustomApiKey",
  "bedrockAccessKeyId",
  "bedrockSecretAccessKey",
  "bedrockSessionToken",
  "azureApiKey",
  "vertexApiKey",
] as const;

function invalidateApiKeyCaches(provider?: string) {
  if (_ReasoningService) {
    _ReasoningService.clearApiKeyCache(provider);
  } else {
    import("../services/ReasoningService")
      .then((mod) => {
        _ReasoningService = mod.default;
        _ReasoningService.clearApiKeyCache(provider);
      })
      .catch(() => {});
  }
  if (isBrowser) window.dispatchEvent(new Event("api-key-changed"));
}

// Uniform BYOK key setter: persist to the secure store (debounced) and clear
// the provider's cached key, or all caches when no scoped provider is given.
function createSecretSetter(
  storeKey: string,
  saver: SecretProvider,
  cacheProvider?: Parameters<typeof invalidateApiKeyCaches>[0]
) {
  return (key: string) => {
    useSettingsStore.setState({ [storeKey]: key });
    debouncedSaveSecret(saver, key);
    invalidateApiKeyCaches(cacheProvider);
  };
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  uiLanguage: normalizeUiLanguage(
    isBrowser ? localStorage.getItem("uiLanguage") || i18n.language : null
  ),
  useLocalWhisper: readBoolean("useLocalWhisper", false),
  whisperModel: readString("whisperModel", "base"),
  localTranscriptionProvider: readLocalProvider("localTranscriptionProvider"),
  parakeetModel: readString("parakeetModel", ""),
  cohereModel: readString("cohereModel", DEFAULT_COHERE_MODEL),
  allowOpenAIFallback: readBoolean("allowOpenAIFallback", false),
  allowLocalFallback: readBoolean("allowLocalFallback", false),
  fallbackWhisperModel: readString("fallbackWhisperModel", "base"),
  preferredLanguage: readString("preferredLanguage", "en"),
  chineseScriptPreference: normalizeChineseScriptPreference(
    readString("chineseScriptPreference", "as-transcribed")
  ),
  cloudTranscriptionProvider: readString(
    "cloudTranscriptionProvider",
    DEFAULT_CLOUD_TRANSCRIPTION_PROVIDER
  ),
  cloudTranscriptionModel: readString("cloudTranscriptionModel", "gpt-4o-mini-transcribe"),
  cloudTranscriptionBaseUrl: readString(
    "cloudTranscriptionBaseUrl",
    API_ENDPOINTS.TRANSCRIPTION_BASE
  ),
  transcriptionModelByProvider: readModelMemory("transcriptionModelByProvider"),
  cloudTranscriptionMode: readString("cloudTranscriptionMode", "byok"),
  cleanupCloudMode: readString("cleanupCloudMode", "byok"),
  cleanupCloudBaseUrl: readString("cleanupCloudBaseUrl", API_ENDPOINTS.OPENAI_BASE),
  cortiEnvironment: readString("cortiEnvironment", "us"),
  cortiTenant: readString("cortiTenant", "base"),
  customDictionary: readStringArray("customDictionary", []),
  snippets: (() => {
    try {
      const parsed = JSON.parse(readString("snippets", "[]"));
      return Array.isArray(parsed) ? (parsed as Snippet[]) : [];
    } catch {
      return [];
    }
  })(),
  assemblyAiStreaming: readBoolean("assemblyAiStreaming", true),

  useCleanupModel: readBoolean("useCleanupModel", true),
  useDictationAgent: readBoolean("useDictationAgent", true),
  cleanupModel: readString("cleanupModel", ""),
  cleanupProvider: readString("cleanupProvider", "openai"),

  // Secrets hydrate from main process in initializeSettings, never from localStorage.
  openaiApiKey: "",
  groqApiKey: "",
  xaiApiKey: "",
  mistralApiKey: "",
  cortiClientId: "",
  cortiClientSecret: "",
  deepgramApiKey: "",
  assemblyaiApiKey: "",
  customTranscriptionApiKey: "",

  dictationKey: readString("dictationKey", ""),
  activeDictationKey: null,
  voiceAgentKey: readString("voiceAgentKey", ""),
  onboardingUseCases: readStringArray("onboardingUseCases", []),
  onboardingUseCaseNote: readString("onboardingUseCaseNote", ""),
  spokenLanguages: readStringArray("spokenLanguages", []),
  activationMode: (readString("activationMode", "tap") === "push" ? "push" : "tap") as
    "tap" | "push",

  microphoneSelectionMode: (() => {
    const mode = readString("microphoneSelectionMode", "system");
    return (
      mode === "built-in" || mode === "specific" ? mode : "system"
    ) as MicrophoneSelectionMode;
  })(),
  preferBuiltInMic: readBoolean("preferBuiltInMic", false),
  selectedMicDeviceId: readString("selectedMicDeviceId", ""),
  selectedMicDeviceLabel: readString("selectedMicDeviceLabel", ""),
  micWarmHoldSeconds: snapMicWarmHold(readNumber("micWarmHoldSeconds", 0)),

  theme: (() => {
    const v = readString("theme", "auto");
    if (v === "light" || v === "dark" || v === "auto") return v;
    return "auto" as const;
  })(),
  cloudBackupEnabled: readBoolean("cloudBackupEnabled", false),
  insightsSyncEnabled: readBoolean("insightsSyncEnabled", false),
  telemetryEnabled: readBoolean("telemetryEnabled", false),
  audioRetentionDays: readNumber("audioRetentionDays", 30),
  transcriptRetentionDays: readNumber("transcriptRetentionDays", 0),
  dataRetentionEnabled: readBoolean("dataRetentionEnabled", true),
  saveDiscardedTranscriptions: readBoolean("saveDiscardedTranscriptions", false),
  audioCuesEnabled: readBoolean("audioCuesEnabled", true),
  pauseMediaOnDictation: readBoolean("pauseMediaOnDictation", false),
  muteAppsOnDictation: readBoolean("muteAppsOnDictation", true),
  // only-whispers shows the pill only while dictating unless "Always visible" is on.
  floatingIconAutoHide: readBoolean("floatingIconAutoHide", true),
  startMinimized: readBoolean("startMinimized", false),
  panelStartPosition: (() => {
    const v = readString("panelStartPosition", "center");
    if (v === "bottom-right" || v === "center" || v === "bottom-left") return v;
    return "center" as const;
  })(),
  showTranscriptionPreview: readBoolean("showTranscriptionPreview", false),
  autoPasteEnabled: readBoolean("autoPasteEnabled", true),
  keepTranscriptionInClipboard: readBoolean("keepTranscriptionInClipboard", false),

  transcriptionMode: (() => {
    const v = readString("transcriptionMode", "providers");
    if (v === "providers" || v === "local" || v === "self-hosted") return v;
    return "providers" as InferenceMode;
  })(),
  remoteTranscriptionType: (() => {
    const v = readString("remoteTranscriptionType", "lan");
    return v === "openai-compatible" ? "openai-compatible" : ("lan" as SelfHostedType);
  })(),
  remoteTranscriptionUrl: readString("remoteTranscriptionUrl", ""),
  remoteTranscriptionModel: readString("remoteTranscriptionModel", ""),
  cleanupMode: (() => {
    const v = readString("cleanupMode", "providers");
    if (v === "providers" || v === "local" || v === "self-hosted" || v === "enterprise") return v;
    return "providers" as InferenceMode;
  })(),
  cleanupRemoteUrl: readString("cleanupRemoteUrl", ""),

  uploadTranscriptionMode: (() => {
    const v = readString("uploadTranscriptionMode", "providers");
    if (v === "providers" || v === "local" || v === "self-hosted") return v;
    return "providers" as InferenceMode;
  })(),
  uploadUseLocalWhisper: readBoolean("uploadUseLocalWhisper", false),
  uploadWhisperModel: readString("uploadWhisperModel", ""),
  uploadLocalTranscriptionProvider: readScopedLocalProvider("uploadLocalTranscriptionProvider"),
  uploadParakeetModel: readString("uploadParakeetModel", ""),
  uploadCohereModel: readString("uploadCohereModel", ""),
  uploadCloudTranscriptionProvider: readString("uploadCloudTranscriptionProvider", ""),
  uploadCloudTranscriptionModel: readString("uploadCloudTranscriptionModel", ""),
  uploadCloudTranscriptionBaseUrl: readString("uploadCloudTranscriptionBaseUrl", ""),
  uploadCloudTranscriptionMode: readString("uploadCloudTranscriptionMode", ""),
  uploadRemoteTranscriptionUrl: readString("uploadRemoteTranscriptionUrl", ""),
  uploadRemoteTranscriptionModel: readString("uploadRemoteTranscriptionModel", ""),

  setTranscriptionMode: createStringSetter("transcriptionMode") as (mode: InferenceMode) => void,
  setCleanupMode: createStringSetter("cleanupMode") as (mode: InferenceMode) => void,
  setCleanupRemoteUrl: createStringSetter("cleanupRemoteUrl"),

  setUploadTranscriptionMode: createStringSetter("uploadTranscriptionMode") as (
    mode: InferenceMode
  ) => void,
  setUploadUseLocalWhisper: createBooleanSetter("uploadUseLocalWhisper"),
  setUploadLocalTranscriptionProvider: (value: LocalTranscriptionProvider) => {
    if (isBrowser) localStorage.setItem("uploadLocalTranscriptionProvider", value);
    useSettingsStore.setState({ uploadLocalTranscriptionProvider: value });
  },
  setUploadCloudTranscriptionProvider: createStringSetter("uploadCloudTranscriptionProvider"),
  setUploadCloudTranscriptionModel: createStringSetter("uploadCloudTranscriptionModel"),
  setUploadCloudTranscriptionMode: createStringSetter("uploadCloudTranscriptionMode"),

  chatAgentModel: readString("chatAgentModel", "gpt-6-luna"),
  chatAgentProvider: readString("chatAgentProvider", "openai"),
  chatAgentCloudMode: readString("chatAgentCloudMode", "byok"),
  chatAgentMode: (() => {
    const v = readString("chatAgentMode", "providers");
    if (v === "providers" || v === "local" || v === "self-hosted" || v === "enterprise") return v;
    return "providers" as InferenceMode;
  })(),
  chatAgentRemoteUrl: readString("chatAgentRemoteUrl", ""),
  chatAgentCloudBaseUrl: readString("chatAgentCloudBaseUrl", ""),

  dictationAgentMode: (() => {
    const v = readString("dictationAgentMode", "providers");
    if (v === "providers" || v === "local" || v === "self-hosted" || v === "enterprise") return v;
    return "providers" as InferenceMode;
  })(),
  dictationAgentProvider: readString("dictationAgentProvider", ""),
  dictationAgentModel: readString("dictationAgentModel", ""),
  dictationAgentCloudMode: readString("dictationAgentCloudMode", "byok"),
  dictationAgentCloudBaseUrl: readString("dictationAgentCloudBaseUrl", ""),
  dictationAgentRemoteUrl: readString("dictationAgentRemoteUrl", ""),

  voiceAgentScreenContext: readBoolean("voiceAgentScreenContext", false),
  emailDraftTarget: normalizeEmailDraftTarget(readString("emailDraftTarget", "auto")),
  toneStyleEnabled: readBoolean("toneStyleEnabled", false),
  toneStyles: normalizeToneStyles(readString("toneStyles", "")),
  useDictationAgentVisionModel: readBoolean("useDictationAgentVisionModel", false),
  // Cloud already vision-routes screenshot commands, so the override is BYOK-only.
  dictationAgentVisionMode: "providers" as InferenceMode,
  dictationAgentVisionProvider: readString("dictationAgentVisionProvider", ""),
  dictationAgentVisionModel: readString("dictationAgentVisionModel", ""),
  dictationAgentVisionCloudMode: readString("dictationAgentVisionCloudMode", "byok"),
  dictationAgentVisionCloudBaseUrl: readString("dictationAgentVisionCloudBaseUrl", ""),

  cleanupDisableThinking: readBoolean("cleanupDisableThinking", true),
  dictationAgentDisableThinking: readBoolean("dictationAgentDisableThinking", true),
  dictationAgentVisionDisableThinking: readBoolean("dictationAgentVisionDisableThinking", true),
  chatAgentDisableThinking: readBoolean("chatAgentDisableThinking", true),
  cleanupReasoningEffort: readString("cleanupReasoningEffort", ""),
  dictationAgentReasoningEffort: readString("dictationAgentReasoningEffort", ""),
  dictationAgentVisionReasoningEffort: readString("dictationAgentVisionReasoningEffort", ""),
  chatAgentReasoningEffort: readString("chatAgentReasoningEffort", ""),

  customPrompts: PROMPT_KIND_LIST.reduce(
    (acc, kind) => ({ ...acc, [kind]: readString(`customPrompt.${kind}`, "") }),
    {} as Record<PromptKind, string>
  ),
  setCustomPrompt: (kind, value) => {
    if (isBrowser) localStorage.setItem(`customPrompt.${kind}`, value);
    useSettingsStore.setState((s) => ({
      customPrompts: { ...s.customPrompts, [kind]: value },
    }));
  },

  setVoiceAgentScreenContext: createBooleanSetter("voiceAgentScreenContext"),
  setToneStyleEnabled: createBooleanSetter("toneStyleEnabled"),
  setToneStyles: (styles) => {
    if (isBrowser) localStorage.setItem("toneStyles", JSON.stringify(styles));
    useSettingsStore.setState({ toneStyles: styles });
  },
  setUseDictationAgentVisionModel: createBooleanSetter("useDictationAgentVisionModel"),

  setUseLocalWhisper: createBooleanSetter("useLocalWhisper"),
  setWhisperModel: createStringSetter("whisperModel"),
  setLocalTranscriptionProvider: (value: LocalTranscriptionProvider) => {
    if (isBrowser) localStorage.setItem("localTranscriptionProvider", value);
    set({ localTranscriptionProvider: value });
  },
  setParakeetModel: createStringSetter("parakeetModel"),
  setCohereModel: createStringSetter("cohereModel"),
  setAllowOpenAIFallback: createBooleanSetter("allowOpenAIFallback"),
  setAllowLocalFallback: createBooleanSetter("allowLocalFallback"),
  setFallbackWhisperModel: createStringSetter("fallbackWhisperModel"),
  setPreferredLanguage: createStringSetter("preferredLanguage"),
  setChineseScriptPreference: (value: ChineseScriptPreference) =>
    createStringSetter("chineseScriptPreference")(normalizeChineseScriptPreference(value)),
  setCloudTranscriptionProvider: createStringSetter("cloudTranscriptionProvider"),
  setCloudTranscriptionModel: createStringSetter("cloudTranscriptionModel"),
  setCloudTranscriptionBaseUrl: createStringSetter("cloudTranscriptionBaseUrl"),

  // Every provider shares one model slot per scope, so a plain provider write
  // destroys the outgoing provider's model (the "Parasail" wipe). This setter
  // remembers the outgoing model and restores the incoming provider's last one.
  switchCloudTranscriptionProvider: (context, providerId) => {
    const s = useSettingsStore.getState();
    const keys = TRANSCRIPTION_CONTEXT_KEYS.find((entry) => entry.context === context);
    if (!keys) return;
    // Upload raw keys default to "" (inherit from dictation), so work
    // against resolved values. Restoring writes a concrete model — the scope
    // stops inheriting the dictation model from that point on.
    const outgoingProvider = (s[keys.provider] as string) || s.cloudTranscriptionProvider;
    if (outgoingProvider === providerId) {
      setStringSetting(keys.provider, providerId);
      return;
    }
    const outgoingModel = (s[keys.model] as string) || s.cloudTranscriptionModel;
    const memory = { ...s.transcriptionModelByProvider };
    if (outgoingProvider && outgoingModel) {
      memory[`${context}:${outgoingProvider}`] = outgoingModel;
      persistTranscriptionModelMemory(memory);
    }
    const remembered = memory[`${context}:${providerId}`];
    setStringSetting(keys.provider, providerId);
    setStringSetting(
      keys.model,
      remembered && transcriptionModelBelongsToProvider(providerId, remembered)
        ? remembered
        : defaultTranscriptionModel(providerId)
    );
  },
  setCloudTranscriptionMode: createStringSetter("cloudTranscriptionMode"),
  setCleanupCloudMode: createStringSetter("cleanupCloudMode"),
  setCleanupCloudBaseUrl: createStringSetter("cleanupCloudBaseUrl"),
  setAssemblyAiStreaming: createBooleanSetter("assemblyAiStreaming"),
  setUseCleanupModel: createBooleanSetter("useCleanupModel"),
  setUseDictationAgent: createBooleanSetter("useDictationAgent"),
  setCleanupProvider: createStringSetter("cleanupProvider"),
  setCleanupModel: createStringSetter("cleanupModel"),

  // Replaces the whole dictionary: anything absent from `words` is deleted.
  // Editing specific words wants updateCustomDictionary instead (#1295).
  setCustomDictionary: (words: string[]) => {
    if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(words));
    set({ customDictionary: words });
    window.electronAPI?.setDictionary(words).catch((err) => {
      logger.warn(
        "Failed to sync dictionary to SQLite",
        { error: (err as Error).message },
        "settings"
      );
    });
  },

  updateCustomDictionary: ({ add = [], remove = [] }) => {
    const removeLower = new Set(remove.map((w) => w.toLowerCase()));
    const addLower = new Set(add.map((w) => w.toLowerCase()));
    // Optimistic so the UI updates immediately; the stored list replaces it below.
    const optimistic = [
      ...get().customDictionary.filter((w) => {
        const lower = w.toLowerCase();
        return !removeLower.has(lower) && !addLower.has(lower);
      }),
      ...add,
    ];
    if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(optimistic));
    set({ customDictionary: optimistic });

    const api = window.electronAPI;
    if (!api) return;
    // Older preloads have no delta channel; fall back rather than drop the edit.
    const written = api.applyDictionaryChanges
      ? api.applyDictionaryChanges({ add, remove })
      : api.setDictionary(optimistic);

    written
      .then(async () => {
        // SQLite owns ordering, casing and dedupe — adopt what it stored.
        const stored = await api.getDictionary?.();
        if (stored) {
          if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(stored));
          set({ customDictionary: stored });
        }
      })
      .catch((err) => {
        logger.warn(
          "Failed to apply dictionary changes to SQLite",
          { error: (err as Error).message },
          "settings"
        );
      });
  },

  // For broadcasts from main process — DB is already authoritative, only update UI.
  applyCustomDictionaryFromExternal: (words: string[]) => {
    if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(words));
    set({ customDictionary: words });
  },

  setSnippets: (snippets: Snippet[]) => {
    if (isBrowser) localStorage.setItem("snippets", JSON.stringify(snippets));
    set({ snippets });
    window.electronAPI?.setSnippets?.(snippets).catch((err) => {
      logger.warn(
        "Failed to sync snippets to SQLite",
        { error: (err as Error).message },
        "settings"
      );
    });
  },

  // For broadcasts from main process — DB is already authoritative, only update UI.
  applySnippetsFromExternal: (snippets: Snippet[]) => {
    if (isBrowser) localStorage.setItem("snippets", JSON.stringify(snippets));
    set({ snippets });
  },

  setUiLanguage: (language: string) => {
    const normalized = normalizeUiLanguage(language);
    if (isBrowser) localStorage.setItem("uiLanguage", normalized);
    set({ uiLanguage: normalized });
    void i18n.changeLanguage(normalized);
    if (isBrowser && window.electronAPI?.setUiLanguage) {
      window.electronAPI.setUiLanguage(normalized).catch((err) => {
        logger.warn(
          "Failed to sync UI language to main process",
          { error: (err as Error).message },
          "settings"
        );
      });
    }
  },

  setOpenaiApiKey: createSecretSetter("openaiApiKey", "openai", "openai"),
  setGroqApiKey: createSecretSetter("groqApiKey", "groq", "groq"),
  setXaiApiKey: createSecretSetter("xaiApiKey", "xai"),
  setMistralApiKey: createSecretSetter("mistralApiKey", "mistral", "mistral"),
  setCortiClientId: (key: string) => {
    set({ cortiClientId: key });
    debouncedSaveSecret("cortiClientId", key);
    invalidateApiKeyCaches("corti");
  },
  setCortiClientSecret: (key: string) => {
    set({ cortiClientSecret: key });
    debouncedSaveSecret("cortiClientSecret", key);
    invalidateApiKeyCaches("corti");
  },
  // STT-only, so there is no ReasoningService key cache to invalidate.
  setDeepgramApiKey: createSecretSetter("deepgramApiKey", "deepgram"),
  setAssemblyaiApiKey: createSecretSetter("assemblyaiApiKey", "assemblyai"),
  setCustomTranscriptionApiKey: (key: string) => {
    set({ customTranscriptionApiKey: key });
    debouncedSaveSecret("customTranscription", key);
    invalidateApiKeyCaches("custom");
  },
  setDictationKey: (key: string) => {
    if (isBrowser) localStorage.setItem("dictationKey", key);
    set({ dictationKey: key });
    if (isBrowser) {
      window.electronAPI?.notifyHotkeyChanged?.(key);
      window.electronAPI?.saveDictationKey?.(key);
    }
  },
  setVoiceAgentKey: createRegisteredHotkeySetter(
    "voiceAgentKey",
    "voice agent hotkey",
    () => window.electronAPI?.updateVoiceAgentHotkey
  ),

  setActivationMode: (mode: "tap" | "push") => {
    if (isBrowser) localStorage.setItem("activationMode", mode);
    set({ activationMode: mode });
    if (isBrowser) {
      window.electronAPI?.notifyActivationModeChanged?.(mode);
    }
  },
  setMicrophoneSelectionMode: (mode: MicrophoneSelectionMode) => {
    const normalized: MicrophoneSelectionMode =
      mode === "built-in" || mode === "specific" ? mode : "system";
    const preferBuiltInMic = normalized === "built-in";
    if (isBrowser) {
      localStorage.setItem("microphoneSelectionMode", normalized);
      localStorage.setItem("preferBuiltInMic", String(preferBuiltInMic));
    }
    set({ microphoneSelectionMode: normalized, preferBuiltInMic });
  },
  setSelectedMicDevice: (deviceId: string, label: string) => {
    if (isBrowser) {
      localStorage.setItem("selectedMicDeviceLabel", label);
      localStorage.setItem("selectedMicDeviceId", deviceId);
    }
    set({ selectedMicDeviceId: deviceId, selectedMicDeviceLabel: label });
  },

  setTheme: (value: "light" | "dark" | "auto") => {
    if (isBrowser) localStorage.setItem("theme", value);
    set({ theme: value });
  },
  setMicWarmHoldSeconds: (value: number) => {
    const snapped = snapMicWarmHold(value);
    if (isBrowser) localStorage.setItem("micWarmHoldSeconds", String(snapped));
    set({ micWarmHoldSeconds: snapped });
  },

  setFloatingIconAutoHide: (enabled: boolean) => {
    if (get().floatingIconAutoHide === enabled) return;
    if (isBrowser) localStorage.setItem("floatingIconAutoHide", String(enabled));
    set({ floatingIconAutoHide: enabled });
    if (isBrowser) {
      window.electronAPI?.notifyFloatingIconAutoHideChanged?.(enabled);
    }
  },
  setMuteAppsOnDictation: createBooleanSetter("muteAppsOnDictation"),
  setPanelStartPosition: (position: "bottom-right" | "center" | "bottom-left") => {
    if (get().panelStartPosition === position) return;
    if (isBrowser) localStorage.setItem("panelStartPosition", position);
    set({ panelStartPosition: position });
    if (isBrowser) {
      window.electronAPI?.notifyPanelStartPositionChanged?.(position);
    }
  },

  setShowTranscriptionPreview: createBooleanSetter("showTranscriptionPreview"),

  setChatAgentModel: createStringSetter("chatAgentModel"),
  setChatAgentProvider: createStringSetter("chatAgentProvider"),
  setChatAgentCloudMode: createStringSetter("chatAgentCloudMode"),

  updateTranscriptionSettings: (settings: Partial<TranscriptionSettings>) => {
    const s = useSettingsStore.getState();
    if (settings.useLocalWhisper !== undefined) s.setUseLocalWhisper(settings.useLocalWhisper);
    if (settings.uiLanguage !== undefined) s.setUiLanguage(settings.uiLanguage);
    if (settings.whisperModel !== undefined) s.setWhisperModel(settings.whisperModel);
    if (settings.localTranscriptionProvider !== undefined)
      s.setLocalTranscriptionProvider(settings.localTranscriptionProvider);
    if (settings.parakeetModel !== undefined) s.setParakeetModel(settings.parakeetModel);
    if (settings.cohereModel !== undefined) s.setCohereModel(settings.cohereModel);
    if (settings.allowOpenAIFallback !== undefined)
      s.setAllowOpenAIFallback(settings.allowOpenAIFallback);
    if (settings.allowLocalFallback !== undefined)
      s.setAllowLocalFallback(settings.allowLocalFallback);
    if (settings.fallbackWhisperModel !== undefined)
      s.setFallbackWhisperModel(settings.fallbackWhisperModel);
    if (settings.preferredLanguage !== undefined)
      s.setPreferredLanguage(settings.preferredLanguage);
    if (settings.chineseScriptPreference !== undefined)
      s.setChineseScriptPreference(settings.chineseScriptPreference);
    if (settings.cloudTranscriptionProvider !== undefined)
      s.setCloudTranscriptionProvider(settings.cloudTranscriptionProvider);
    if (settings.cloudTranscriptionModel !== undefined)
      s.setCloudTranscriptionModel(settings.cloudTranscriptionModel);
    if (settings.cloudTranscriptionBaseUrl !== undefined)
      s.setCloudTranscriptionBaseUrl(settings.cloudTranscriptionBaseUrl);
    if (settings.cloudTranscriptionMode !== undefined)
      s.setCloudTranscriptionMode(settings.cloudTranscriptionMode);
    if (settings.customDictionary !== undefined) s.setCustomDictionary(settings.customDictionary);
    if (settings.snippets !== undefined) s.setSnippets(settings.snippets);
    if (settings.assemblyAiStreaming !== undefined)
      s.setAssemblyAiStreaming(settings.assemblyAiStreaming);
    if (settings.showTranscriptionPreview !== undefined)
      s.setShowTranscriptionPreview(settings.showTranscriptionPreview);
  },

  // Apply a transcription config to dictation, then mirror its cloud routing to
  // audio upload — used when onboarding picks one provider
  // for everything (e.g. Corti for medical providers).
  setCloudTranscriptionForAllScopes: (settings: Partial<TranscriptionSettings>) => {
    const s = useSettingsStore.getState();
    s.updateTranscriptionSettings(settings);
    const {
      useLocalWhisper,
      localTranscriptionProvider,
      cloudTranscriptionMode,
      cloudTranscriptionProvider,
      cloudTranscriptionModel,
    } = useSettingsStore.getState();
    // Each Settings tab selects on its InferenceMode field, so set it for every
    // scope — otherwise the UI keeps showing the previous mode even though the
    // cloud routing now points at the new provider.
    const mode = deriveTranscriptionMode(
      useLocalWhisper,
      cloudTranscriptionMode,
      cloudTranscriptionProvider
    );
    s.setTranscriptionMode(mode);
    s.setUploadTranscriptionMode(mode);
    s.setUploadUseLocalWhisper(useLocalWhisper);
    s.setUploadLocalTranscriptionProvider(localTranscriptionProvider);
    s.setUploadCloudTranscriptionMode(cloudTranscriptionMode);
    s.setUploadCloudTranscriptionProvider(cloudTranscriptionProvider);
    s.setUploadCloudTranscriptionModel(cloudTranscriptionModel);
    // Seed the per-provider model memory so a later provider switch-and-return
    // in any scope restores the model onboarding chose.
    if (cloudTranscriptionProvider && cloudTranscriptionModel) {
      const memory = { ...useSettingsStore.getState().transcriptionModelByProvider };
      for (const { context } of TRANSCRIPTION_CONTEXT_KEYS) {
        memory[`${context}:${cloudTranscriptionProvider}`] = cloudTranscriptionModel;
      }
      persistTranscriptionModelMemory(memory);
    }
  },

  updateCleanupSettings: (settings: Partial<CleanupSettings>) => {
    const s = useSettingsStore.getState();
    if (settings.useCleanupModel !== undefined) s.setUseCleanupModel(settings.useCleanupModel);
    if (settings.useDictationAgent !== undefined)
      s.setUseDictationAgent(settings.useDictationAgent);
    if (settings.cleanupModel !== undefined) s.setCleanupModel(settings.cleanupModel);
    if (settings.cleanupProvider !== undefined) s.setCleanupProvider(settings.cleanupProvider);
    if (settings.cleanupCloudBaseUrl !== undefined)
      s.setCleanupCloudBaseUrl(settings.cleanupCloudBaseUrl);
    if (settings.cleanupCloudMode !== undefined) s.setCleanupCloudMode(settings.cleanupCloudMode);
    if (settings.cleanupRemoteUrl !== undefined) s.setCleanupRemoteUrl(settings.cleanupRemoteUrl);
  },

  // Apply a cleanup config to dictation, then mirror its cloud routing to the
  // other three LLM scopes — used when onboarding routes every reasoning scope to
  // one provider so PHI never reaches a second LLM (e.g. Corti for medical providers).
  setCloudReasoningForAllScopes: (settings) => {
    const s = useSettingsStore.getState();
    // Derive the mode from the incoming patch (falling back to current state) so
    // the helper patches are the single source of truth for every scope's mode.
    const mode = deriveReasoningMode(
      settings.cleanupCloudMode ?? s.cleanupCloudMode,
      settings.cleanupProvider ?? s.cleanupProvider
    );
    const { dictationCleanup, ...mirrored } = buildReasoningScopePatches(settings, mode);
    s.updateCleanupSettings(dictationCleanup);
    s.setCleanupMode(dictationCleanup.cleanupMode);
    // Each Settings tab selects on its own mode field, so every scope gets the
    // mode even when the routing fields are absent — otherwise the tab keeps
    // showing the previous provider despite the new cloud routing.
    for (const [scope, patch] of Object.entries(mirrored)) {
      setResolvedLLMConfig(scope as InferenceScope, patch);
    }
  },
}));

// --- Selectors (derived state, not stored) ---

export interface ResolvedLLMConfig {
  scope: InferenceScope;
  mode: InferenceMode;
  provider: string;
  model: string;
  cloudMode?: string;
  cloudBaseUrl?: string;
  remoteUrl?: string;
  disableThinking: boolean;
  reasoningEffort?: string;
}

export const selectResolvedLLMConfig = (
  state: SettingsState,
  scope: InferenceScope
): ResolvedLLMConfig => {
  const def: InferenceScopeDefinition = INFERENCE_SCOPES[scope];
  const fallback = def.fallbackScope
    ? selectResolvedLLMConfig(state, def.fallbackScope as InferenceScope)
    : undefined;

  const read = (field: keyof InferenceScopeStoreKeys): string | undefined => {
    const key = def.storeKeys[field];
    if (!key) return undefined;
    return (state[key] as string | undefined) || undefined;
  };

  const disableThinkingKey = def.storeKeys.disableThinking;
  const disableThinking = disableThinkingKey ? (state[disableThinkingKey] as boolean) : true;

  const localConfig: ResolvedLLMConfig = {
    scope,
    mode: state[def.storeKeys.mode] as InferenceMode,
    provider: read("provider") || fallback?.provider || "",
    model: read("model") || fallback?.model || "",
    cloudMode: read("cloudMode") || fallback?.cloudMode,
    cloudBaseUrl: read("cloudBaseUrl") || fallback?.cloudBaseUrl,
    remoteUrl: read("remoteUrl") || fallback?.remoteUrl,
    disableThinking,
    reasoningEffort: read("reasoningEffort"),
  };
  return localConfig;
};

export function setResolvedLLMConfig(
  scope: InferenceScope,
  patch: Partial<Omit<ResolvedLLMConfig, "scope">>
): void {
  const def: InferenceScopeDefinition = INFERENCE_SCOPES[scope];
  const updates: Partial<SettingsState> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const storeKey = def.storeKeys[field as keyof InferenceScopeStoreKeys];
    if (!storeKey) continue;
    if (isBrowser) {
      localStorage.setItem(
        storeKey as string,
        typeof value === "boolean" ? String(value) : (value as string)
      );
    }
    (updates as Record<string, unknown>)[storeKey as string] = value;
  }
  if (Object.keys(updates).length > 0) useSettingsStore.setState(updates);
}

// --- Convenience getters for non-React code ---

interface TranscriptionContextKeys {
  context: TranscriptionContext;
  mode: keyof SettingsState;
  useLocal: keyof SettingsState;
  cloudMode: keyof SettingsState;
  provider: keyof SettingsState;
  model: keyof SettingsState;
  baseUrl: keyof SettingsState;
}

const TRANSCRIPTION_CONTEXT_KEYS: readonly TranscriptionContextKeys[] = [
  {
    context: "dictation",
    mode: "transcriptionMode",
    useLocal: "useLocalWhisper",
    cloudMode: "cloudTranscriptionMode",
    provider: "cloudTranscriptionProvider",
    model: "cloudTranscriptionModel",
    baseUrl: "cloudTranscriptionBaseUrl",
  },
  {
    context: "upload",
    mode: "uploadTranscriptionMode",
    useLocal: "uploadUseLocalWhisper",
    cloudMode: "uploadCloudTranscriptionMode",
    provider: "uploadCloudTranscriptionProvider",
    model: "uploadCloudTranscriptionModel",
    baseUrl: "uploadCloudTranscriptionBaseUrl",
  },
];

export function getSettings(): SettingsState {
  return useSettingsStore.getState();
}

/**
 * Repoints any scope still selecting a cloud model the registry no longer ships
 * at that provider's current default — otherwise every request 404s with an
 * error the user can't act on.
 */
export function reconcileRetiredCloudModelSelections(): void {
  const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
  for (const scope of Object.values(INFERENCE_SCOPES)) {
    if (!usesCloudModelCatalog(state[scope.storeKeys.mode])) continue;
    const provider = state[scope.storeKeys.provider] as string;
    const model = state[scope.storeKeys.model] as string;
    if (!provider || !model) continue;
    const providerDef = modelRegistryData.cloudProviders.find((p) => p.id === provider);
    if (!providerDef || reasoningModelBelongsToProvider(provider, model)) continue;
    const replacement = pickDefaultModelId(providerDef);
    if (!replacement) continue;
    setStringSetting(scope.storeKeys.model as keyof SettingsState, replacement);
    logger.info(
      "Repointed retired cloud model selection",
      { scope: scope.storeKeys.model, from: model, to: replacement },
      "settings"
    );
  }
}

export function getEffectiveCleanupModel() {
  return selectResolvedLLMConfig(getSettings(), "dictationCleanup").model;
}

// --- Initialization ---

let hasInitialized = false;

export async function initializeSettings(): Promise<void> {
  if (hasInitialized) return;
  hasInitialized = true;

  if (!isBrowser) return;

  const state = useSettingsStore.getState();
  let hydratingSecrets = true;
  const pendingSecretUpdates = new Set<string>();

  // Queue updates until hydration can no longer overwrite them.
  const refreshApiKey = async (storeKey: string) => {
    if (!STALE_SECRET_LOCALSTORAGE_KEYS.some((key) => key === storeKey)) return;
    if (hydratingSecrets) {
      pendingSecretUpdates.add(storeKey);
      return;
    }
    const saver =
      SECRET_IPC_SAVERS[storeKey as SecretProvider] ||
      SECRET_IPC_SAVERS[storeKey.replace(/ApiKey$/, "") as SecretProvider];
    if (!saver) return;
    const getter = window.electronAPI?.[
      saver.replace(/^save/, "get") as keyof typeof window.electronAPI
    ] as (() => Promise<string | null>) | undefined;
    if (!getter) return;
    try {
      const key = await getter();
      if (key !== null && typeof key !== "string") return;
      useSettingsStore.setState({ [storeKey]: key || "" });
      invalidateApiKeyCaches();
    } catch {
      logger.warn("Failed to refresh API key", { storeKey }, "settings");
    }
  };
  window.electronAPI?.onApiKeyUpdated?.(refreshApiKey);

  if (window.electronAPI) {
    // Preferences are already in localStorage; do not wait for secret or provider hydration.
    try {
      const [
        openai,
        groq,
        xai,
        mistral,
        cortiClientId,
        cortiClientSecret,
        customTx,
        deepgram,
        assemblyai,
      ] = await Promise.all([
        window.electronAPI.getOpenAIKey?.(),
        window.electronAPI.getGroqKey?.(),
        window.electronAPI.getXaiKey?.(),
        window.electronAPI.getMistralKey?.(),
        window.electronAPI.getCortiClientId?.(),
        window.electronAPI.getCortiClientSecret?.(),
        window.electronAPI.getCustomTranscriptionKey?.(),
        window.electronAPI.getDeepgramKey?.(),
        window.electronAPI.getAssemblyAIKey?.(),
      ]);

      useSettingsStore.setState({
        openaiApiKey: openai || "",
        groqApiKey: groq || "",
        xaiApiKey: xai || "",
        mistralApiKey: mistral || "",
        cortiClientId: cortiClientId || "",
        cortiClientSecret: cortiClientSecret || "",
        customTranscriptionApiKey: customTx || "",
        deepgramApiKey: deepgram || "",
        assemblyaiApiKey: assemblyai || "",
      });

      for (const key of STALE_SECRET_LOCALSTORAGE_KEYS) {
        localStorage.removeItem(key);
      }
      // Latch for the one-time semantic reindex that no longer exists (#2143).
      localStorage.removeItem("semanticReindexVersion");
    } catch (err) {
      logger.warn(
        "Failed to hydrate secrets from main process",
        { error: (err as Error).message },
        "settings"
      );
    } finally {
      hydratingSecrets = false;
      await Promise.all([...pendingSecretUpdates].map(refreshApiKey));
      pendingSecretUpdates.clear();
    }

    // Sync dictation key from main process.
    // localStorage holds the user's preferred hotkey. Only populate from .env
    // when localStorage is empty (fresh install / cleared data).
    try {
      if (!state.dictationKey) {
        const envKey = await window.electronAPI.getDictationKey?.();
        if (envKey) {
          createStringSetter("dictationKey")(envKey);
        }
      }
    } catch (err) {
      logger.warn(
        "Failed to sync dictation key on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    // Track what is actually registered, separately from the editable
    // dictationKey preference so partial registrations never get persisted.
    // May return constructor default during early startup; corrected by dictation-key-active event later.
    try {
      const activeKey = await window.electronAPI?.getActiveDictationKey?.();
      if (activeKey) {
        useSettingsStore.setState({ activeDictationKey: activeKey });
      }
    } catch (err) {
      logger.warn(
        "Failed to sync active dictation key on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    // Sync voice agent hotkey from main process
    try {
      const envKey = await window.electronAPI.getVoiceAgentKey?.();
      if (envKey && envKey !== state.voiceAgentKey) {
        createStringSetter("voiceAgentKey")(envKey);
      }
    } catch (err) {
      logger.warn(
        "Failed to sync voice agent hotkey on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    try {
      let envMode = await window.electronAPI.getActivationMode?.();
      if (envMode && envMode !== state.activationMode) {
        if (isBrowser) localStorage.setItem("activationMode", envMode);
        useSettingsStore.setState({ activationMode: envMode });
      }
    } catch (err) {
      logger.warn(
        "Failed to sync activation mode on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    // Sync UI language from main process
    try {
      const envLanguage = await window.electronAPI.getUiLanguage?.();
      const resolved = normalizeUiLanguage(envLanguage || state.uiLanguage);
      if (resolved !== state.uiLanguage) {
        if (isBrowser) localStorage.setItem("uiLanguage", resolved);
        useSettingsStore.setState({ uiLanguage: resolved });
      }
      await i18n.changeLanguage(resolved);
    } catch (err) {
      logger.warn(
        "Failed to sync UI language on startup",
        { error: (err as Error).message },
        "settings"
      );
      void i18n.changeLanguage(normalizeUiLanguage(state.uiLanguage));
    }

    const migratedLang = isBrowser ? localStorage.getItem("preferredLanguage") : null;
    if (migratedLang && migratedLang !== state.preferredLanguage) {
      useSettingsStore.setState({ preferredLanguage: migratedLang });
    }

    // Sync dictionary from SQLite <-> localStorage.
    // Prefer SQLite whenever it has entries (same policy as snippets). A stale
    // cache used to win when both sides were non-empty; ensureAgentNameInDictionary
    // then wrote that cache through setDictionary and wiped newer DB words (#1295).
    let dictionarySyncSucceeded = !window.electronAPI?.getDictionary;
    try {
      if (window.electronAPI.getDictionary) {
        const currentDictionary = useSettingsStore.getState().customDictionary;
        const dbWords = await window.electronAPI.getDictionary();
        const decision = chooseDictionaryStartupAction(dbWords, currentDictionary);
        if (decision.action === "push-local-to-db") {
          await window.electronAPI.setDictionary(decision.words);
        } else if (decision.action === "pull-db-to-local") {
          if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(decision.words));
          useSettingsStore.setState({ customDictionary: decision.words });
        }
        dictionarySyncSucceeded = true;
      }
    } catch (err) {
      logger.warn(
        "Failed to sync dictionary on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    // Sync snippets from SQLite <-> localStorage
    try {
      if (window.electronAPI.getSnippets) {
        const currentSnippets = useSettingsStore.getState().snippets;
        const dbSnippets = await window.electronAPI.getSnippets();
        if (dbSnippets.length === 0 && currentSnippets.length > 0) {
          await window.electronAPI.setSnippets?.(currentSnippets);
          const normalizedSnippets = await window.electronAPI.getSnippets();
          if (isBrowser) localStorage.setItem("snippets", JSON.stringify(normalizedSnippets));
          useSettingsStore.setState({ snippets: normalizedSnippets });
        } else if (dbSnippets.length > 0) {
          if (isBrowser) localStorage.setItem("snippets", JSON.stringify(dbSnippets));
          useSettingsStore.setState({ snippets: dbSnippets });
        }
      }
    } catch (err) {
      logger.warn(
        "Failed to sync snippets on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    reconcileRetiredCloudModelSelections();

    // Only after a successful DB↔cache reconcile. If the read failed, the cache
    // may still be stale — writing it via setCustomDictionary would wipe SQLite.
    if (dictionarySyncSucceeded) {
      ensureAgentNameInDictionary();
    }
  }

  // Sync Zustand store when another window writes to localStorage
  window.addEventListener("storage", (event) => {
    if (!event.key || event.storageArea !== localStorage || event.newValue === null) return;

    const { key, newValue } = event;

    if (key.startsWith("customPrompt.")) {
      const kind = key.slice("customPrompt.".length) as PromptKind;
      if (!PROMPT_KIND_LIST.includes(kind)) return;
      useSettingsStore.setState((s) => ({
        customPrompts: { ...s.customPrompts, [kind]: newValue },
      }));
      return;
    }

    const state = useSettingsStore.getState();
    if (!(key in state) || typeof (state as unknown as Record<string, unknown>)[key] === "function")
      return;

    let value: unknown;
    if (BOOLEAN_SETTINGS.has(key)) {
      value = newValue === "true";
    } else if (ARRAY_SETTINGS.has(key)) {
      try {
        const parsed = JSON.parse(newValue);
        value = Array.isArray(parsed) ? parsed : [];
      } catch {
        value = [];
      }
    } else if (NUMERIC_SETTINGS.has(key)) {
      const parsed = Number(newValue);
      if (Number.isNaN(parsed)) {
        value =
          key === "audioRetentionDays" ? 30 : (state as unknown as Record<string, unknown>)[key];
      } else if (key === "audioRetentionDays") {
        value = Math.round(parsed);
      } else if (key === "micWarmHoldSeconds") {
        // Same whitelist as the setter — a hand-edited localStorage value
        // synced from another window must not exceed the offered durations.
        value = snapMicWarmHold(parsed);
      } else {
        value = parsed;
      }
    } else if (key === "emailDraftTarget") {
      value = normalizeEmailDraftTarget(newValue);
    } else if (key === "toneStyles") {
      value = normalizeToneStyles(newValue);
    } else {
      value = newValue;
    }

    useSettingsStore.setState({ [key]: value });

    if (key === "uiLanguage" && typeof value === "string") {
      void i18n.changeLanguage(value);
    }
  });

  // Active hotkey updates from backend — display state, never persisted.
  window.electronAPI?.onDictationKeyActive?.((key: string) => {
    useSettingsStore.setState({ activeDictationKey: key });
  });

  // Sync settings pushed from main process (e.g., hotkey changed in control panel)
  window.electronAPI?.onSettingUpdated?.((data: { key: string; value: unknown }) => {
    const state = useSettingsStore.getState();
    if (
      data.key in state &&
      typeof (state as unknown as Record<string, unknown>)[data.key] !== "function"
    ) {
      localStorage.setItem(
        data.key,
        typeof data.value === "string" ? data.value : JSON.stringify(data.value)
      );
      useSettingsStore.setState({ [data.key]: data.value });
    }
  });
}
