import type { PermissionGuideState, PermissionGuideAction } from "./permissionGuide";
import type { DictationTone, ToneAppCategory } from "../config/toneStyle";
import type { TechnicalErrorDetailsData } from "../components/ui/useToast";
import type { ProviderSettingsTarget } from "../utils/describeProviderError";

export type LocalTranscriptionProvider = "whisper" | "nvidia" | "cohere";

export interface MainWindowInputRegion {
  viewportWidth: number;
  viewportHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ChineseScriptPreference = "simplified" | "traditional" | "as-transcribed";

export type InferenceMode = "providers" | "local" | "self-hosted" | "enterprise";

export type SelfHostedType = "openai-compatible" | "lan";

export type TranscriptionStatus = "completed" | "failed" | "pending" | "discarded";

export interface PolicyFailureMetadata {
  error?: string;
  code?: string;
  status?: number;
  minAppVersion?: string;
  details?: unknown;
}

// Session options every dictation streaming channel takes — the shared
// dictation-realtime-* set and the per-provider ones. `provider` is
// what fetchRealtimeToken's allowlist keys on — the renderer must always send
// it (built by dictationStreamingRouting.buildStreamingSessionOptions); the
// main process defaults a missing value to "openai-realtime" for pre-1.8.4
// renderers (#1624).
export interface DictationRealtimeSessionOptions {
  pipelineOptions?: {
    agentName?: string;
    customDictionary?: string[];
    customPrompt?: string;
    tone?: DictationTone;
    appCategory?: ToneAppCategory;
    language?: string;
    locale?: string;
  };
  provider: string;
  baseUrl?: string;
  model?: string;
  language?: string;
  sampleRate?: number;
  keyterms?: string[];
  environment?: string;
  tenant?: string;
  preview?: boolean;
}

export interface DictationLanguageMetadata {
  language: string | null;
  languageConfidence: number | null;
  // Sum of detector scores for the supported languages, not a calibrated probability.
  languageSupportedScore?: number;
  languageAudioSeconds?: number;
}

export type TranscriptionErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "SERVER_ERROR"
  | "OFFLINE"
  | "AUTH_EXPIRED"
  | "AUTH_REQUIRED"
  | "LIMIT_REACHED"
  | "PROVIDER_RATE_LIMITED"
  | "API_KEY_MISSING"
  | "INVALID_KEY"
  | "MODEL_NOT_AVAILABLE"
  | "CUSTOM_ENDPOINT_INVALID"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_ACCESS_DENIED"
  | "PROVIDER_QUOTA_EXHAUSTED"
  | "PROVIDER_MODEL_NOT_FOUND"
  | "PROVIDER_PAYLOAD_TOO_LARGE"
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNREACHABLE"
  | "PROVIDER_NO_RESPONSE"
  | "PROVIDER_ERROR"
  | "CRASH_RECOVERY"
  | null;

/** Fields a main-process handler resolves with in place of a rejected Error. */
export interface IpcErrorFields {
  error: string;
  code?: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  settingsTarget?: string;
  technicalDetails?: TechnicalErrorDetailsData;
  status?: number;
  surface?: "transcription" | "llm";
}

/**
 * Proxied-transcription IPC results. `ipcMain.handle` drops custom error props on
 * rejection, so these handlers resolve with a serialized error instead of throwing.
 */
export type ProxyTranscriptionResult =
  { text: string; model?: string; error?: undefined } | (IpcErrorFields & { text?: undefined });

export interface TranscriptionItem {
  id: number;
  text: string;
  raw_text: string | null;
  timestamp: string;
  created_at: string;
  has_audio: number;
  audio_duration_ms: number | null;
  provider: string | null;
  model: string | null;
  status: TranscriptionStatus;
  error_message: string | null;
  error_code: TranscriptionErrorCode;
  route_kind?: string | null;
  client_transcription_id: string;
  cloud_id: string | null;
  sync_status: "synced" | "pending" | "error";
  deleted_at: string | null;
}

export interface NoteItem {
  id: number;
  title: string;
  content: string;
  enhanced_content: string | null;
  enhancement_prompt: string | null;
  /** The client_id of the template that produced enhanced_content. */
  enhancement_template_id: string | null;
  enhanced_at_content_hash: string | null;
  note_type: "personal" | "meeting" | "upload";
  source_file: string | null;
  audio_duration_seconds: number | null;
  folder_id: number | null;
  space_id: number;
  transcript: string | null;
  calendar_event_id: string | null;
  participants: string | null;
  diarization_enabled: number | null;
  expected_speaker_count: number | null;
  cloud_id: string | null;
  is_shared: number;
  share_token: string | null;
  // The note's owner (CloudNote.user_id) — who created it, not who last
  // edited it. Only populated from the cloud; NULL on local-only rows and on
  // team notes mirrored before ownership shipped (the UI fails closed on
  // those until the owner backfill fills them).
  owner_user_id?: string | null;
  created_by_user_id?: string | null;
  // Last cloud editor; only populated on cloud pull (local edits don't set it).
  updated_by_user_id?: string | null;
  // Server updated_at this device last acked (push response or pull); echoed
  // as base_updated_at on the next PATCH. Null = pre-guard row, pushes LWW.
  cloud_updated_at?: string | null;
  cloud_revision?: number | null;
  cloud_create_rejected?: number;
  cloud_create_pending?: string | null;
  content_sync_operation?: "set" | "clear" | null;
  enhanced_content_sync_operation?: "set" | "clear" | null;
  // Local-only counters distinguish later edits/Undo from an in-flight snapshot.
  content_edit_generation?: number;
  enhanced_content_edit_generation?: number;
  created_at: string;
  updated_at: string;
  client_note_id: string;
  sync_status: "synced" | "pending" | "error";
  deleted_at: string | null;
  // Computed by getNoteByClientId while a parent folder DELETE awaits its
  // server result. Held notes stay hidden and must not be pulled/queued alone.
  folder_delete_pending?: number;
  // 1 while a cloud-backed row that left a team space still owes its scope
  // retraction push (D6); cleared when the row settles.
  left_team?: number;
}

// Immutable view of every local field that affects a note push. The main
// process compares this atomically when the cloud response returns, so an
// in-flight create/PATCH cannot settle a newer edit or a purged identity.
export type NotePushSnapshot = Pick<
  NoteItem,
  | "client_note_id"
  | "title"
  | "content"
  | "enhanced_content"
  | "enhancement_prompt"
  | "enhancement_template_id"
  | "enhanced_at_content_hash"
  | "note_type"
  | "source_file"
  | "audio_duration_seconds"
  | "folder_id"
  | "space_id"
  | "transcript"
  | "calendar_event_id"
  | "participants"
  | "diarization_enabled"
  | "expected_speaker_count"
  | "created_at"
  | "updated_at"
  | "sync_status"
  | "deleted_at"
  | "cloud_updated_at"
  | "cloud_revision"
  | "content_sync_operation"
  | "enhanced_content_sync_operation"
  | "content_edit_generation"
  | "enhanced_content_edit_generation"
  | "left_team"
>;

export type ShareVisibility = "private" | "link" | "domain" | "invited";

export interface FolderItem {
  id: number;
  name: string;
  is_default: number;
  sort_order: number;
  space_id: number;
  created_at: string;
  updated_at: string;
  client_folder_id: string;
  cloud_id: string | null;
  sync_status: "synced" | "pending" | "error";
  deleted_at: string | null;
  // 1 while a cloud-backed row that left a team space still owes its scope
  // retraction push (D6); cleared when the row settles.
  left_team?: number;
}

export type FolderPushSnapshot = Pick<
  FolderItem,
  | "client_folder_id"
  | "name"
  | "is_default"
  | "sort_order"
  | "space_id"
  | "created_at"
  | "updated_at"
  | "sync_status"
  | "deleted_at"
  | "left_team"
>;

export type WorkspaceRole = "owner" | "admin" | "member";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_by_user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  seats: number;
  // Optional: absent from API responses that predate unified billing.
  seats_used?: number;
  created_at: string;
  updated_at: string;
  role: WorkspaceRole;
  is_billable?: boolean;
  billing_manager?: string | null;
}

