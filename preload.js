const { contextBridge, ipcRenderer } = require("electron");

// BYOK API-key bridges, built once instead of hand-listed per key. Sandboxed
// preloads can't require local modules, so the {base, get, save} tuples are
// inlined here; keep them in sync with the BYOK_API_KEYS manifest in
// src/config/secretKeys.js (the main process derives its plumbing from that).
const BYOK_KEY_BRIDGES = [
  { base: "openai", get: "getOpenAIKey", save: "saveOpenAIKey" },
  { base: "anthropic", get: "getAnthropicKey", save: "saveAnthropicKey" },
  { base: "gemini", get: "getGeminiKey", save: "saveGeminiKey" },
  { base: "groq", get: "getGroqKey", save: "saveGroqKey" },
  { base: "xai", get: "getXaiKey", save: "saveXaiKey" },
  { base: "mistral", get: "getMistralKey", save: "saveMistralKey" },
  { base: "openrouter", get: "getOpenrouterKey", save: "saveOpenrouterKey" },
  { base: "tinfoil", get: "getTinfoilKey", save: "saveTinfoilKey" },
  { base: "corti", get: "getCortiKey", save: "saveCortiKey" },
  {
    base: "dictation-agent-custom",
    get: "getDictationAgentCustomKey",
    save: "saveDictationAgentCustomKey",
  },
  {
    base: "dictation-agent-vision-custom",
    get: "getDictationAgentVisionCustomKey",
    save: "saveDictationAgentVisionCustomKey",
  },
  { base: "chat-agent-custom", get: "getChatAgentCustomKey", save: "saveChatAgentCustomKey" },
];
const secretKeyApi = {};
for (const k of BYOK_KEY_BRIDGES) {
  secretKeyApi[k.get] = () => ipcRenderer.invoke(`get-${k.base}-key`);
  secretKeyApi[k.save] = (key) => ipcRenderer.invoke(`save-${k.base}-key`, key);
}

/**
 * Helper to register an IPC listener and return a cleanup function.
 * Ensures renderer code can easily remove listeners to avoid leaks.
 */