export interface ScreenRecordingAccessResult {
  granted: boolean;
  status: "granted" | "denied" | "not-determined" | "restricted" | "unknown" | "unsupported";
  supported: boolean;
  /** macOS only: granted mid-session, so capture stays broken until the app relaunches. */
  needsRelaunch?: boolean;
}

export interface ScreenContextImage {
  mediaType: string;
  /** Base64 image bytes, no data-URL prefix. */
  data: string;
}

export interface PasteToolsResult {
  platform: "darwin" | "win32" | "linux";
  available: boolean;
  method: string | null;
  requiresPermission: boolean;
  isWayland?: boolean;
  xwaylandAvailable?: boolean;
  terminalAware?: boolean;
  hasNativeBinary?: boolean;
  hasUinput?: boolean;
  hasWtype?: boolean;
  isWlroots?: boolean;
  isCosmic?: boolean;
  wlCopyMissing?: boolean;
  tools?: string[];
  recommendedInstall?: string;
}

export type OnboardingDemoKind = "dictation" | "assistant";
/**
 * "partial" streams the transcript, "processing" carries the final transcript,
 * "replying" streams the assistant demo's reply, and "level" mirrors the
 * microphone level while listening.
 */
export type OnboardingDemoStatus =
  "listening" | "level" | "processing" | "partial" | "replying" | "success" | "error";
export interface OnboardingDemoEvent {
  demoId: string;
  kind: OnboardingDemoKind;
  status: OnboardingDemoStatus;
  text?: string;
  message?: string;
  /** Tool the assistant is running while it replies (a tool registry name). */
  tool?: string;
  /** Microphone input level, 0..1, on "level" events. */
  level?: number;
}

declare global {
  interface Window {
    electronAPI: {
      // Basic window operations
      setOnboardingWindowMode?: (mode: "compact" | "expanded" | "restore") => Promise<boolean>;
      setOnboardingActive?: (active: boolean) => Promise<boolean>;
      getPermissionGuideState?: () => Promise<PermissionGuideState | null>;
      permissionGuideAction?: (action: PermissionGuideAction) => void;
      startPermissionGuideDrag?: (
        target: Pick<PermissionGuideState, "sessionId" | "permission">
      ) => void;
      onPermissionGuideState?: (callback: (state: PermissionGuideState) => void) => () => void;
      publishOnboardingDemoEvent?: (event: Omit<OnboardingDemoEvent, "demoId">) => Promise<boolean>;
      testProviderConnection?: (config: {
        scope: "transcription" | "reasoning";
        provider: string;
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        clientId?: string;
        clientSecret?: string;
        environment?: string;
        tenant?: string;
      }) => Promise<{
        success: boolean;
        error?: string;
        errorCode?: string;
        status?: number;
        /** The provider gave no verdict (busy, down, unreachable); the setup may be used. */
        unverified?: boolean;
      }>;
      pasteText: (
        text: string,
        options?: {
          fromStreaming?: boolean;
          restoreClipboard?: boolean;
          allowClipboardFallback?: boolean;
        }
      ) => Promise<
        | {
            success: true;
            pasted: boolean;
            reason?: "modifiers-held" | "wl-copy-missing" | "wl-copy-failed";
          }
        | {
            success: false;
            pasted: false;
            code: "ACCESSIBILITY_PERMISSION_REQUIRED";
            clipboardCopied: true;
          }
      >;
      captureSelectedText?: (options?: { probeEditable?: boolean }) => Promise<
        | {
            status: "selected";
            sessionId: string;
            text: string;
            characterCount: number;
          }
        | {
            status: "editable";
            sessionId: string;
            /** True when the captured app keeps markdown (spec Appendix A); false means plain text. */
            acceptsMarkdown: boolean;
          }
        | {
            status: "none" | "unavailable" | "target_changed" | "too_large";
            code?: string;
            characterCount?: number;
            maxCharacters?: number;
          }
      >;
      replaceSelectedText?: (
        sessionId: string,
        text: string,
        options?: { restoreClipboard?: boolean; allowClipboardFallback?: boolean }
      ) => Promise<{
        success: boolean;
        code?:
          | "invalid_replacement"
          | "session_expired"
          | "target_changed"
          | "selection_unavailable"
          | "selection_changed"
          | "paste_failed"
          | "modifiers_held"
          | "wl_copy_missing"
          | "wl_copy_failed"
          | "selection_manager_unavailable";
        error?: string;
      }>;
      pasteAtCapturedTarget?: (
        sessionId: string,
        text: string,
        options?: { restoreClipboard?: boolean; allowClipboardFallback?: boolean }
      ) => Promise<{
        success: boolean;
        code?:
          | "invalid_replacement"
          | "session_expired"
          | "target_changed"
          | "paste_failed"
          | "modifiers_held"
          | "wl_copy_missing"
          | "wl_copy_failed"
          | "selection_manager_unavailable";
        error?: string;
      }>;
      hideWindow: () => Promise<void>;
      showDictationPanel: () => Promise<void>;
      openSettingsSection?: (section: ProviderSettingsTarget) => Promise<{ success: boolean }>;
      captureDictationTarget?: () => Promise<{ success: boolean; pid: number | null }>;
      captureDictationAppCategory?: () => Promise<ToneAppCategory>;
      onToggleDictation: (callback: () => void) => () => void;
      onToggleVoiceAgent?: (callback: () => void) => () => void;
      onOpenAssistantPanel?: (callback: () => void) => () => void;
      onStartDictation?: (callback: () => void) => () => void;
      onStopDictation?: (callback: () => void) => () => void;
      onPrepareDictation?: (
        callback: (options?: { inputKind?: "dictation" | "assistant" }) => void
      ) => () => void;
      onCancelDictationPreparation?: (callback: () => void) => () => void;
      onCancelDictation?: (callback: () => void) => () => void;
      onDictationForceStopped?: (
        callback: (payload?: { reason?: "timeout" | "reset" | "manual" }) => void
      ) => () => void;
      onDictationPushLocked?: (callback: (locked: boolean) => void) => () => void;
      dictationLifecycleStateChanged: (
        state: "idle" | "preparing" | "recording" | "processing",
        inputKind?: "dictation" | "assistant"
      ) => void;
      dictationAudioLevelChanged?: (level: number) => void;
      toggleAgentPanelDictation?: () => Promise<{ success: boolean }>;
      cancelAgentPanelDictation?: () => Promise<{ success: boolean }>;
      getAgentDictationPillState?: () => Promise<{
        lifecycle: "idle" | "preparing" | "recording" | "processing";
        interactive: boolean;
        horizontalDirection: "left" | "right";
      }>;
      resizeAgentDictationPillToContent?: (surfaceHeight: number | null) => Promise<{
        success: boolean;
        changed?: boolean;
        bounds?: { x: number; y: number; width: number; height: number };
        message?: string;
      }>;
      setAgentDictationPillInteractivity?: (interactive: boolean) => Promise<{ success: boolean }>;
      onAgentDictationPillStateChanged?: (
        callback: (state: {
          lifecycle: "idle" | "preparing" | "recording" | "processing";
          interactive: boolean;
          horizontalDirection: "left" | "right";
        }) => void
      ) => () => void;
      onAgentDictationPillAudioLevelChanged?: (callback: (level: number) => void) => () => void;
      showAgentDictationFinalTranscript?: (text: string) => void;
      onAgentDictationPillFinalTranscript?: (callback: (text: string) => void) => () => void;

      // Database operations
      saveTranscription: (
        text: string,
        rawText?: string | null,
        options?: {
          status?: TranscriptionStatus;
          errorMessage?: string | null;
          errorCode?: TranscriptionErrorCode;
          clientTranscriptionId?: string;
          analyticsOccurredAt?: string;
        }
      ) => Promise<{ id: number; success: boolean; transcription?: TranscriptionItem }>;
      getTranscriptions: (
        limit?: number,
        options?: { includeDiscarded?: boolean }
      ) => Promise<TranscriptionItem[]>;
      clearTranscriptions: () => Promise<{ cleared: number; success: boolean }>;
      deleteTranscription: (id: number) => Promise<{ success: boolean }>;

      // Audio retention operations
      saveTranscriptionAudio: (
        id: number,
        audioBuffer: ArrayBuffer,
        metadata?: { durationMs?: number; provider?: string; model?: string }
      ) => Promise<{ success: boolean; path?: string }>;
      mergeAudioSegments: (
        segments: Array<{ buffer: ArrayBuffer; mimeType: string }>
      ) => Promise<
        | { success: true; buffer: ArrayBuffer; mimeType: "audio/webm" }
        | { success: false; error: string }
      >;
      showAudioInFolder: (id: number) => Promise<{ success: boolean }>;
      getTranscriptionAudio: (
        id: number
      ) => Promise<{ success: true; buffer: ArrayBuffer } | { success: false }>;
      syncRetentionSettings?: (settings: {
        audioRetentionDays: number;
        transcriptRetentionDays: number;
        dataRetentionEnabled: boolean;
      }) => void;
      retryTranscription: (
        id: number,
        settings?: { cloudTranscriptionModel?: string; preferredLanguage?: string }
      ) => Promise<{
        success: boolean;
        transcription?: TranscriptionItem;
        warning?: string;
        error?: string;
        code?: string;
        messageKey?: string;
      }>;
      updateTranscriptionText: (
        id: number,
        text: string,
        rawText: string | null
      ) => Promise<{ success: boolean; transcription?: TranscriptionItem; error?: string }>;

      // Dictionary operations
      getDictionary: () => Promise<string[]>;
      /** Replaces the whole dictionary — omitted words are deleted. Prefer applyDictionaryChanges. */
      setDictionary: (words: string[]) => Promise<{ success: boolean }>;
      applyDictionaryChanges?: (changes: {
        add?: string[];
        remove?: string[];
      }) => Promise<{ success: boolean; added: number; removed: number }>;
      onDictionaryUpdated?: (callback: (words: string[]) => void) => () => void;
      getSnippets?: () => Promise<Array<{ trigger: string; replacement: string }>>;
      setSnippets?: (
        snippets: Array<{ trigger: string; replacement: string }>
      ) => Promise<{ success: boolean }>;
      onSnippetsUpdated?: (
        callback: (snippets: Array<{ trigger: string; replacement: string }>) => void
      ) => () => void;
      setAutoLearnEnabled?: (enabled: boolean) => void;
      onCorrectionsLearned?: (callback: (words: string[]) => void) => () => void;
      undoLearnedCorrections?: (words: string[]) => Promise<{ success: boolean }>;

      exportDictionary: (words: string[]) => Promise<{ success: boolean; error?: string }>;

      // Audio file operations
      saveTempAudio: (buffer: ArrayBuffer) => Promise<{ success: boolean; path: string }>;
      deleteTempAudio: (tempPath: string) => Promise<{ success: boolean; error?: string }>;
      importAudioFile: () => Promise<{
        success: boolean;
        transcription?: TranscriptionItem;
        error?: string;
      }>;

      // Database event listeners
      onTranscriptionAdded?: (callback: (item: TranscriptionItem) => void) => () => void;
      onTranscriptionUpdated?: (callback: (item: TranscriptionItem) => void) => () => void;
      onTranscriptionDeleted?: (callback: (payload: { id: number }) => void) => () => void;
      onTranscriptionsCleared?: (callback: (payload: { cleared: number }) => void) => () => void;

      // API key management
      getOpenAIKey: () => Promise<string>;
      saveOpenAIKey: (key: string) => Promise<{ success: boolean }>;
      getUiLanguage: () => Promise<string>;
      setUiLanguage: (language: string) => Promise<{ success: boolean; language: string }>;
      saveAllKeysToEnv: () => Promise<{ success: boolean; path: string }>;
      syncStartupPreferences: (prefs: {
        useLocalWhisper: boolean;
        localTranscriptionProvider: LocalTranscriptionProvider;
        model?: string;
        language?: string;
      }) => Promise<void>;

      // Clipboard operations
      checkAccessibilityPermission: (silent?: boolean) => Promise<boolean>;
      readClipboard: () => Promise<string>;
      writeClipboard: (text: string) => Promise<{ success: boolean; xwaylandOnly?: boolean }>;
      checkPasteTools: () => Promise<PasteToolsResult>;

      // Audio

      // Window control operations
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      getPlatform: () => string;
      startWindowDrag: () => Promise<void>;
      stopWindowDrag: () => Promise<void>;
      startControlPanelDrag: () => Promise<void>;
      stopControlPanelDrag: () => Promise<void>;
      setMainWindowInteractivity: (interactive: boolean) => Promise<void>;
      setMainWindowInputRegion: (region: MainWindowInputRegion | null) => Promise<boolean>;
      onMainWindowVisibilityChanged: (callback: (visible: boolean) => void) => () => void;
      resizeMainWindow: (
        sizeKey:
          | "BASE"
          | "RECORDING"
          | "DICTATION_ERROR"
          | "DICTATION_ERROR_WITH_TRANSCRIPT"
          | "WITH_MENU"
          | "WITH_TOAST"
          | "EXPANDED"
          | "ASSISTANT"
      ) => Promise<{
        success: boolean;
        bounds?: Electron.Rectangle;
        message?: string;
        changed?: boolean;
      }>;
      resizeAssistantWindowToContent: (surfaceHeight: number) => Promise<{
        success: boolean;
        bounds?: Electron.Rectangle;
        message?: string;
        changed?: boolean;
      }>;
      resizeDictationErrorWindowToContent: (
        surfaceHeight: number
      ) => Promise<{ success: boolean; bounds?: Electron.Rectangle; message?: string }>;
      setAssistantPanelOpen: (open: boolean) => Promise<{ success: boolean }>;
      setAssistantPanelBusy: (busy: boolean) => Promise<{ success: boolean }>;

      /** Version of an update downloaded and waiting to install, or null. */
      getDownloadedUpdate?: () => Promise<string | null>;
      installUpdate?: () => Promise<boolean>;
      onUpdateDownloaded?: (callback: (payload: { version: string | null }) => void) => () => void;
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

      // Hotkey management
      updateHotkey: (key: string) => Promise<{ success: boolean; message: string }>;
      setHotkeyListeningMode?: (enabled: boolean) => Promise<{ success: boolean }>;
      getHotkeyModeInfo?: (hotkey?: string) => Promise<{
        isUsingGnome: boolean;
        isUsingHyprland: boolean;
        isUsingKDE: boolean;
        isUsingNativeShortcut: boolean;
        supportsPushToTalk: boolean;
        pushToTalkUnavailableReason: string | null;
        linuxInputAccessDenied?: boolean;
      }>;
      getHyprlandConfigStatus?: () => Promise<{ canWrite: boolean; path: string } | null>;

      // Wayland paste diagnostics
      getYdotoolStatus?: () => Promise<{
        isLinux: boolean;
        isWayland: boolean;
        hasYdotool: boolean;
        hasYdotoold: boolean;
        hasWtype: boolean;
        hasWlCopy: boolean;
        daemonRunning: boolean;
        hasService: boolean;
        hasUinput: boolean;
        hasUdevRule: boolean;
        hasGroup: boolean;
        isNixOS: boolean;
        isKde: boolean;
        isWlroots: boolean;
        isCosmic: boolean;
        requiresWlCopy: boolean;
      }>;

      // Globe key listener for hotkey capture (macOS only)
      onGlobeKeyPressed?: (callback: () => void) => () => void;
      onGlobeKeyReleased?: (callback: () => void) => () => void;

      // Hotkey registration events
      onHotkeyFallbackUsed?: (
        callback: (data: { original: string; fallback: string }) => void
      ) => () => void;
      onHotkeyRegistrationFailed?: (
        callback: (data: { hotkey: string; error: string; suggestions: string[] }) => void
      ) => () => void;
      onApiKeyUpdated?: (callback: (storeKey: string) => void) => () => void;
      onSettingUpdated?: (callback: (data: { key: string; value: unknown }) => void) => () => void;
      onDictationKeyActive?: (callback: (key: string) => void) => () => void;
      onLinuxPttPermissionDenied?: (callback: () => void) => () => void;

      // Settings shortcut (Cmd+, / Ctrl+,)
      onShowSettings?: (callback: () => void) => () => void;
      // Tray "Show Control Panel"
      onShowHome?: (callback: () => void) => () => void;
      getPendingSettingsSection?: () => Promise<string | null>;

      // Accessibility permission events (macOS)
      markMacAccessibilityFeaturesReady?: () => void;
      onAccessibilityMissing?: (callback: () => void) => () => void;

      // Groq API key management
      getGroqKey: () => Promise<string | null>;
      saveGroqKey: (key: string) => Promise<void>;

      // Sign in with ChatGPT (OpenAI cleanup on the user's ChatGPT plan)
      chatgptSignIn: () => Promise<{ signedIn: boolean; email: string } | { error: string }>;
      chatgptSignOut: () => Promise<{ signedIn: boolean }>;
      chatgptStatus: () => Promise<{ signedIn: boolean; email: string }>;
      getChatGPTAccessToken: () => Promise<string>;
      chatgptSocketWarmup?: () => Promise<{ success: boolean; error?: string }>;
      chatgptSocketResponse?: (
        body: Record<string, unknown>,
        timeoutMs: number
      ) => Promise<
        { success: true; text: string; warm: boolean } | { success: false; error: string }
      >;

      // xAI API key management
      getXaiKey?: () => Promise<string | null>;
      saveXaiKey?: (key: string) => Promise<void>;

      // Mistral API key management
      getMistralKey: () => Promise<string | null>;
      saveMistralKey: (key: string) => Promise<void>;
      proxyMistralTranscription: (data: {
        audioBuffer: ArrayBuffer;
        model?: string;
        language?: string;
        contextBias?: string[];
      }) => Promise<ProxyTranscriptionResult>;

      // Corti credential management
      getCortiClientId?: () => Promise<string | null>;
      saveCortiClientId?: (key: string) => Promise<void>;
      getCortiClientSecret?: () => Promise<string | null>;
      saveCortiClientSecret?: (key: string) => Promise<void>;
      getDeepgramKey?: () => Promise<string | null>;
      saveDeepgramKey?: (key: string) => Promise<void>;
      getAssemblyAIKey?: () => Promise<string | null>;
      saveAssemblyAIKey?: (key: string) => Promise<void>;

      // Custom endpoint API keys
      getCustomTranscriptionKey?: () => Promise<string | null>;
      saveCustomTranscriptionKey?: (key: string) => Promise<void>;

      // Dictation key persistence (file-based for reliable startup)
      getDictationKey?: () => Promise<string | null>;
      getActiveDictationKey?: () => Promise<string>;
      getEffectiveDefaultHotkey?: () => Promise<string>;
      saveDictationKey?: (key: string) => Promise<void>;

      // Activation mode persistence (file-based for reliable startup)
      getActivationMode?: () => Promise<"tap" | "push">;

      // Debug logging
      getLogLevel?: () => Promise<string>;
      log?: (entry: {
        level: string;
        message: string;
        meta?: any;
        scope?: string;
        source?: string;
      }) => Promise<void>;
      openLogsFolder: () => Promise<{ success: boolean; error?: string }>;
      getErrorLog: () => Promise<
        Array<{
          time: string;
          level: string;
          scope?: string;
          source?: string;
          message: string;
          details?: string;
        }>
      >;
      clearErrorLog: () => Promise<void>;

      // System settings helpers
      requestMicrophoneAccess?: () => Promise<{ granted: boolean }>;
      checkMicrophoneAccess?: () => Promise<{ granted: boolean; status: string }>;
      getSystemDefaultMicrophone?: (options?: { refresh?: boolean }) => Promise<{
        name: string;
        nativeId?: string;
        platform: string;
        source: "system" | "unavailable";
      }>;
      openMicrophoneSettings?: () => Promise<{ success: boolean; error?: string }>;
      openSoundInputSettings?: () => Promise<{ success: boolean; error?: string }>;
      openAccessibilitySettings?: () => Promise<{ success: boolean; error?: string }>;
      checkScreenRecordingAccess?: () => Promise<ScreenRecordingAccessResult>;
      requestScreenRecordingAccess?: () => Promise<ScreenRecordingAccessResult>;
      captureScreenContext?: () => Promise<ScreenContextImage | null>;
      setScreenContextEnabled?: (enabled: boolean) => Promise<{ success: boolean }>;
      pauseMediaPlayback?: () => Promise<boolean>;
      resumeMediaPlayback?: () => Promise<boolean>;
      muteOtherApps?: () => Promise<boolean>;
      unmuteOtherApps?: () => Promise<boolean>;

      // Windows Push-to-Talk notifications
      notifyActivationModeChanged?: (mode: "tap" | "push") => void;
      notifyHotkeyChanged?: (hotkey: string) => void;
      notifyFloatingIconAutoHideChanged?: (enabled: boolean) => void;
      onFloatingIconAutoHideChanged?: (callback: (enabled: boolean) => void) => () => void;
      notifyPanelStartPositionChanged?: (position: string) => void;
      getMainWindowHorizontalDirection?: () => Promise<"left" | "right">;
      onMainWindowHorizontalDirectionChanged?: (
        callback: (direction: "left" | "right") => void
      ) => () => void;
      onMainWindowWillResize?: (
        callback: (resize: {
          bounds: Electron.Rectangle;
          anchor: "bottom-left" | "bottom-right" | "center";
        }) => void
      ) => () => void;

      // BYOK audio file transcription
      transcribeAudioFileByok?: (options: { filePath: string; model: string }) => Promise<{
        success: boolean;
        text?: string;
        error?: string;
        diarized?: boolean;
        segments?: Array<{ text: string; start: number; end: number; speaker?: string }>;
      }>;

      // Usage limit events

      // Agent Mode
      updateVoiceAgentHotkey?: (hotkey: string) => Promise<{ success: boolean; message?: string }>;
      getVoiceAgentKey?: () => Promise<string>;
      createAgentConversation?: (title: string) => Promise<{
        id: number;
        title: string;
        created_at: string;
        updated_at: string;
      } | null>;
      getAgentConversation?: (id: number) => Promise<{
        id: number;
        title: string;
        archived_at?: string;
        cloud_id?: string | null;
        client_conversation_id?: string | null;
        created_at: string;
        updated_at: string;
        messages: Array<{
          id: number;
          conversation_id: number;
          role: "user" | "assistant" | "system";
          content: string;
          metadata?: string;
          created_at: string;
        }>;
      } | null>;
      addAgentMessage?: (
        conversationId: number,
        role: "user" | "assistant" | "system",
        content: string,
        metadata?: Record<string, unknown>
      ) => Promise<{
        id: number;
        conversation_id: number;
        role: string;
        content: string;
        metadata?: string;
        created_at: string;
      } | null>;

      // Dictation realtime streaming
      dictationRealtimeWarmup?: (
        options: DictationRealtimeSessionOptions
      ) => Promise<{ success: boolean } & PolicyFailureMetadata>;
      dictationRealtimeStart?: (
        options: DictationRealtimeSessionOptions
      ) => Promise<{ success: boolean } & PolicyFailureMetadata>;
      dictationRealtimeSend?: (buffer: ArrayBuffer) => void;
      dictationRealtimeFinalize?: () => Promise<
        {
          success: boolean;
          text?: string;
          error?: string;
        } & Partial<DictationLanguageMetadata>
      >;
      dictationRealtimeStop?: () => Promise<{ success: boolean; text: string }>;
      onDictationRealtimePartial?: (callback: (text: string) => void) => () => void;
      onDictationRealtimeFinal?: (callback: (text: string) => void) => () => void;
      onDictationRealtimeError?: (callback: (error: string) => void) => () => void;
      onDictationRealtimeSessionEnd?: (callback: (data: { text: string }) => void) => () => void;

      onPreviewText?: (callback: (text: string) => void) => () => void;
      onPreviewAppend?: (callback: (text: string) => void) => () => void;
      onPreviewHold?: (callback: (payload: { showCleanup: boolean }) => void) => () => void;
      onPreviewResult?: (callback: (payload: { text: string }) => void) => () => void;
      onPreviewHide?: (callback: () => void) => () => void;
      stopDictationPreview?: (opts?: {
        showCleanup?: boolean;
        flushed?: boolean;
      }) => Promise<{ success: boolean; streamed?: boolean; text?: string }>;
      dismissDictationPreview?: () => Promise<{ success: boolean }>;
      updateDictationPreview?: (text: string) => Promise<{ success: boolean }>;
      completeDictationPreview?: (payload: { text?: string }) => Promise<{ success: boolean }>;
      hideDictationPreview?: () => Promise<{ success: boolean }>;
    };

    api?: {
      sendDebugLog: (message: string) => void;
    };
  }
}