const registerListener = (channel, handlerFactory) => {
  return (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener =
      typeof handlerFactory === "function"
        ? handlerFactory(callback)
        : (event, ...args) => callback(event, ...args);

    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
};

contextBridge.exposeInMainWorld("electronAPI", {
  setOnboardingWindowMode: (mode) => ipcRenderer.invoke("onboarding-set-window-mode", mode),
  setOnboardingActive: (active) => ipcRenderer.invoke("onboarding-set-active", active),
  getPermissionGuideState: () => ipcRenderer.invoke("permission-guide-state"),
  permissionGuideAction: (action) => ipcRenderer.send("permission-guide-action", action),
  startPermissionGuideDrag: (target) => ipcRenderer.send("permission-guide-drag", target),
  onPermissionGuideState: registerListener(
    "permission-guide-state-changed",
    (callback) => (_event, state) => callback(state)
  ),
  markMacAccessibilityFeaturesReady: () => ipcRenderer.send("mac-accessibility-features-ready"),
  publishOnboardingDemoEvent: (event) => ipcRenderer.invoke("onboarding-demo-publish", event),
  testProviderConnection: (config) => ipcRenderer.invoke("test-provider-connection", config),
  pasteText: (text, options) => ipcRenderer.invoke("paste-text", text, options),
  captureSelectedText: (options) => ipcRenderer.invoke("capture-selected-text", options),
  replaceSelectedText: (sessionId, text, options) =>
    ipcRenderer.invoke("replace-selected-text", sessionId, text, options),
  pasteAtCapturedTarget: (sessionId, text, options) =>
    ipcRenderer.invoke("paste-at-captured-target", sessionId, text, options),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showDictationPanel: () => ipcRenderer.invoke("show-dictation-panel"),
  openSettingsSection: (section) => ipcRenderer.invoke("open-settings-section", section),
  captureDictationTarget: () => ipcRenderer.invoke("capture-dictation-target"),
  captureDictationAppCategory: () => ipcRenderer.invoke("capture-dictation-app-category"),
  onToggleDictation: registerListener("toggle-dictation", (callback) => () => callback()),
  onToggleVoiceAgent: registerListener("toggle-voice-agent", (callback) => () => callback()),
  onOpenAssistantPanel: registerListener("open-assistant-panel", (callback) => () => callback()),
  onStartDictation: registerListener("start-dictation", (callback) => () => callback()),
  onStopDictation: registerListener("stop-dictation", (callback) => () => callback()),
  onPrepareDictation: registerListener(
    "prepare-dictation",
    (callback) => (_event, options) => callback(options)
  ),
  onCancelDictationPreparation: registerListener(
    "cancel-dictation-preparation",
    (callback) => () => callback()
  ),
  onCancelDictation: registerListener("cancel-dictation", (callback) => () => callback()),
  onDictationForceStopped: registerListener(
    "dictation-force-stopped",
    (callback) => (_event, payload) => callback(payload)
  ),
  onDictationPushLocked: registerListener(
    "dictation-push-locked",
    (callback) => (_event, locked) => callback(locked)
  ),
  dictationLifecycleStateChanged: (state, inputKind) =>
    ipcRenderer.send("dictation-lifecycle-state-changed", state, inputKind),
  dictationAudioLevelChanged: (level) => ipcRenderer.send("dictation-audio-level-changed", level),
  toggleAgentPanelDictation: () => ipcRenderer.invoke("toggle-agent-panel-dictation"),
  cancelAgentPanelDictation: () => ipcRenderer.invoke("cancel-agent-panel-dictation"),
  getAgentDictationPillState: () => ipcRenderer.invoke("get-agent-dictation-pill-state"),
  resizeAgentDictationPillToContent: (surfaceHeight) =>
    ipcRenderer.invoke("resize-agent-dictation-pill-to-content", surfaceHeight),
  setAgentDictationPillInteractivity: (interactive) =>
    ipcRenderer.invoke("set-agent-dictation-pill-interactivity", interactive),
  onAgentDictationPillStateChanged: registerListener(
    "agent-dictation-pill-state-changed",
    (callback) => (_event, state) => callback(state)
  ),
  onAgentDictationPillAudioLevelChanged: registerListener(
    "agent-dictation-pill-audio-level-changed",
    (callback) => (_event, level) => callback(level)
  ),
  showAgentDictationFinalTranscript: (text) =>
    ipcRenderer.send("show-agent-dictation-final-transcript", text),
  onAgentDictationPillFinalTranscript: registerListener(
    "agent-dictation-pill-final-transcript",
    (callback) => (_event, text) => callback(text)
  ),

  // Database functions
  saveTranscription: (text, rawText, options) =>
    ipcRenderer.invoke("db-save-transcription", text, rawText, options),
  getTranscriptions: (limit, options) =>
    ipcRenderer.invoke("db-get-transcriptions", limit, options),
  clearTranscriptions: () => ipcRenderer.invoke("db-clear-transcriptions"),
  deleteTranscription: (id) => ipcRenderer.invoke("db-delete-transcription", id),

  // Audio storage functions
  saveTranscriptionAudio: (id, audioBuffer, metadata) =>
    ipcRenderer.invoke("save-transcription-audio", id, audioBuffer, metadata),
  mergeAudioSegments: (segments) => ipcRenderer.invoke("merge-audio-segments", segments),
  showAudioInFolder: (id) => ipcRenderer.invoke("show-audio-in-folder", id),
  getTranscriptionAudio: (id) => ipcRenderer.invoke("get-transcription-audio", id),
  syncRetentionSettings: (settings) => ipcRenderer.send("retention-settings-changed", settings),
  retryTranscription: (id, settings) => ipcRenderer.invoke("retry-transcription", id, settings),
  updateTranscriptionText: (id, text, rawText) =>
    ipcRenderer.invoke("update-transcription-text", id, text, rawText),

  // Dictionary functions
  getDictionary: () => ipcRenderer.invoke("db-get-dictionary"),
  setDictionary: (words) => ipcRenderer.invoke("db-set-dictionary", words),
  applyDictionaryChanges: (changes) => ipcRenderer.invoke("db-apply-dictionary-changes", changes),
  onDictionaryUpdated: (callback) => {
    const listener = (_event, words) => callback?.(words);
    ipcRenderer.on("dictionary-updated", listener);
    return () => ipcRenderer.removeListener("dictionary-updated", listener);
  },
  getSnippets: () => ipcRenderer.invoke("db-get-snippets"),
  setSnippets: (snippets) => ipcRenderer.invoke("db-set-snippets", snippets),
  onSnippetsUpdated: (callback) => {
    const listener = (_event, snippets) => callback?.(snippets);
    ipcRenderer.on("snippets-updated", listener);
    return () => ipcRenderer.removeListener("snippets-updated", listener);
  },
  setAutoLearnEnabled: (enabled) => ipcRenderer.send("auto-learn-changed", enabled),
  onCorrectionsLearned: (callback) => {
    const listener = (_event, words) => callback?.(words);
    ipcRenderer.on("corrections-learned", listener);
    return () => ipcRenderer.removeListener("corrections-learned", listener);
  },
  undoLearnedCorrections: (words) => ipcRenderer.invoke("undo-learned-corrections", words),

  exportDictionary: (words) => ipcRenderer.invoke("export-dictionary", words),

  importAudioFile: () => ipcRenderer.invoke("import-audio-file"),

  onTranscriptionAdded: (callback) => {
    const listener = (_event, transcription) => callback?.(transcription);
    ipcRenderer.on("transcription-added", listener);
    return () => ipcRenderer.removeListener("transcription-added", listener);
  },
  onTranscriptionDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcription-deleted", listener);
    return () => ipcRenderer.removeListener("transcription-deleted", listener);
  },
  onTranscriptionsCleared: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcriptions-cleared", listener);
    return () => ipcRenderer.removeListener("transcriptions-cleared", listener);
  },
  onTranscriptionUpdated: (callback) => {
    const listener = (_event, transcription) => callback?.(transcription);
    ipcRenderer.on("transcription-updated", listener);
    return () => ipcRenderer.removeListener("transcription-updated", listener);
  },

  // BYOK API keys (get/save for every provider in the secretKeys manifest)
  ...secretKeyApi,

  // Sign in with ChatGPT (OpenAI cleanup on the user's ChatGPT plan)
  chatgptSignIn: () => ipcRenderer.invoke("chatgpt-sign-in"),
  chatgptSignOut: () => ipcRenderer.invoke("chatgpt-sign-out"),
  chatgptStatus: () => ipcRenderer.invoke("chatgpt-status"),
  getChatGPTAccessToken: () => ipcRenderer.invoke("chatgpt-access-token"),
  chatgptSocketWarmup: () => ipcRenderer.invoke("chatgpt-socket-warmup"),
  chatgptSocketResponse: (body, timeoutMs) =>
    ipcRenderer.invoke("chatgpt-socket-response", body, timeoutMs),

  // Clipboard functions
  checkAccessibilityPermission: (silent) =>
    ipcRenderer.invoke("check-accessibility-permission", silent),
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  writeClipboard: (text) => ipcRenderer.invoke("write-clipboard", text),
  checkPasteTools: () => ipcRenderer.invoke("check-paste-tools"),

  // Voice drafts (chat input recordings)
  saveTempAudio: (buffer) => ipcRenderer.invoke("save-temp-audio", buffer),
  deleteTempAudio: (tempPath) => ipcRenderer.invoke("delete-temp-audio", tempPath),

  // One-time "GPU pack needs re-downloading" notice
  takeGpuPackMigrationNotice: () => ipcRenderer.invoke("take-gpu-pack-migration-notice"),
  onGpuPackMigrationNoticeReady: registerListener(
    "gpu-pack-migration-notice-ready",
    (callback) => () => callback()
  ),

  // Window control functions
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  getPlatform: () => process.platform,

  updateHotkey: (hotkey) => ipcRenderer.invoke("update-hotkey", hotkey),
  setHotkeyListeningMode: (enabled) => ipcRenderer.invoke("set-hotkey-listening-mode", enabled),
  getHotkeyModeInfo: (hotkey) => ipcRenderer.invoke("get-hotkey-mode-info", hotkey),
  getHyprlandConfigStatus: () => ipcRenderer.invoke("get-hyprland-config-status"),
  startWindowDrag: () => ipcRenderer.invoke("start-window-drag"),
  stopWindowDrag: () => ipcRenderer.invoke("stop-window-drag"),
  startControlPanelDrag: () => ipcRenderer.invoke("start-control-panel-drag"),
  stopControlPanelDrag: () => ipcRenderer.invoke("stop-control-panel-drag"),
  getMainWindowHorizontalDirection: () =>
    ipcRenderer.invoke("get-main-window-horizontal-direction"),
  onMainWindowHorizontalDirectionChanged: registerListener(
    "main-window-horizontal-direction-changed",
    (callback) => (_event, direction) => callback(direction)
  ),
  onMainWindowWillResize: registerListener(
    "main-window-will-resize",
    (callback) => (_event, resize) => callback(resize)
  ),
  ackMainWindowResizeMask: (token) => ipcRenderer.send("main-window-resize-mask-ready", token),
  setMainWindowInteractivity: (interactive) =>
    ipcRenderer.invoke("set-main-window-interactivity", interactive),
  setMainWindowInputRegion: (region) => ipcRenderer.invoke("set-main-window-input-region", region),
  onMainWindowVisibilityChanged: registerListener(
    "main-window-visibility-changed",
    (callback) => (_event, visible) => callback(visible)
  ),
  resizeMainWindow: (sizeKey) => ipcRenderer.invoke("resize-main-window", sizeKey),
  resizeAssistantWindowToContent: (surfaceHeight) =>
    ipcRenderer.invoke("resize-assistant-window-to-content", surfaceHeight),
  resizeDictationErrorWindowToContent: (surfaceHeight) =>
    ipcRenderer.invoke("resize-dictation-error-window-to-content", surfaceHeight),
  setAssistantPanelOpen: (open) => ipcRenderer.invoke("set-assistant-panel-open", open),
  setAssistantPanelBusy: (busy) => ipcRenderer.invoke("set-assistant-panel-busy", busy),

  getDownloadedUpdate: () => ipcRenderer.invoke("get-downloaded-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateDownloaded: registerListener(
    "update-downloaded",
    (callback) => (_event, payload) => callback(payload)
  ),

  // Audio event listeners
  onCancelHotkeyPressed: registerListener("cancel-hotkey-pressed", (cb) => () => cb()),
  registerCancelHotkey: (key) => ipcRenderer.invoke("register-cancel-hotkey", key),
  unregisterCancelHotkey: () => ipcRenderer.invoke("unregister-cancel-hotkey"),

  // External link opener
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Model management functions
  modelGetAll: () => ipcRenderer.invoke("model-get-all"),
  modelGetActiveDownloads: () => ipcRenderer.invoke("model-get-active-downloads"),
  modelDownload: (modelId) => ipcRenderer.invoke("model-download", modelId),
  modelDelete: (modelId) => ipcRenderer.invoke("model-delete", modelId),
  modelCancelDownload: (modelId) => ipcRenderer.invoke("model-cancel-download", modelId),
  onModelDownloadProgress: registerListener("model-download-progress"),

  getUiLanguage: () => ipcRenderer.invoke("get-ui-language"),
  setUiLanguage: (language) => ipcRenderer.invoke("set-ui-language", language),

  proxyMistralTranscription: (data) => ipcRenderer.invoke("proxy-mistral-transcription", data),

  getTinfoilChatModels: () => ipcRenderer.invoke("get-tinfoil-chat-models"),

  // Custom endpoint API keys
  getCleanupCustomKey: () => ipcRenderer.invoke("get-cleanup-custom-key"),
  saveCleanupCustomKey: (key) => ipcRenderer.invoke("save-cleanup-custom-key", key),

  saveBedrockRegion: (value) => ipcRenderer.invoke("save-bedrock-region", value),
  saveBedrockProfile: (value) => ipcRenderer.invoke("save-bedrock-profile", value),
  getBedrockAccessKeyId: () => ipcRenderer.invoke("get-bedrock-access-key-id"),
  saveBedrockAccessKeyId: (key) => ipcRenderer.invoke("save-bedrock-access-key-id", key),
  getBedrockSecretAccessKey: () => ipcRenderer.invoke("get-bedrock-secret-access-key"),
  saveBedrockSecretAccessKey: (key) => ipcRenderer.invoke("save-bedrock-secret-access-key", key),
  getBedrockSessionToken: () => ipcRenderer.invoke("get-bedrock-session-token"),
  saveBedrockSessionToken: (key) => ipcRenderer.invoke("save-bedrock-session-token", key),
  saveAzureEndpoint: (value) => ipcRenderer.invoke("save-azure-endpoint", value),
  getAzureApiKey: () => ipcRenderer.invoke("get-azure-api-key"),
  saveAzureApiKey: (key) => ipcRenderer.invoke("save-azure-api-key", key),
  saveAzureDeployment: (value) => ipcRenderer.invoke("save-azure-deployment", value),
  saveAzureApiVersion: (value) => ipcRenderer.invoke("save-azure-api-version", value),
  saveVertexProject: (value) => ipcRenderer.invoke("save-vertex-project", value),
  saveVertexLocation: (value) => ipcRenderer.invoke("save-vertex-location", value),
  getVertexApiKey: () => ipcRenderer.invoke("get-vertex-api-key"),
  saveVertexApiKey: (key) => ipcRenderer.invoke("save-vertex-api-key", key),
  testEnterpriseConnection: (provider, config) =>
    ipcRenderer.invoke("test-enterprise-connection", provider, config),

  // Dictation key persistence (file-based for reliable startup)
  getDictationKey: () => ipcRenderer.invoke("get-dictation-key"),
  getActiveDictationKey: () => ipcRenderer.invoke("get-active-dictation-key"),
  getEffectiveDefaultHotkey: () => ipcRenderer.invoke("get-effective-default-hotkey"),
  saveDictationKey: (key) => ipcRenderer.invoke("save-dictation-key", key),

  // Activation mode persistence (file-based for reliable startup)
  getActivationMode: () => ipcRenderer.invoke("get-activation-mode"),

  saveAllKeysToEnv: () => ipcRenderer.invoke("save-all-keys-to-env"),
  syncStartupPreferences: (prefs) => ipcRenderer.invoke("sync-startup-preferences", prefs),

  // Local reasoning
  processLocalReasoning: (text, modelId, agentName, config) =>
    ipcRenderer.invoke("process-local-reasoning", text, modelId, agentName, config),
  checkLocalReasoningAvailable: () => ipcRenderer.invoke("check-local-reasoning-available"),
  cancelLocalReasoning: (requestId) => ipcRenderer.invoke("cancel-local-reasoning", requestId),

  // Anthropic reasoning
  processAnthropicReasoning: (text, modelId, agentName, config) =>
    ipcRenderer.invoke("process-anthropic-reasoning", text, modelId, agentName, config),

  // Enterprise reasoning (Bedrock, Azure, Vertex) — runs in main process so
  // Node-only SDKs (AWS/Azure/Google credential providers) can resolve.
  processEnterpriseReasoning: (text, modelId, agentName, config) =>
    ipcRenderer.invoke("process-enterprise-reasoning", text, modelId, agentName, config),
  cancelEnterpriseReasoning: () => ipcRenderer.send("enterprise-reasoning-cancel"),
  enterpriseStreamStart: (payload) => ipcRenderer.invoke("enterprise-stream-start", payload),
  enterpriseStreamCancel: (streamId) => ipcRenderer.invoke("enterprise-stream-cancel", streamId),
  onEnterpriseStreamPart: registerListener(
    "enterprise-stream-part",
    (callback) => (_event, payload) => callback(payload)
  ),
  listBedrockModels: (config) => ipcRenderer.invoke("bedrock-list-models", config),

  // llama-server
  llamaServerStart: (modelId) => ipcRenderer.invoke("llama-server-start", modelId),
  llamaServerStatus: () => ipcRenderer.invoke("llama-server-status"),
  llamaGpuReset: () => ipcRenderer.invoke("llama-gpu-reset"),

  // Vulkan GPU acceleration
  detectVulkanGpu: () => ipcRenderer.invoke("detect-vulkan-gpu"),
  getLlamaVulkanStatus: () => ipcRenderer.invoke("get-llama-vulkan-status"),
  downloadLlamaVulkanBinary: () => ipcRenderer.invoke("download-llama-vulkan-binary"),
  cancelLlamaVulkanDownload: () => ipcRenderer.invoke("cancel-llama-vulkan-download"),
  deleteLlamaVulkanBinary: () => ipcRenderer.invoke("delete-llama-vulkan-binary"),
  onLlamaVulkanDownloadProgress: registerListener(
    "llama-vulkan-download-progress",
    (callback) => (_event, data) => callback(data)
  ),

  getLogLevel: () => ipcRenderer.invoke("get-log-level"),
  log: (entry) => ipcRenderer.invoke("app-log", entry),

  // ydotool status check
  getYdotoolStatus: () => ipcRenderer.invoke("get-ydotool-status"),

  openLogsFolder: () => ipcRenderer.invoke("open-logs-folder"),
  getErrorLog: () => ipcRenderer.invoke("get-error-log"),
  clearErrorLog: () => ipcRenderer.invoke("clear-error-log"),

  // System settings helpers for microphone/audio permissions
  requestMicrophoneAccess: () => ipcRenderer.invoke("request-microphone-access"),
  checkMicrophoneAccess: () => ipcRenderer.invoke("check-microphone-access"),
  getSystemDefaultMicrophone: (options) =>
    ipcRenderer.invoke("get-system-default-microphone", options),
  openMicrophoneSettings: () => ipcRenderer.invoke("open-microphone-settings"),
  openSoundInputSettings: () => ipcRenderer.invoke("open-sound-input-settings"),
  openAccessibilitySettings: () => ipcRenderer.invoke("open-accessibility-settings"),
  checkScreenRecordingAccess: () => ipcRenderer.invoke("check-screen-recording-access"),
  requestScreenRecordingAccess: () => ipcRenderer.invoke("request-screen-recording-access"),
  captureScreenContext: () => ipcRenderer.invoke("capture-screen-context"),
  setScreenContextEnabled: (enabled) => ipcRenderer.invoke("screen-context-set-enabled", enabled),
  pauseMediaPlayback: () => ipcRenderer.invoke("pause-media-playback"),
  resumeMediaPlayback: () => ipcRenderer.invoke("resume-media-playback"),
  muteOtherApps: () => ipcRenderer.invoke("mute-other-apps"),
  unmuteOtherApps: () => ipcRenderer.invoke("unmute-other-apps"),

  transcribeAudioFileByok: (options) => ipcRenderer.invoke("transcribe-audio-file-byok", options),

  // Dictation realtime streaming
  dictationRealtimeWarmup: (options) => ipcRenderer.invoke("dictation-realtime-warmup", options),
  dictationRealtimeStart: (options) => ipcRenderer.invoke("dictation-realtime-start", options),
  dictationRealtimeSend: (buffer) => ipcRenderer.send("dictation-realtime-send", buffer),
  dictationRealtimeFinalize: () => ipcRenderer.invoke("dictation-realtime-finalize"),
  dictationRealtimeStop: () => ipcRenderer.invoke("dictation-realtime-stop"),
  onDictationRealtimePartial: registerListener(
    "dictation-realtime-partial",
    (callback) => (_event, data) => callback(data)
  ),
  onDictationRealtimeFinal: registerListener(
    "dictation-realtime-final",
    (callback) => (_event, data) => callback(data)
  ),
  onDictationRealtimeError: registerListener(
    "dictation-realtime-error",
    (callback) => (_event, data) => callback(data)
  ),
  onDictationRealtimeSessionEnd: registerListener(
    "dictation-realtime-session-end",
    (callback) => (_event, data) => callback(data)
  ),

  // Globe key listener for hotkey capture (macOS only)
  onGlobeKeyPressed: (callback) => {
    const listener = () => callback?.();
    ipcRenderer.on("globe-key-pressed", listener);
    return () => ipcRenderer.removeListener("globe-key-pressed", listener);
  },
  onGlobeKeyReleased: (callback) => {
    const listener = () => callback?.();
    ipcRenderer.on("globe-key-released", listener);
    return () => ipcRenderer.removeListener("globe-key-released", listener);
  },

  // Hotkey registration events (for notifying user when hotkey fails)
  onHotkeyFallbackUsed: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("hotkey-fallback-used", listener);
    return () => ipcRenderer.removeListener("hotkey-fallback-used", listener);
  },
  onHotkeyRegistrationFailed: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("hotkey-registration-failed", listener);
    return () => ipcRenderer.removeListener("hotkey-registration-failed", listener);
  },
  onApiKeyUpdated: registerListener(
    "api-key-updated",
    (callback) => (_event, storeKey) => callback(storeKey)
  ),
  onSettingUpdated: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("setting-updated", listener);
    return () => ipcRenderer.removeListener("setting-updated", listener);
  },
  onDictationKeyActive: (callback) => {
    const listener = (_event, key) => callback?.(key);
    ipcRenderer.on("dictation-key-active", listener);
    return () => ipcRenderer.removeListener("dictation-key-active", listener);
  },
  onLinuxPttPermissionDenied: registerListener(
    "linux-ptt-permission-denied",
    (callback) => () => callback()
  ),

  // Settings shortcut (Cmd+, / Ctrl+,)
  onShowSettings: registerListener("show-settings", (callback) => () => callback()),
  // Tray "Show Control Panel"
  onShowHome: registerListener("show-home", (callback) => () => callback()),
  getPendingSettingsSection: () => ipcRenderer.invoke("get-pending-settings-section"),

  // Accessibility permission events (macOS)
  onAccessibilityMissing: (callback) => {
    const listener = () => callback?.();
    ipcRenderer.on("accessibility-missing", listener);
    return () => ipcRenderer.removeListener("accessibility-missing", listener);
  },

  // Notify main process of activation mode changes (for Windows Push-to-Talk)
  notifyActivationModeChanged: (mode) => ipcRenderer.send("activation-mode-changed", mode),
  notifyHotkeyChanged: (hotkey) => ipcRenderer.send("hotkey-changed", hotkey),

  // Floating icon auto-hide
  notifyFloatingIconAutoHideChanged: (enabled) =>
    ipcRenderer.send("floating-icon-auto-hide-changed", enabled),
  onFloatingIconAutoHideChanged: registerListener(
    "floating-icon-auto-hide-changed",
    (callback) => (_event, enabled) => callback(enabled)
  ),

  // Panel start position
  notifyPanelStartPositionChanged: (position) =>
    ipcRenderer.send("panel-start-position-changed", position),

  // Agent mode
  updateVoiceAgentHotkey: (hotkey) => ipcRenderer.invoke("update-voice-agent-hotkey", hotkey),
  getVoiceAgentKey: () => ipcRenderer.invoke("get-voice-agent-key"),
  onPreviewText: registerListener("preview-text", (callback) => (_event, text) => callback(text)),
  onPreviewAppend: registerListener(
    "preview-append",
    (callback) => (_event, text) => callback(text)
  ),
  onPreviewHold: registerListener(
    "preview-hold",
    (callback) => (_event, payload) => callback(payload)
  ),
  onPreviewResult: registerListener(
    "preview-result",
    (callback) => (_event, payload) => callback(payload)
  ),
  onPreviewHide: registerListener("preview-hide", (callback) => () => callback()),
  stopDictationPreview: (opts) => ipcRenderer.invoke("stop-dictation-preview", opts),
  dismissDictationPreview: () => ipcRenderer.invoke("dismiss-dictation-preview"),
  updateDictationPreview: (text) => ipcRenderer.invoke("update-dictation-preview", text),
  completeDictationPreview: (payload) => ipcRenderer.invoke("complete-dictation-preview", payload),
  hideDictationPreview: () => ipcRenderer.invoke("hide-dictation-preview"),

  // Agent conversation persistence
  createAgentConversation: (title) => ipcRenderer.invoke("db-create-agent-conversation", title),
  getAgentConversation: (id) => ipcRenderer.invoke("db-get-agent-conversation", id),
  addAgentMessage: (conversationId, role, content, metadata) =>
    ipcRenderer.invoke("db-add-agent-message", conversationId, role, content, metadata),
});
