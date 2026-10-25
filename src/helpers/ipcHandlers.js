const { ipcMain, app, shell, BrowserWindow, systemPreferences, net } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { isRestorablePasteTarget } = require("./windowsPasteTarget");
const crypto = require("crypto");
const debugLogger = require("./debugLogger");
const { broadcastToWindows } = require("./windowBroadcast");
const { openExternalUrl } = require("./externalUrlOpener");
const { BYOK_API_KEYS } = require("../config/secretKeys");
const chatgptAuth = require("./chatgptAuth");
const chatgptResponsesSocket = require("./chatgptResponsesSocket");
const { toPolicyFailure } = require("./policyResponseError");
const { resolveSystemDefaultMicrophone } = require("./systemDefaultMicrophone");
const { ipcErrorFields } = require("./ipcErrorFields");
const {
  PROVIDER_ERROR_CODES,
  isProviderSettingsTarget,
  providerHttpError,
  providerError,
  asProviderError,
  redactProviderBody,
} = require("./providerHttpErrors");
// ipcMain.handle keeps only the message when a promise rejects, dropping custom
// props — proxy handlers return the classified fields so the renderer can
// rebuild the error.
const serializeIpcError =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return ipcErrorFields(error);
    }
  };

const { i18nMain, changeLanguage } = require("./i18nMain");
const { focusWindowsHotkeyCaptureWindow } = require("./hotkeyCaptureFocus");
const { MistralRealtimeStreaming, MISTRAL_REALTIME_MODEL } = require("./mistralRealtimeStreaming");
const AudioStorageManager = require("./audioStorage");
const { applySmartSpacing } = require("./smartSpacing");
const { applyAutoLearnSetting } = require("./autoLearnSetting");
const {
  DEFAULT_RETENTION_SETTINGS,
  createRetentionSettingsHandler,
} = require("./retentionSettings");
const screenContextCapture = require("./screenContextCapture");
const { classifyToneAppCategory } = require("./toneAppCategories");
const { UPLOAD_AUDIO_EXTENSIONS } = require("../constants/uploadAudioFormats.json");
const { providerContentType, prepareProviderUpload } = require("./providerUploadAudio");

const MISTRAL_TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions";

// Debounce delay: wait for user to stop typing before processing corrections
const AUTO_LEARN_DEBOUNCE_MS = 1500;

const byokSizeCapError = (sizeCapBytes) =>
  `File too large. Maximum size for bring-your-own-key is ${Math.floor(sizeCapBytes / (1024 * 1024))} MB.`;

const { testProviderConnection } = require("./providerConnectionTest");
const { createConnectionCheckCache } = require("./connectionCheckCache");
const { PAID_KEY_CHECKS_FILE, createPaidKeyCheck } = require("./paidKeyCheck");
// Canonicalize allowed dirs so realpath'd inputs match on macOS (/var -> /private/var).
// Deliberately narrow: user-picked paths anywhere else are approved individually via
// approvedAudioPaths, so a compromised renderer can't read arbitrary files.
function getCanonicalAllowedAudioDirs() {
  const os = require("os");
  const { getSafeTempDir } = require("./safeTempDir");
  const dirs = [os.tmpdir(), getSafeTempDir(), app.getPath("userData")];
  return dirs.map((d) => {
    try {
      return fs.realpathSync(d);
    } catch {
      return d;
    }
  });
}

// User-picked paths (OS file dialog, real drag-dropped files) may live outside the
// static dirs (external volumes, /mnt, D:\) and are approved individually.
const approvedAudioPaths = new Set();

// Returns the realpath'd file path if it lives under an allowed dir, else null.
function resolveAllowedAudioPath(filePath) {
  const real = fs.realpathSync(path.resolve(filePath));
  if (approvedAudioPaths.has(real)) {
    return real;
  }
  const allowed = getCanonicalAllowedAudioDirs();
  if (allowed.some((dir) => real === dir || real.startsWith(dir + path.sep))) {
    return real;
  }
  return null;
}

function buildMultipartBody(fileBuffer, fileName, contentType, fields = {}) {
  const boundary = `----OnlyWhispers${Date.now()}`;
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  parts.push(fileBuffer);
  parts.push("\r\n");

  for (const [name, value] of Object.entries(fields)) {
    if (value != null) {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      );
    }
  }

  parts.push(`--${boundary}--\r\n`);

  const bodyParts = parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p));
  return { body: Buffer.concat(bodyParts), boundary };
}

async function postMultipart(
  url,
  body,
  boundary,
  headers = {},
  { signal, session: fetchSession } = {}
) {
  const response = await (fetchSession ?? net).fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      ...headers,
    },
    body,
    useSessionCookies: false,
    signal,
  });
  const text = await response.text();
  try {
    return { statusCode: response.status, data: JSON.parse(text) };
  } catch {
    // Vercel platform errors (413 payload cap, 504 timeout) return non-JSON bodies.
    throw Object.assign(new Error(`Server error ${response.status}: ${text.slice(0, 120)}`), {
      code: "SERVER_ERROR",
      statusCode: response.status,
    });
  }
}

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.windowManager = managers.windowManager;
    this.updateManager = managers.updateManager;
    this.windowsKeyManager = managers.windowsKeyManager;
    this.linuxKeyManager = managers.linuxKeyManager;
    this.textEditMonitor = managers.textEditMonitor;
    this.selectionManager = managers.selectionManager;
    this.getTrayManager = managers.getTrayManager;
    this.sessionId = crypto.randomUUID();
    this._dictationStreaming = null;
    this._dictationConnectPromise = null;
    this._dictationIdleTimer = null;
    this._hotkeyCaptureMode = false;
    this._autoLearnEnabled = true; // Default on, synced from renderer
    this._autoLearnDebounceTimer = null;
    this._autoLearnLatestData = null;
    this._textEditHandler = null;
    this._activeRecordingPipeline = null;
    this.audioStorageManager = new AudioStorageManager();
    this._retentionCleanupInterval = null;
    this._retentionSettings = { ...DEFAULT_RETENTION_SETTINGS }; // Synced from renderer
    this._retentionSettingsSynced = false;
    this._setupTextEditMonitor();
    this._setupRetentionCleanup();
    // Warm the OS default mic answer before the first hotkey press (~2s on Windows).
    resolveSystemDefaultMicrophone();
    this.setupHandlers();
  }

  // The dictation slot reports its own changes from the renderer. Slots
  // registered through IPC have to announce theirs here so macOS can re-derive
  // which keys the native Globe listener owns.
  _notifyHotkeyChanged(hotkey) {
    ipcMain.emit("hotkey-changed", null, hotkey);
  }

  _getDictionarySafe() {
    try {
      return this.databaseManager.getDictionary();
    } catch {
      return [];
    }
  }

  _cleanupTextEditMonitor() {
    if (this._autoLearnDebounceTimer) {
      clearTimeout(this._autoLearnDebounceTimer);
      this._autoLearnDebounceTimer = null;
    }
    this._autoLearnLatestData = null;
    if (this.textEditMonitor && this._textEditHandler) {
      this.textEditMonitor.removeListener("text-edited", this._textEditHandler);
      this._textEditHandler = null;
    }
  }

  _setupRetentionCleanup() {
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    // No sweep at startup: _retentionSettings still holds the 30-day default
    // until the renderer syncs, so sweeping here deletes audio a user set to
    // keep for 60/90 days or forever (#1370). The first sync runs the first
    // sweep instead.
    this._retentionCleanupInterval = setInterval(() => {
      if (this._retentionSettingsSynced) this._runRetentionCleanup();
    }, SIX_HOURS_MS);
  }

  _runRetentionCleanup() {
    const { audioRetentionDays, transcriptRetentionDays } = this._retentionSettings;
    try {
      if (transcriptRetentionDays > 0) {
        const { ids } =
          this.databaseManager.deleteTranscriptionsExpiredBefore(transcriptRetentionDays);
        for (const id of ids) {
          this.audioStorageManager.deleteAudio(id);
          broadcastToWindows("transcription-deleted", { id });
        }
      }
      if (audioRetentionDays > 0) {
        this.audioStorageManager.cleanupExpiredAudio(audioRetentionDays, this.databaseManager);
      }
    } catch (error) {
      debugLogger.error("Retention cleanup failed", { error: error.message }, "audio-storage");
    }
  }

  _setupTextEditMonitor() {
    if (!this.textEditMonitor) return;

    this._textEditHandler = (data) => {
      if (
        !data ||
        typeof data.originalText !== "string" ||
        typeof data.newFieldValue !== "string"
      ) {
        debugLogger.debug("[AutoLearn] Invalid event payload, skipping");
        return;
      }

      const { originalText, newFieldValue } = data;

      debugLogger.debug("[AutoLearn] text-edited event", {
        originalPreview: originalText.substring(0, 80),
        newValuePreview: newFieldValue.substring(0, 80),
      });

      this._autoLearnLatestData = { originalText, newFieldValue };

      if (this._autoLearnDebounceTimer) {
        clearTimeout(this._autoLearnDebounceTimer);
      }

      this._autoLearnDebounceTimer = setTimeout(() => {
        this._processCorrections();
      }, AUTO_LEARN_DEBOUNCE_MS);
    };

    this.textEditMonitor.on("text-edited", this._textEditHandler);
  }

  _processCorrections() {
    this._autoLearnDebounceTimer = null;
    if (!this._autoLearnLatestData) return;
    if (!this._autoLearnEnabled) {
      debugLogger.debug("[AutoLearn] Disabled, skipping correction processing");
      this._autoLearnLatestData = null;
      return;
    }

    const { originalText, newFieldValue } = this._autoLearnLatestData;
    this._autoLearnLatestData = null;

    try {
      const { extractCorrections } = require("../utils/correctionLearner");
      const currentDict = this._getDictionarySafe();
      const corrections = extractCorrections(originalText, newFieldValue, currentDict);
      debugLogger.debug("[AutoLearn] Corrections result", {
        corrections,
        dictSize: currentDict.length,
      });

      if (corrections.length > 0) {
        const saveResult = this.databaseManager.applyDictionaryChanges(
          { add: corrections },
          "learned"
        );

        if (saveResult?.success === false) {
          debugLogger.debug("[AutoLearn] Failed to save dictionary", { error: saveResult.error });
          return;
        }

        // Broadcast the post-save normalized list, not the raw input (which
        // still has case-variant dupes), so renderers don't flash ghost rows.
        broadcastToWindows("dictionary-updated", this.databaseManager.getDictionary());

        // Show the overlay so the toast is visible (it may have been hidden after dictation)
        this.windowManager.showDictationPanel();
        broadcastToWindows("corrections-learned", corrections);
        debugLogger.debug("[AutoLearn] Saved corrections", { corrections });
      }
    } catch (error) {
      debugLogger.debug("[AutoLearn] Error processing corrections", { error: error.message });
    }
  }

  _syncStartupEnv(setVars, clearVars = []) {
    let changed = false;
    for (const [key, value] of Object.entries(setVars)) {
      if (process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    for (const key of clearVars) {
      if (process.env[key]) {
        delete process.env[key];
        changed = true;
      }
    }
    if (changed) {
      debugLogger.debug("Synced startup env vars", {
        set: Object.keys(setVars),
        cleared: clearVars.filter((k) => !process.env[k]),
      });
      // Log which keys were lost when the .env write fails (#1340).
      this.environmentManager.saveAllKeysToEnvFile().catch((err) => {
        debugLogger.error("Failed to persist startup env vars to .env", {
          set: Object.keys(setVars),
          clearRequested: clearVars,
          error: err.message,
        });
      });
    }
  }

  setupHandlers() {
    ipcMain.handle("onboarding-set-window-mode", (_event, mode) =>
      this.windowManager.setOnboardingWindowMode(mode)
    );

    ipcMain.handle("permission-guide-state", (event) =>
      this.windowManager.permissionGuide.stateFor(event)
    );
    ipcMain.on("permission-guide-action", (event, action) =>
      this.windowManager.permissionGuide.handleAction(event, action)
    );
    ipcMain.on("permission-guide-drag", (event, target) =>
      this.windowManager.permissionGuide.startDrag(event, target)
    );

    ipcMain.handle("onboarding-set-active", (_event, active) => {
      if (typeof active !== "boolean") return false;
      return this.windowManager.setOnboardingActive(active);
    });

    // Every panel showing the same credentials and model shares one answer.
    const cachedConnectionCheck = createConnectionCheckCache();
    const runPaidKeyCheck = createPaidKeyCheck(() =>
      path.join(app.getPath("userData"), PAID_KEY_CHECKS_FILE)
    );
    ipcMain.handle("test-provider-connection", (_event, config) =>
      cachedConnectionCheck(config, () => testProviderConnection(config, fetch, runPaidKeyCheck))
    );

    ipcMain.handle("window-minimize", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.minimize();
      }
    });

    ipcMain.handle("window-maximize", () => {
      if (this.windowManager.controlPanelWindow) {
        if (this.windowManager.controlPanelWindow.isMaximized()) {
          this.windowManager.controlPanelWindow.unmaximize();
        } else {
          this.windowManager.controlPanelWindow.maximize();
        }
      }
    });

    ipcMain.handle("window-close", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.close();
      }
    });

    ipcMain.handle("window-is-maximized", () => {
      if (this.windowManager.controlPanelWindow) {
        return this.windowManager.controlPanelWindow.isMaximized();
      }
      return false;
    });

    ipcMain.handle("hide-window", () => {
      this.windowManager.hideDictationPanel();
    });

    ipcMain.handle("show-dictation-panel", () => {
      this.windowManager.showDictationPanel({ reposition: true });
    });

    ipcMain.handle("open-settings-section", async (_event, section) => {
      if (!isProviderSettingsTarget(section)) return { success: false };
      await this.windowManager.openSettings(section);
      return { success: true };
    });

    ipcMain.handle("capture-dictation-target", async () => {
      // Recording start awaits this handler, so the Linux/Windows window probe
      // runs in the background: a stalled AT-SPI peer would otherwise hold the
      // microphone for seconds (#1944). Its consumers wait for it themselves.
      void this.selectionManager?.captureTarget?.();
      const pid = (await this.textEditMonitor?.captureTargetPid?.()) ?? null;
      return { success: true, pid };
    });

    // Tone & Style: which kind of app the dictation is going into. Runs while
    // the user speaks; only the category reaches the renderer.
    ipcMain.handle("capture-dictation-app-category", async () => {
      const context = await this.selectionManager?.getTargetAppContext?.();
      const category = classifyToneAppCategory(context);
      debugLogger.debug("Dictation app category", {
        category,
        hasWindowTitle: !!context?.windowTitle,
        hasUrlHost: !!context?.urlHost,
      });
      return category;
    });

    ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
      this.windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
      return { success: true };
    });

    ipcMain.handle("set-main-window-input-region", (event, region) => {
      if (event.sender !== this.windowManager.mainWindow?.webContents) return null;
      return this.windowManager.setMainWindowInputRegion(region);
    });

    ipcMain.handle("get-main-window-horizontal-direction", () => {
      return this.windowManager.getMainWindowHorizontalDirection();
    });

    ipcMain.handle("resize-main-window", (event, sizeKey) => {
      return this.windowManager.resizeMainWindow(sizeKey);
    });

    ipcMain.handle("resize-assistant-window-to-content", (event, surfaceHeight) => {
      return this.windowManager.resizeAssistantWindowToContent(surfaceHeight);
    });

    ipcMain.handle("resize-dictation-error-window-to-content", (event, surfaceHeight) => {
      return this.windowManager.resizeDictationErrorWindowToContent(surfaceHeight);
    });

    // Counts changes to any key in Settings. A streaming socket keeps the count it
    // was opened under, so a start never reuses one authenticated before a change.
    let credentialGeneration = 0;
    const saveSecretKey = (getter, saver, storeKey) => (event, key) => {
      if (typeof key !== "string") throw new TypeError("API key must be a string");
      // Committing an unedited key field saves the same value again.
      const changed = this.environmentManager[getter]() !== key;
      const result = this.environmentManager[saver](key);
      if (!changed) return result;
      credentialGeneration += 1;
      // Notify peers by setting name only; leave the editor's pending input alone.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents.id !== event.sender.id) {
          win.webContents.send("api-key-updated", storeKey);
        }
      }
      return result;
    };

    for (const k of BYOK_API_KEYS) {
      ipcMain.handle(`get-${k.base}-key`, () => this.environmentManager[k.get]());
      ipcMain.handle(`save-${k.base}-key`, saveSecretKey(k.get, k.save, k.storeKey));
    }

    // Sign in with ChatGPT: OpenAI cleanup runs on the user's ChatGPT plan.
    ipcMain.handle(
      "chatgpt-sign-in",
      serializeIpcError(() => chatgptAuth.signIn())
    );
    ipcMain.handle("chatgpt-sign-out", () => chatgptAuth.signOut());
    ipcMain.handle("chatgpt-status", () => chatgptAuth.status());
    ipcMain.handle("chatgpt-access-token", () => chatgptAuth.getAccessToken());
    ipcMain.handle("chatgpt-socket-warmup", () => chatgptResponsesSocket.warmup());
    ipcMain.handle("chatgpt-socket-response", (_event, body, timeoutMs) =>
      chatgptResponsesSocket
        .createResponse(body, timeoutMs)
        .then((result) => ({ success: true, ...result }))
        .catch((error) => ({ success: false, error: error.message }))
    );

    ipcMain.handle("db-save-transcription", async (event, text, rawText, options) => {
      const result = this.databaseManager.saveTranscription(text, rawText, options);
      if (result?.success && result?.transcription) {
        setImmediate(() => {
          broadcastToWindows("transcription-added", result.transcription);
        });
      }
      return result;
    });

    ipcMain.handle("db-get-transcriptions", async (event, limit = 50, options = {}) => {
      return this.databaseManager.getTranscriptions(limit, options);
    });

    ipcMain.handle("db-clear-transcriptions", async (event) => {
      this.audioStorageManager.deleteAllAudio();
      const result = this.databaseManager.clearTranscriptions();
      if (result?.success) {
        setImmediate(() => {
          broadcastToWindows("transcriptions-cleared", {
            cleared: result.cleared,
          });
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-transcription", async (event, id) => {
      return this.deleteTranscriptionInternal(id);
    });

    // Audio storage handlers
    ipcMain.handle("save-transcription-audio", async (event, id, audioBuffer, metadata) => {
      const transcription = this.databaseManager.getTranscriptionById(id);
      const timestamp = transcription?.timestamp || null;
      const result = this.audioStorageManager.saveAudio(id, Buffer.from(audioBuffer), timestamp);
      if (result.success) {
        this.databaseManager.updateTranscriptionAudio(id, {
          hasAudio: 1,
          audioDurationMs: metadata?.durationMs || null,
          provider: metadata?.provider || null,
          model: metadata?.model || null,
        });
        const updated = this.databaseManager.getTranscriptionById(id);
        if (updated) broadcastToWindows("transcription-updated", updated);
      }
      return result;
    });

    ipcMain.handle("merge-audio-segments", async (_event, segments) => {
      try {
        if (!Array.isArray(segments) || segments.length < 2 || segments.length > 100) {
          throw new Error("Invalid audio segment count");
        }
        const normalized = segments.map((segment) => {
          if (!segment?.buffer || typeof segment.mimeType !== "string") {
            throw new Error("Invalid audio segment");
          }
          return { buffer: Buffer.from(segment.buffer), mimeType: segment.mimeType };
        });
        const { mergeAudioSegments } = require("./ffmpegUtils");
        const buffer = await mergeAudioSegments(normalized);
        // Slice to a real ArrayBuffer: Buffers sent over IPC arrive as Uint8Array,
        // and pooled Buffers share a larger underlying allocation.
        return {
          success: true,
          buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          mimeType: "audio/webm",
        };
      } catch (error) {
        debugLogger.error("Failed to merge recovered audio segments", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("show-audio-in-folder", async (event, id) => {
      const filePath = this.audioStorageManager.getAudioPath(id);
      if (!filePath) return { success: false };
      shell.showItemInFolder(filePath);
      return { success: true };
    });

    ipcMain.handle("get-transcription-audio", async (event, id) => {
      const buffer = this.audioStorageManager.getAudioBuffer(id);
      if (!buffer) return { success: false };
      // Slice to a real ArrayBuffer, like merge-audio-segments above.
      return {
        success: true,
        buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    });

    ipcMain.on(
      "retention-settings-changed",
      createRetentionSettingsHandler({
        getCurrentSettings: () => this._retentionSettings,
        getOwner: () => this.windowManager.mainWindow?.webContents,
        hasSynced: () => this._retentionSettingsSynced,
        onSettingsChanged: (settings) => {
          this._retentionSettings = settings;
          this._retentionSettingsSynced = true;
          this._runRetentionCleanup();
        },
      })
    );

    // Hotkey handlers run in main, while AudioManager owns the real lifecycle
    // in the dictation renderer. Only confirmed renderer state may change the
    // main-process recording gate; raw key presses are merely requests and can
    // be declined while a transcript is still being finalized.
    ipcMain.on("dictation-lifecycle-state-changed", (event, state, inputKind) => {
      const dictationWindow = this.windowManager.mainWindow;
      if (
        !dictationWindow ||
        dictationWindow.isDestroyed() ||
        event.sender !== dictationWindow.webContents
      ) {
        return;
      }
      this.windowManager.setDictationLifecycleState(state, inputKind);
    });

    ipcMain.on("show-agent-dictation-final-transcript", (event, text) => {
      const dictationWindow = this.windowManager.mainWindow;
      if (
        !dictationWindow ||
        dictationWindow.isDestroyed() ||
        event.sender !== dictationWindow.webContents
      ) {
        return;
      }
      if (typeof text !== "string" || !text.trim()) return;
      this.windowManager.showAgentDictationFinalTranscript(text);
    });

    ipcMain.on("dictation-audio-level-changed", (event, level) => {
      const dictationWindow = this.windowManager.mainWindow;
      if (
        !dictationWindow ||
        dictationWindow.isDestroyed() ||
        event.sender !== dictationWindow.webContents
      ) {
        return;
      }
      this.windowManager.setDictationAudioLevel(level);
    });

    // Dictionary handlers
    ipcMain.on("auto-learn-changed", (_event, enabled) => {
      // Both renderer windows re-sync this on mount — ignore same-value updates (#1080).
      const { changed, enabled: next } = applyAutoLearnSetting(this._autoLearnEnabled, enabled);
      if (!changed) return;
      this._autoLearnEnabled = next;
      if (!this._autoLearnEnabled) {
        if (this._autoLearnDebounceTimer) {
          clearTimeout(this._autoLearnDebounceTimer);
          this._autoLearnDebounceTimer = null;
        }
        this._autoLearnLatestData = null;
      }
      debugLogger.debug("[AutoLearn] Setting changed", { enabled: this._autoLearnEnabled });
    });

    ipcMain.handle("db-get-dictionary", async () => {
      return this.databaseManager.getDictionary();
    });

    ipcMain.handle("db-set-dictionary", async (event, words) => {
      if (!Array.isArray(words)) {
        throw new Error("words must be an array");
      }
      return this.databaseManager.setDictionary(words);
    });

    ipcMain.handle("db-apply-dictionary-changes", async (_event, changes) => {
      const { add, remove } = changes ?? {};
      if (add !== undefined && !Array.isArray(add)) {
        throw new Error("add must be an array");
      }
      if (remove !== undefined && !Array.isArray(remove)) {
        throw new Error("remove must be an array");
      }
      return this.databaseManager.applyDictionaryChanges({ add, remove });
    });

    ipcMain.handle("db-get-snippets", async () => {
      return this.databaseManager.getSnippets();
    });

    ipcMain.handle("db-set-snippets", async (_event, snippets) => {
      if (!Array.isArray(snippets)) {
        throw new Error("snippets must be an array");
      }
      return this.databaseManager.setSnippets(snippets);
    });

    ipcMain.handle("undo-learned-corrections", async (_event, words) => {
      try {
        if (!Array.isArray(words) || words.length === 0) {
          return { success: false };
        }
        const validWords = words.filter((w) => typeof w === "string" && w.trim().length > 0);
        if (validWords.length === 0) {
          return { success: false };
        }
        const saveResult = this.databaseManager.applyDictionaryChanges({ remove: validWords });
        if (saveResult?.success === false) {
          debugLogger.debug("[AutoLearn] Undo failed to save dictionary", {
            error: saveResult.error,
          });
          return { success: false };
        }
        broadcastToWindows("dictionary-updated", this.databaseManager.getDictionary());
        debugLogger.debug("[AutoLearn] Undo: removed words", { words: validWords });
        return { success: true };
      } catch (err) {
        debugLogger.debug("[AutoLearn] Undo failed", { error: err.message });
        return { success: false };
      }
    });

    // Agent conversation handlers
    ipcMain.handle("db-create-agent-conversation", async (event, title) => {
      return this.databaseManager.createAgentConversation(title);
    });

    ipcMain.handle("db-get-agent-conversation", async (event, id) => {
      return this.databaseManager.getAgentConversation(id);
    });

    ipcMain.handle(
      "db-add-agent-message",
      async (event, conversationId, role, content, metadata) => {
        const result = this.databaseManager.addAgentMessage(
          conversationId,
          role,
          content,
          metadata
        );
        return result;
      }
    );

    ipcMain.handle("export-dictionary", async (event, words) => {
      try {
        const { dialog } = require("electron");
        const fs = require("fs");

        const result = await dialog.showSaveDialog({
          defaultPath: "dictionary.txt",
          filters: [{ name: "Text", extensions: ["txt"] }],
        });

        if (result.canceled || !result.filePath) return { success: false };

        fs.writeFileSync(result.filePath, words.join("\n"), "utf-8");
        return { success: true };
      } catch (error) {
        debugLogger.error("Error exporting dictionary", { error: error.message }, "dictionary");
        return { success: false, error: error.message };
      }
    });

    // Upload on Home: the picked file becomes a failed row holding its audio,
    // so the renderer can run it through Retry like a failed dictation.
    ipcMain.handle("import-audio-file", async () => {
      const { dialog } = require("electron");
      const fs = require("fs");
      const os = require("os");
      const picked = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Audio and Video Files", extensions: UPLOAD_AUDIO_EXTENSIONS }],
      });
      if (picked.canceled || !picked.filePaths.length) return { success: false };
      const webmPath = path.join(os.tmpdir(), `only-whispers-upload-${Date.now()}.webm`);
      try {
        await require("./ffmpegUtils").convertToWebm(picked.filePaths[0], webmPath);
        const saved = this.databaseManager.saveTranscription("", null, {
          status: "failed",
          errorMessage: "Uploaded file, not transcribed yet",
        });
        if (!saved?.success || !saved.transcription) throw new Error("Could not save the upload");
        const id = saved.transcription.id;
        const stored = this.audioStorageManager.saveAudio(
          id,
          fs.readFileSync(webmPath),
          saved.transcription.timestamp
        );
        if (!stored.success) throw new Error("Could not save the audio");
        this.databaseManager.updateTranscriptionAudio(id, {
          hasAudio: 1,
          audioDurationMs: null,
          provider: null,
          model: null,
        });
        return { success: true, transcription: this.databaseManager.getTranscriptionById(id) };
      } catch (error) {
        debugLogger.warn("Audio upload failed", { error: error.message });
        return { success: false, error: error.message };
      } finally {
        fs.rmSync(webmPath, { force: true });
      }
    });

    ipcMain.handle("capture-selected-text", async (event, options = {}) => {
      if (!this.selectionManager) {
        return { status: "unavailable", code: "selection_manager_unavailable" };
      }
      return this.selectionManager.captureSelectedText({
        probeEditable: options.probeEditable === true,
      });
    });

    ipcMain.handle("replace-selected-text", async (event, sessionId, text, options = {}) => {
      if (!this.selectionManager) {
        return { success: false, code: "selection_manager_unavailable" };
      }
      return this.selectionManager.replaceSelectedText(sessionId, text, {
        restoreClipboard: options.restoreClipboard !== false,
        allowClipboardFallback: options.allowClipboardFallback === true,
        webContents: event.sender,
      });
    });

    ipcMain.handle("paste-at-captured-target", async (event, sessionId, text, options = {}) => {
      if (!this.selectionManager) {
        return { success: false, code: "selection_manager_unavailable" };
      }
      return this.selectionManager.pasteAtCapturedTarget(sessionId, text, {
        restoreClipboard: options.restoreClipboard !== false,
        allowClipboardFallback: options.allowClipboardFallback === true,
        webContents: event.sender,
      });
    });

    ipcMain.handle("paste-text", async (event, text, options) => {
      const mainWindow = this.windowManager?.mainWindow;
      const targetPid = this.textEditMonitor?.lastTargetPid || null;

      // Activating the target by PID is more reliable than hide()'s implicit
      // focus hand-off for Chromium apps like Claude desktop and Brave (#668).
      let activated = false;
      if (process.platform === "darwin" && this.textEditMonitor) {
        activated = await this.textEditMonitor.activateTargetPid();
      }

      if (!activated && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
        if (process.platform === "darwin") {
          mainWindow.hide();
          await new Promise((resolve) => setTimeout(resolve, 120));
          mainWindow.showInactive();
        } else {
          mainWindow.blur();
          // On Linux blur() leaves X focus on the pill, where the assistant panel
          // took it, so the paste would land in the panel.
          if (process.platform === "linux") this.windowManager.returnLinuxKeyboardFocus();
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      }

      // Smart spacing (#856): append a trailing space so the next paste's leading
      // space self-corrects the gap. Reading the char before the cursor to space
      // the front instead would take a macOS Accessibility read costing hundreds
      // of ms — too slow for the paste hot path.
      const textToPaste = applySmartSpacing(text);

      // Windows: restore the foreground window captured at record start so the
      // paste lands in the field the user was dictating into, not wherever focus
      // drifted during transcription (#859). macOS handles this via
      // activateTargetPid above; Linux re-detects the target inside pasteLinux.
      const winTarget =
        process.platform === "win32"
          ? ((await this.selectionManager?.getWinTarget?.()) ?? null)
          : null;
      const targetWindow =
        winTarget &&
        isRestorablePasteTarget({
          target: winTarget,
          ownExeName: path.basename(process.execPath),
          ownWindowHandles: BrowserWindow.getAllWindows()
            .filter((win) => !win.isDestroyed())
            .map((win) => win.getNativeWindowHandle()),
        })
          ? winTarget.id
          : null;

      let pasteResult;
      try {
        pasteResult = await this.clipboardManager.pasteText(textToPaste, {
          ...options,
          webContents: event.sender,
          targetWindow,
          silentAccessibilityCheck: true,
        });
      } catch (error) {
        if (error?.code !== "ACCESSIBILITY_PERMISSION_REQUIRED" || error.clipboardCopied !== true) {
          throw error;
        }
        return {
          success: false,
          pasted: false,
          code: "ACCESSIBILITY_PERMISSION_REQUIRED",
          clipboardCopied: true,
        };
      }
      const pasted = pasteResult?.pasted !== false;
      debugLogger.debug("[AutoLearn] Paste completed", {
        autoLearnEnabled: this._autoLearnEnabled,
        hasMonitor: !!this.textEditMonitor,
        targetPid,
        pasted,
      });
      if (pasted && this.textEditMonitor && this._autoLearnEnabled) {
        setTimeout(() => {
          try {
            debugLogger.debug("[AutoLearn] Starting monitoring", {
              textPreview: text.substring(0, 80),
            });
            this.textEditMonitor.startMonitoring(text, 30000, { targetPid });
          } catch (err) {
            debugLogger.debug("[AutoLearn] Failed to start monitoring", { error: err.message });
          }
        }, 500);
      }
      // ClipboardManager returns `restoreComplete` so main-process callers can
      // serialize subsequent clipboard work behind its delayed restore. A
      // Promise cannot cross Electron's IPC boundary, though, and renderer
      // callers need to know whether text was pasted, but not the delayed
      // clipboard restoration promise. Successful platform paths predate the
      // explicit `pasted` outcome; only the clipboard-only fallback and a held-back
      // paste (held modifiers or a missing or failed wl-copy, which carries a `reason`) set false.
      return {
        success: true,
        pasted,
        ...(pasteResult?.reason ? { reason: pasteResult.reason } : {}),
      };
    });

    ipcMain.handle("check-accessibility-permission", async (_event, silent = false) => {
      return this.clipboardManager.checkAccessibilityPermissions(silent);
    });

    ipcMain.handle("read-clipboard", async (event) => {
      return this.clipboardManager.readClipboard();
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text, event.sender);
    });

    ipcMain.handle("check-paste-tools", async () => {
      return this.clipboardManager.checkPasteTools();
    });

    // Voice drafts (chat input): persist a recorded buffer so the file-based
    // transcription pipeline (all providers) can consume it, then delete it.
    ipcMain.handle("save-temp-audio", async (_event, buffer) => {
      const tempPath = path.join(
        os.tmpdir(),
        `only-whispers-voice-draft-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.webm`
      );
      fs.writeFileSync(tempPath, Buffer.from(buffer));
      return { success: true, path: tempPath };
    });

    ipcMain.handle("delete-temp-audio", async (_event, tempPath) => {
      // Only files this handler family created are deletable.
      const resolved = path.resolve(tempPath);
      const validPrefix = path.join(os.tmpdir(), "only-whispers-voice-draft-");
      if (!resolved.startsWith(validPrefix)) {
        return { success: false, error: "Invalid temp path" };
      }
      try {
        fs.unlinkSync(resolved);
      } catch {
        // Already gone — fine.
      }
      return { success: true };
    });

    ipcMain.handle("update-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateHotkey(hotkey);
    });

    ipcMain.handle("set-hotkey-listening-mode", async (event, enabled) => {
      if (enabled) {
        const captureWindow = BrowserWindow.fromWebContents(event.sender);
        // Only the control panel owns editable hotkey fields. Refocusing the
        // sender before the idempotence check also repairs a stale capture-mode
        // flag after Windows has moved foreground focus to another window.
        if (captureWindow === this.windowManager.controlPanelWindow) {
          focusWindowsHotkeyCaptureWindow(captureWindow);
        }
      }
      if (this._hotkeyCaptureMode === enabled) return { success: true, skipped: true };
      this._hotkeyCaptureMode = enabled;
      this.windowManager.setHotkeyListeningMode(enabled);
      ipcMain.emit("hotkey-listening-mode-changed", null, enabled);
      const hotkeyManager = this.windowManager.hotkeyManager;

      // Restore from slot state only. A freshly captured hotkey is registered by
      // its own update IPC (invoked before this one); re-binding it here would
      // overwrite the primary on DE backends or leak untracked registrations.
      const effectiveHotkey = hotkeyManager.getCurrentHotkey();

      const {
        isGlobeLikeHotkey,
        isModifierOnlyHotkey,
        isRightSideModifier,
        isMouseButtonHotkey,
      } = require("./hotkeyManager");
      const usesNativeListener = (hotkey) =>
        !hotkey ||
        isGlobeLikeHotkey(hotkey) ||
        isMouseButtonHotkey(hotkey) ||
        isModifierOnlyHotkey(hotkey) ||
        isRightSideModifier(hotkey);

      if (enabled) {
        // Entering capture mode — unregister ALL slots so none intercept keypresses.
        // Dictation is always active; the voice assistant may or may not be set.
        const allSlots = hotkeyManager.slots;
        for (const [slot, info] of allSlots) {
          // Native-listener entries (null accelerator) are handled by stopping
          // the key listeners below.
          for (const accel of info?.accelerators || []) {
            if (!accel) continue;
            debugLogger.log(
              `[IPC] Unregistering globalShortcut "${accel}" (slot "${slot}") for capture mode`
            );
            const { globalShortcut } = require("electron");
            try {
              globalShortcut.unregister(accel);
            } catch {}
          }
        }

        // On Windows, stop the Windows key listener
        if (process.platform === "win32" && this.windowsKeyManager) {
          debugLogger.log("[IPC] Stopping Windows key listener for hotkey capture mode");
          this.windowsKeyManager.stop();
        }

        // On Linux, stop the Linux key listener
        if (process.platform === "linux" && this.linuxKeyManager) {
          debugLogger.log("[IPC] Stopping Linux key listener for hotkey capture mode");
          this.linuxKeyManager.stop();
        }

        // On GNOME, unregister all native keybindings during capture
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager) {
          await hotkeyManager.gnomeManager.unregisterPushToTalk();
          for (const slot of [...hotkeyManager.gnomeManager.registeredSlots]) {
            debugLogger.log(
              `[IPC] Unregistering GNOME keybinding (slot "${slot}") for capture mode`
            );
            await hotkeyManager.gnomeManager.unregisterKeybinding(slot).catch((err) => {
              debugLogger.warn(`[IPC] Failed to unregister GNOME slot "${slot}":`, err.message);
            });
          }
        }

        // On Hyprland Wayland, unregister the keybinding during capture
        if (hotkeyManager.isUsingHyprland() && hotkeyManager.hyprlandManager) {
          debugLogger.log("[IPC] Unregistering Hyprland keybinding for hotkey capture mode");
          const unregistered = await hotkeyManager.hyprlandManager
            .unregisterKeybinding()
            .catch((err) => {
              debugLogger.warn("[IPC] Failed to unregister Hyprland keybinding:", err.message);
              return false;
            });
          if (!unregistered) {
            debugLogger.warn("[IPC] Hyprland keybinding remained active during capture");
          }
        }
      } else {
        // Exiting capture mode - re-register globalShortcut if not already registered
        // Skip for KDE/GNOME/Hyprland — updateHotkey handles re-registration via native path
        const usesNativePath =
          hotkeyManager.isUsingKDE() ||
          hotkeyManager.isUsingGnome() ||
          hotkeyManager.isUsingHyprland();
        if (!usesNativePath) {
          const { globalShortcut } = require("electron");
          // Re-register every globalShortcut-backed dictation hotkey (the slot
          // may hold several).
          for (const hk of hotkeyManager.getSlotHotkeys("dictation")) {
            if (!hk || usesNativeListener(hk)) continue;
            const accelerator = hk;
            if (!globalShortcut.isRegistered(accelerator)) {
              debugLogger.log(
                `[IPC] Re-registering globalShortcut "${accelerator}" after capture mode`
              );
              const callback = this.windowManager.createHotkeyCallback();
              const registered = globalShortcut.register(accelerator, () => callback(hk));
              if (!registered) {
                debugLogger.warn(
                  `[IPC] Failed to re-register globalShortcut "${accelerator}" after capture mode`
                );
              }
            }
          }
        }

        // Re-sync native key listeners (Windows/Linux) across all hotkey slots now
        // that capture is done. Idempotent — reads the current slot hotkeys.
        this.windowManager.reconcileNativeKeyListeners();

        // On GNOME, re-register the keybinding with the effective hotkey
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager && effectiveHotkey) {
          debugLogger.log(
            `[IPC] Re-registering GNOME keybinding "${effectiveHotkey}" after capture mode`
          );
          await hotkeyManager.registerGnomeDictationHotkey(
            effectiveHotkey,
            this.windowManager.createHotkeyCallback()
          );
        }

        // On Hyprland Wayland, re-register the keybinding with the effective hotkey
        if (hotkeyManager.isUsingHyprland() && hotkeyManager.hyprlandManager && effectiveHotkey) {
          debugLogger.log(
            `[IPC] Re-registering Hyprland keybinding "${effectiveHotkey}" after capture mode`
          );
          await hotkeyManager.hyprlandManager.registerKeybinding(
            effectiveHotkey,
            this.windowManager.getActivationMode() === "push"
          );
        }

        // On KDE (X11 or Wayland), re-register the keybinding with the effective hotkey
        if (hotkeyManager.isUsingKDE() && hotkeyManager.kdeManager && effectiveHotkey) {
          debugLogger.log(
            `[IPC] Re-registering KDE keybinding "${effectiveHotkey}" after capture mode`
          );
          const callback = this.windowManager.createHotkeyCallback();
          const result = await hotkeyManager.kdeManager.registerKeybinding(
            effectiveHotkey,
            "dictation",
            callback,
            this.windowManager.getActivationMode() === "push"
          );
          if (result !== true) {
            debugLogger.warn(
              `[IPC] Failed to re-register KDE keybinding "${effectiveHotkey}" after capture mode`,
              { result }
            );
          }
        }

        // Re-register non-dictation slots (voice assistant) that were unregistered on capture enter
        for (const [slot, info] of hotkeyManager.slots) {
          const hotkeys = info?.hotkeys || [];
          if (slot === "dictation" || slot === "cancel" || hotkeys.length === 0 || !info?.callback)
            continue;
          debugLogger.log(
            `[IPC] Re-registering slot "${slot}" ("${hotkeys.join(", ")}") after capture mode`
          );
          const result = await hotkeyManager
            .registerSlot(slot, hotkeys, info.callback)
            .catch((err) => {
              debugLogger.warn(`[IPC] Failed to re-register slot "${slot}":`, err.message);
              return { success: false };
            });
          if (!result.success) {
            debugLogger.warn(`[IPC] Slot "${slot}" was not restored after capture`);
          }
        }
      }

      return { success: true };
    });

    ipcMain.handle("get-hotkey-mode-info", async (_event, requestedHotkey) => {
      const hotkeyManager = this.windowManager.hotkeyManager;
      const hotkey =
        typeof requestedHotkey === "string" && requestedHotkey.trim()
          ? requestedHotkey.split(",")[0].trim()
          : hotkeyManager.getCurrentHotkey();
      const isUsingNativeShortcut = this.windowManager.isUsingNativeShortcutHotkeys();
      const supportsPushToTalk = hotkeyManager.supportsPushToTalk(hotkey);

      return {
        isUsingGnome: this.windowManager.isUsingGnomeHotkeys(),
        isUsingHyprland: this.windowManager.isUsingHyprlandHotkeys(),
        isUsingKDE: this.windowManager.isUsingKDEHotkeys(),
        isUsingNativeShortcut,
        supportsPushToTalk,
        pushToTalkUnavailableReason: supportsPushToTalk
          ? null
          : hotkeyManager.getPushToTalkUnavailableReason(hotkey),
        // Lets the renderer show the setup box outside push mode, where the
        // disabled-Hold tooltip is the only other place this surfaces. Desktop
        // backends see their own hotkeys, so access matters only without one.
        linuxInputAccessDenied:
          hotkeyManager.reliesOnLinuxKeyListener() &&
          hotkeyManager.nativeListenerProbe().reason === "input_access_denied",
      };
    });

    ipcMain.handle("get-hyprland-config-status", async () => {
      if (!this.windowManager.isUsingHyprlandHotkeys()) return null;
      return this.windowManager.getHyprlandConfigStatus();
    });

    ipcMain.handle("register-cancel-hotkey", async (event, key) => {
      const hotkeyManager = this.windowManager.hotkeyManager;
      const mainWindow = this.windowManager.mainWindow;
      return hotkeyManager.registerSlot("cancel", key, () => {
        mainWindow?.webContents?.send("cancel-hotkey-pressed");
      });
    });

    ipcMain.handle("unregister-cancel-hotkey", async () => {
      this.windowManager.hotkeyManager.unregisterSlot("cancel");
      return { success: true };
    });

    ipcMain.handle("start-window-drag", async (event) => {
      return await this.windowManager.startWindowDrag();
    });

    ipcMain.handle("stop-window-drag", async (event) => {
      return await this.windowManager.stopWindowDrag();
    });

    ipcMain.handle("start-control-panel-drag", async () => {
      return await this.windowManager.startControlPanelDrag();
    });

    ipcMain.handle("stop-control-panel-drag", async () => {
      return await this.windowManager.stopControlPanelDrag();
    });

    ipcMain.handle("open-external", async (event, url) => {
      try {
        const { protocol } = new URL(url);
        if (!["http:", "https:", "mailto:"].includes(protocol)) {
          return { success: false, error: `Blocked URL scheme: ${protocol}` };
        }
        await openExternalUrl(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle(
      "proxy-mistral-transcription",
      serializeIpcError(async (event, { audioBuffer, model, contextBias }) => {
        const apiKey = this.environmentManager.getMistralKey();
        if (!apiKey) {
          throw providerError(PROVIDER_ERROR_CODES.KEY_MISSING, {
            provider: "Mistral",
            surface: "transcription",
          });
        }

        const transcriptionModel = model || "voxtral-mini-transcribe-3-0";
        const formData = new FormData();
        const audioBlob = new Blob([Buffer.from(audioBuffer)], { type: "audio/webm" });
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", transcriptionModel);
        // English only, whatever the settings say: auto detection sometimes heard French.
        formData.append("language", "en");
        if (contextBias && contextBias.length > 0) {
          for (const token of contextBias) {
            formData.append("context_bias", token);
          }
        }

        const response = await proxyFetch(MISTRAL_TRANSCRIPTION_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          debugLogger.warn("Mistral transcription failed", {
            status: response.status,
            body: redactProviderBody(errorText),
          });
          throw providerHttpError({
            provider: "Mistral",
            model: transcriptionModel,
            status: response.status,
            body: errorText,
            headers: response.headers,
            surface: "transcription",
          });
        }

        return await response.json();
      })
    );

    ipcMain.handle("get-dictation-key", async () => {
      return this.environmentManager.getDictationKey();
    });

    ipcMain.handle("save-dictation-key", async (event, key) => {
      return this.environmentManager.saveDictationKey(key);
    });

    ipcMain.handle("get-active-dictation-key", async () => {
      const hotkeys = this.windowManager?.hotkeyManager?.getSlotHotkeys?.("dictation") ?? [];
      return hotkeys.length > 0 ? hotkeys.join(",") : null;
    });

    ipcMain.handle("get-effective-default-hotkey", async () => {
      return this.windowManager?.hotkeyManager?.getEffectiveDefaultHotkey() ?? null;
    });

    // The mode in effect: startup can fall back to Tap for this session while
    // the saved preference stays Hold for the next launch.
    ipcMain.handle("get-activation-mode", async () => {
      return this.windowManager.getActivationMode();
    });

    ipcMain.handle("get-ui-language", async () => {
      return this.environmentManager.getUiLanguage();
    });

    ipcMain.handle("set-ui-language", async (event, language) => {
      const result = this.environmentManager.saveUiLanguage(language);
      process.env.UI_LANGUAGE = result.language;
      changeLanguage(result.language);
      this.windowManager?.refreshLocalizedUi?.();
      this.getTrayManager?.()?.updateTrayMenu?.();
      return { success: true, language: result.language };
    });

    ipcMain.handle("save-all-keys-to-env", async () => {
      return this.environmentManager.saveAllKeysToEnvFile();
    });

    ipcMain.handle("sync-startup-preferences", async () => {
      const setVars = {};
      const clearVars = [];

      // TODO: drop legacy REASONING_PROVIDER / LOCAL_REASONING_MODEL clears once
      // the read fallback is removed (~2 releases after this lands).
      clearVars.push("REASONING_PROVIDER", "LOCAL_REASONING_MODEL");

      // Local cleanup models are gone too; clear the startup pre-warm keys and
      // GPU pack flags that older builds saved.
      clearVars.push(
        "CLEANUP_PROVIDER",
        "LOCAL_CLEANUP_MODEL",
        "DICTATION_AGENT_PROVIDER",
        "LOCAL_DICTATION_AGENT_MODEL",
        "LLAMA_GPU_BACKEND",
        "LLAMA_VULKAN_ENABLED"
      );

      this._syncStartupEnv(setVars, clearVars);
    });

    ipcMain.handle("get-log-level", async () => {
      return debugLogger.getLevel();
    });

    ipcMain.handle("app-log", async (event, entry) => {
      debugLogger.logEntry(entry);
      return { success: true };
    });

    const SYSTEM_SETTINGS_URLS = {
      darwin: {
        microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        sound: "x-apple.systempreferences:com.apple.preference.sound?input",
        accessibility:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        systemAudio:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        screenRecording:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        calendars: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
        loginItems: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
      },
      win32: {
        microphone: "ms-settings:privacy-microphone",
        sound: "ms-settings:sound",
        loginItems: "ms-settings:startupapps",
      },
    };

    const openSystemSettings = async (settingType) => {
      const platform = process.platform;
      const urls = SYSTEM_SETTINGS_URLS[platform];
      const url = urls?.[settingType];

      if (!url) {
        // Platform doesn't support this settings URL
        const messages = {
          microphone: i18nMain.t("systemSettings.microphone"),
          sound: i18nMain.t("systemSettings.sound"),
          accessibility: i18nMain.t("systemSettings.accessibility"),
          systemAudio: i18nMain.t("systemSettings.systemAudio"),
          screenRecording: i18nMain.t("systemSettings.screenRecording"),
          loginItems: i18nMain.t("systemSettings.loginItems"),
        };
        return {
          success: false,
          error:
            messages[settingType] || `${settingType} settings are not available on this platform.`,
        };
      }

      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        debugLogger.error(`Failed to open ${settingType} settings:`, error);
        return { success: false, error: error.message };
      }
    };

    ipcMain.handle("open-microphone-settings", () => openSystemSettings("microphone"));
    ipcMain.handle("open-sound-input-settings", () => openSystemSettings("sound"));
    ipcMain.handle("get-system-default-microphone", (_event, options = {}) =>
      resolveSystemDefaultMicrophone({ refresh: options?.refresh === true })
    );
    ipcMain.handle("open-accessibility-settings", () => openSystemSettings("accessibility"));

    ipcMain.handle("capture-screen-context", async (event) => {
      // null matches capture's contract — a screenshot must never break the
      // dictation it accompanies. The target's window rect picks the display it
      // is on rather than the one under the cursor, and the panel reposition has
      // normally cached it already. A failed rect read falls back to the cursor.
      const targetPid = this.textEditMonitor?.lastTargetPid;
      const capturePromise = Promise.resolve(
        targetPid ? this.textEditMonitor.getTargetWindowBounds?.(targetPid) : null
      )
        .catch(() => null)
        .then((targetBounds) => screenContextCapture.captureActiveDisplay(targetBounds));
      return capturePromise;
    });

    // Snapshot the launch-time TCC status so a mid-session grant (which macOS
    // only honors after a relaunch) is detectable even if the renderer never
    // checked before the user granted.
    screenContextCapture.getAccessStatus();

    ipcMain.handle("check-screen-recording-access", () => screenContextCapture.getAccessResult());

    ipcMain.handle("request-screen-recording-access", async () => {
      const status = await screenContextCapture.requestAccess();
      if (process.platform === "darwin" && status !== "granted") {
        await openSystemSettings("screenRecording");
      }
      return screenContextCapture.getAccessResult();
    });

    // Preserve the renderer setting while app-wide content protection is
    // temporarily disabled for screen recording.
    ipcMain.handle("screen-context-set-enabled", (event, enabled) => {
      this.windowManager?.setScreenContextProtection(enabled);
      return { success: true };
    });

    // Panel open: window becomes focusable so follow-up keyboard input works.
    // Only the dictation renderer may flip main-window focusability.
    ipcMain.handle("set-assistant-panel-open", (event, open) => {
      const dictationWindow = this.windowManager?.mainWindow;
      if (
        !dictationWindow ||
        dictationWindow.isDestroyed() ||
        event.sender !== dictationWindow.webContents
      ) {
        return { success: false, error: "Not the dictation window" };
      }
      this.windowManager.setAssistantPanelOpen(open);
      return { success: true };
    });

    // Busy state is enforced in the main process so a hotkey cannot trigger
    // native capture side effects before the renderer has a chance to reject it.
    ipcMain.handle("set-assistant-panel-busy", (event, busy) => {
      const dictationWindow = this.windowManager?.mainWindow;
      if (
        !dictationWindow ||
        dictationWindow.isDestroyed() ||
        event.sender !== dictationWindow.webContents
      ) {
        return { success: false, error: "Not the dictation window" };
      }
      this.windowManager.setAssistantPanelBusy(busy);
      return { success: true };
    });

    const isAgentDictationPill = (event) => {
      const pillWindow = this.windowManager?.agentDictationPillWindow;
      return pillWindow && !pillWindow.isDestroyed() && event.sender === pillWindow.webContents;
    };

    // The pill disables its own controls when an assistant or translation
    // capture owns the lifecycle, but that state travels by IPC — a click can
    // race it. Re-check here so a stale pill can never toggle or cancel a
    // recording it does not own.
    const isAgentDictationPillInteractive = () =>
      this.windowManager.getAgentDictationPillState().interactive;

    ipcMain.handle("toggle-agent-panel-dictation", (event) => {
      if (!isAgentDictationPill(event) || !isAgentDictationPillInteractive()) {
        return { success: false };
      }
      this.windowManager.sendToggleDictation();
      return { success: true };
    });

    ipcMain.handle("cancel-agent-panel-dictation", (event) => {
      if (!isAgentDictationPill(event) || !isAgentDictationPillInteractive()) {
        return { success: false };
      }
      this.windowManager.sendCancelActiveDictation();
      return { success: true };
    });

    ipcMain.handle("get-agent-dictation-pill-state", (event) => {
      return isAgentDictationPill(event)
        ? this.windowManager.getAgentDictationPillState()
        : { lifecycle: "idle", interactive: false, horizontalDirection: "left" };
    });

    ipcMain.handle("resize-agent-dictation-pill-to-content", (event, surfaceHeight = null) => {
      if (!isAgentDictationPill(event)) return { success: false };
      return this.windowManager.resizeAgentDictationPillToContent(surfaceHeight);
    });

    ipcMain.handle("set-agent-dictation-pill-interactivity", (event, interactive) => {
      if (!isAgentDictationPill(event)) return { success: false };
      this.windowManager.setAgentDictationPillInteractivity(Boolean(interactive));
      return { success: true };
    });

    ipcMain.handle("pause-media-playback", () => {
      const mediaPlayer = require("./mediaPlayer");
      return mediaPlayer.pauseMedia();
    });

    ipcMain.handle("resume-media-playback", () => {
      const mediaPlayer = require("./mediaPlayer");
      return mediaPlayer.resumeMedia();
    });

    ipcMain.handle("mute-other-apps", () => {
      const appAudioMuter = require("./appAudioMuter");
      return appAudioMuter.mute();
    });

    ipcMain.handle("unmute-other-apps", () => {
      const appAudioMuter = require("./appAudioMuter");
      return appAudioMuter.unmute();
    });

    ipcMain.handle("request-microphone-access", async () => {
      if (process.platform !== "darwin") {
        return { granted: true, status: "granted" };
      }
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return { granted };
    });

    ipcMain.handle("check-microphone-access", () => {
      if (process.platform !== "darwin") {
        return { granted: true, status: "granted" };
      }
      const status = systemPreferences.getMediaAccessStatus("microphone");
      return { granted: status === "granted", status };
    });

    // Honors system proxy via Electron's net stack. useSessionCookies:false so
    // Electron doesn't auto-attach jar cookies on top of our explicit headers.
    const proxyFetch = (url, init = {}) => net.fetch(url, { ...init, useSessionCookies: false });

    ipcMain.handle("retry-transcription", async (event, id, settings) => {
      const buffer = this.audioStorageManager.getAudioBuffer(id);
      if (!buffer) return { success: false, error: "Audio file not found" };
      let providerErrorContext = null;
      try {
        const { resolveMistralModel } = await import("./transcriptionRoute.ts");
        // Retry re-sends the stored audio with the model selected now.
        const model = resolveMistralModel(settings?.cloudTranscriptionModel);
        providerErrorContext = {
          provider: "Mistral",
          selfHosted: false,
          model,
          surface: "transcription",
        };
        const apiKey = this.environmentManager.getMistralKey();
        if (!apiKey) {
          throw providerError(PROVIDER_ERROR_CODES.KEY_MISSING, {
            provider: "Mistral",
            surface: "transcription",
          });
        }
        const formData = new FormData();
        formData.append("file", new Blob([buffer], { type: "audio/webm" }), "audio.webm");
        formData.append("model", model);
        // English only, like dictation.
        formData.append("language", "en");
        const response = await proxyFetch(MISTRAL_TRANSCRIPTION_URL, {
          method: "POST",
          headers: { "x-api-key": apiKey },
          body: formData,
        });
        if (!response.ok) {
          const errorText = await response.text();
          debugLogger.warn("Retry transcription provider failed", {
            provider: "mistral",
            status: response.status,
            body: redactProviderBody(errorText),
          });
          throw providerHttpError({
            ...providerErrorContext,
            status: response.status,
            body: errorText,
            headers: response.headers,
          });
        }
        const data = await response.json();
        const result = { text: data?.text, source: "mistral", model };

        if (!result.text) {
          throw Object.assign(new Error("No speech detected in audio"), {
            code: "NO_SPEECH_DETECTED",
          });
        }

        this.databaseManager.updateTranscriptionText(id, result.text, result.text);
        this.databaseManager.updateTranscriptionStatus(id, "completed");
        const providerName = result.source || "local";
        const modelName = result.model || null;
        const existingRow = this.databaseManager.getTranscriptionById(id);
        this.databaseManager.updateTranscriptionAudio(id, {
          hasAudio: 1,
          audioDurationMs: existingRow?.audio_duration_ms ?? null,
          provider: providerName,
          model: modelName,
        });
        const updated = this.databaseManager.getTranscriptionById(id);
        if (updated) {
          setImmediate(() => {
            broadcastToWindows("transcription-updated", updated);
          });
        }
        return { success: true, transcription: updated };
      } catch (rawError) {
        const error = providerErrorContext
          ? asProviderError(rawError, providerErrorContext)
          : rawError;
        debugLogger.error(
          "Retry transcription failed",
          { id, error: error.message, code: error.code },
          "audio-storage"
        );
        if (error.code === "NO_SPEECH_DETECTED" && !error.messageKey) {
          // Every engine reports silence with this code, so it is translated
          // here once rather than per route.
          error.messageKey = "notes.upload.noSpeechDetected";
        }
        if (error.code) {
          return { success: false, ...ipcErrorFields(error) };
        }
        return { success: false, error: error.message };
      }
    });

    const fs = require("fs");

    let dictationPreviewSessionActive = false;
    // Cloud partials can arrive faster than the preview window is created. Keep
    // preview updates, completion, and dismissal ordered so a late partial can
    // never overwrite the final result or reopen a dismissed window.
    let dictationPreviewOperation = Promise.resolve();

    const queueDictationPreviewOperation = (operation) => {
      const result = dictationPreviewOperation.catch(() => {}).then(operation);
      dictationPreviewOperation = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    };

    const setupDictationCallbacks = (streaming, event) => {
      streaming.onPartialTranscript = (text) => {
        event.sender.send("dictation-realtime-partial", text);
      };
      streaming.onFinalTranscript = (text) => {
        event.sender.send("dictation-realtime-final", text);
      };
      streaming.onError = (err) => {
        event.sender.send("dictation-realtime-error", err.message);
      };
      streaming.onSessionEnd = (data) => {
        event.sender.send("dictation-realtime-session-end", data || {});
      };
    };

    // A session being replaced must go quiet: a late final or socket error from
    // it would land in the renderer as if it came from the live session.
    const retireDictationStreaming = (streaming) => {
      streaming.onPartialTranscript = null;
      streaming.onFinalTranscript = null;
      streaming.onError = null;
      streaming.onSessionEnd = null;
      streaming.disconnect({ commit: false }).catch(() => {});
    };

    const DICTATION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

    const clearDictationIdleTimer = () => {
      if (this._dictationIdleTimer) {
        clearTimeout(this._dictationIdleTimer);
        this._dictationIdleTimer = null;
      }
    };

    const startDictationIdleTimer = () => {
      clearDictationIdleTimer();
      this._dictationIdleTimer = setTimeout(() => {
        if (this._dictationStreaming) {
          debugLogger.debug("Closing idle dictation warmup connection");
          this._dictationStreaming.disconnect().catch(() => {});
          this._dictationStreaming = null;
        }
      }, DICTATION_IDLE_TIMEOUT_MS);
    };

    // What a dictation connection was opened for; a start or warmup reuses one
    // only when no key was saved since and the language and word list, which
    // Mistral fixes when the session starts, did not change.
    const dictationConnectionKey = (options) =>
      JSON.stringify([credentialGeneration, options.language, options.keyterms]);

    const connectDictationStreaming = async (event, options) => {
      if (this._dictationConnectPromise) {
        await this._dictationConnectPromise.catch(() => {});
      }

      clearDictationIdleTimer();

      // The renderer is already streaming frames when a start redials (it wires
      // the worklet before calling start), so the old session is retired without
      // a wait. Frames that reached the old session before the start are
      // dropped with it.
      if (this._dictationStreaming) {
        retireDictationStreaming(this._dictationStreaming);
        this._dictationStreaming = null;
      }

      const connectInner = async () => {
        const streaming = new MistralRealtimeStreaming();
        setupDictationCallbacks(streaming, event);
        // Assign before the connect (a real network round trip) so
        // dictation-realtime-send has a live instance to buffer into instead
        // of silently dropping the start of the recording.
        streaming.beginConnecting();
        streaming.connectionKey = dictationConnectionKey(options);
        this._dictationStreaming = streaming;
        try {
          const apiKey = this.environmentManager.getMistralKey();
          if (!apiKey) {
            const err = new Error("No Mistral API key configured. Add your key in Settings.");
            err.code = "NO_API";
            throw err;
          }
          await streaming.connect({
            apiKey,
            model: MISTRAL_REALTIME_MODEL,
            language: options.language,
            keyterms: options.keyterms,
          });
        } catch (err) {
          if (this._dictationStreaming === streaming) this._dictationStreaming = null;
          throw err;
        }
      };

      this._dictationConnectPromise = connectInner();
      try {
        await this._dictationConnectPromise;
      } finally {
        this._dictationConnectPromise = null;
      }
    };

    const streamingStartFailure = (err) => {
      const result = toPolicyFailure(err);
      if (err.messageKey) result.messageKey = err.messageKey;
      if (err.networkCode) result.networkCode = err.networkCode;
      return result;
    };

    // A Mistral socket carries one dictation, so only a fresh one is reused.
    // Warmups run one at a time so the second finds the first's fresh socket.
    const isUnusedMistralConnection = (streaming, options) =>
      streaming instanceof MistralRealtimeStreaming &&
      streaming.isConnected &&
      streaming.audioBytesSent === 0 &&
      streaming.connectionKey === dictationConnectionKey(options);

    const warmupDictationStreaming = async (event, options) => {
      await this._dictationConnectPromise?.catch(() => {});
      if (!isUnusedMistralConnection(this._dictationStreaming, options)) {
        await connectDictationStreaming(event, options);
        startDictationIdleTimer();
        return { success: true };
      }
      startDictationIdleTimer();
      return { success: true, alreadyWarm: true };
    };

    let dictationWarmupQueue = Promise.resolve();
    ipcMain.handle("dictation-realtime-warmup", (event, options = {}) => {
      const warmup = dictationWarmupQueue
        .then(() => warmupDictationStreaming(event, options))
        .catch(streamingStartFailure);
      dictationWarmupQueue = warmup;
      return warmup;
    });

    ipcMain.handle("dictation-realtime-start", async (event, options = {}) => {
      try {
        clearDictationIdleTimer();
        if (
          !this._dictationStreaming?.isConnected ||
          this._dictationStreaming.connectionKey !== dictationConnectionKey(options)
        ) {
          await connectDictationStreaming(event, options);
        }
        return { success: true };
      } catch (err) {
        return streamingStartFailure(err);
      }
    });

    ipcMain.on("dictation-realtime-send", (_event, buffer) => {
      this._dictationStreaming?.sendAudio(Buffer.from(buffer));
    });

    ipcMain.handle("dictation-realtime-finalize", async () => {
      if (!this._dictationStreaming) {
        return { success: false, error: "No Mistral recording is active" };
      }
      try {
        return { success: true, ...(await this._dictationStreaming.finalize()) };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("dictation-realtime-stop", async () => {
      clearDictationIdleTimer();
      if (!this._dictationStreaming) {
        return { success: true, text: "" };
      }
      const result = await this._dictationStreaming.disconnect().catch(() => ({ text: "" }));
      this._dictationStreaming = null;
      return { success: true, ...result, text: result.text || "" };
    });

    ipcMain.handle("dismiss-dictation-preview", () =>
      queueDictationPreviewOperation(async () => {
        dictationPreviewSessionActive = false;
        this.windowManager.hideTranscriptionPreview();
        return { success: true };
      })
    );

    ipcMain.handle("update-dictation-preview", (_event, text) =>
      queueDictationPreviewOperation(async () => {
        if (typeof text !== "string" || !text.trim()) {
          return { success: true };
        }
        dictationPreviewSessionActive = true;
        await this.windowManager.showTranscriptionPreview(text);
        return { success: true };
      })
    );

    ipcMain.handle("complete-dictation-preview", (_event, { text } = {}) =>
      queueDictationPreviewOperation(async () => {
        if (!dictationPreviewSessionActive) {
          return { success: true };
        }
        if (typeof text === "string" && text.trim()) {
          this.windowManager.completeTranscriptionPreview(text);
        } else {
          dictationPreviewSessionActive = false;
          this.windowManager.hideTranscriptionPreview();
        }
        return { success: true };
      })
    );

    ipcMain.handle("hide-dictation-preview", () =>
      queueDictationPreviewOperation(async () => {
        dictationPreviewSessionActive = false;
        this.windowManager.hideTranscriptionPreview();
        return { success: true };
      })
    );

    ipcMain.handle("stop-dictation-preview", async (_event, options = {}) => {
      if (dictationPreviewSessionActive) this.windowManager.holdTranscriptionPreview(options);
      return { success: true, streamed: false, text: "" };
    });

    ipcMain.handle("update-transcription-text", async (_event, id, text, rawText) => {
      try {
        this.databaseManager.updateTranscriptionText(id, text, rawText);
        const updated = this.databaseManager.getTranscriptionById(id);
        return { success: true, transcription: updated };
      } catch (error) {
        debugLogger.error(
          "Failed to update transcription text",
          { id, error: error.message },
          "audio-storage"
        );
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("transcribe-audio-file-byok", async (event, { filePath, model }) => {
      const fs = require("fs");
      let cleanupUpload = null;
      let providerErrorContext = null;
      try {
        if (typeof filePath !== "string") {
          return { success: false, error: "Invalid file path" };
        }
        const sourcePath = resolveAllowedAudioPath(filePath);
        if (!sourcePath) return { success: false, error: "File path not allowed" };

        const { resolveMistralModel, MISTRAL_FILE_SIZE_LIMIT } =
          await import("./transcriptionRoute.ts");
        const upload = await prepareProviderUpload(sourcePath);
        cleanupUpload = upload.cleanup;
        const realByok = upload.path;

        const mistralModel = resolveMistralModel(model);
        providerErrorContext = {
          provider: "Mistral",
          selfHosted: false,
          model: mistralModel,
          surface: "transcription",
        };
        if (fs.statSync(realByok).size > MISTRAL_FILE_SIZE_LIMIT) {
          return { success: false, error: byokSizeCapError(MISTRAL_FILE_SIZE_LIMIT) };
        }
        const apiKey = this.environmentManager.getMistralKey();
        if (!apiKey) {
          throw providerError(PROVIDER_ERROR_CODES.KEY_MISSING, {
            provider: "Mistral",
            surface: "transcription",
          });
        }

        // English only, like dictation: auto detection sometimes heard French.
        const { body, boundary } = buildMultipartBody(
          fs.readFileSync(realByok),
          path.basename(realByok),
          providerContentType(realByok),
          { model: mistralModel, language: "en" }
        );
        // Mistral authenticates with x-api-key, not Bearer.
        const data = await postMultipart(new URL(MISTRAL_TRANSCRIPTION_URL), body, boundary, {
          "x-api-key": apiKey,
        });
        if (data.statusCode !== 200) {
          debugLogger.warn("BYOK file transcription failed", {
            provider: "mistral",
            status: data.statusCode,
            body: redactProviderBody(data.data),
          });
          throw providerHttpError({
            ...providerErrorContext,
            status: data.statusCode,
            body: data.data,
          });
        }
        return { success: true, text: data.data.text };
      } catch (rawError) {
        const error = providerErrorContext
          ? asProviderError(rawError, providerErrorContext)
          : rawError;
        debugLogger.error("BYOK audio file transcription error", { error: error.message });
        return { success: false, ...ipcErrorFields(error) };
      } finally {
        cleanupUpload?.();
      }
    });

    ipcMain.handle("get-ydotool-status", () => {
      const { getYdotoolStatus } = require("./ensureYdotool");
      return getYdotoolStatus();
    });

    ipcMain.handle("open-logs-folder", async () => {
      try {
        const logsDir = path.join(app.getPath("userData"), "logs");
        await shell.openPath(logsDir);
        return { success: true };
      } catch (error) {
        debugLogger.error("Failed to open logs folder:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-error-log", () => debugLogger.readErrorLog());

    ipcMain.handle("clear-error-log", () => debugLogger.clearErrorLog());

    ipcMain.handle(
      "get-downloaded-update",
      () => this.updateManager?.getDownloadedVersion() ?? null
    );

    ipcMain.handle("install-update", () => this.updateManager?.installUpdate() ?? false);

    // Agent mode handlers
    ipcMain.handle("update-voice-agent-hotkey", async (_event, hotkey) => {
      const hotkeyManager = this.windowManager.hotkeyManager;
      const voiceAgentCallback = this.windowManager._voiceAgentHotkeyCallback;
      if (!voiceAgentCallback) {
        return { success: false };
      }

      if (!hotkey) {
        const removed = await hotkeyManager.unregisterSlot("voiceAgent");
        if (removed === false) return { success: false };
        this.environmentManager.saveVoiceAgentKey?.("");
        this.windowManager.reconcileNativeKeyListeners();
        this._notifyHotkeyChanged("");
        return { success: true, message: "Voice agent hotkey cleared" };
      }

      const result = await hotkeyManager.registerSlot("voiceAgent", hotkey, voiceAgentCallback, {
        atomic: true,
      });
      this.windowManager.reconcileNativeKeyListeners();
      if (result.success) {
        this.environmentManager.saveVoiceAgentKey?.(hotkey);
        this._notifyHotkeyChanged(hotkey);
        return { success: true, message: `Voice agent hotkey updated to: ${hotkey}` };
      }

      return { success: false, message: result.error };
    });

    ipcMain.handle("get-voice-agent-key", async () => {
      return this.environmentManager.getVoiceAgentKey?.() || "";
    });

    ipcMain.handle("get-pending-settings-section", async () => {
      return this.windowManager?.consumePendingSettingsSection() ?? null;
    });
  }

  deleteTranscriptionInternal(id) {
    this.audioStorageManager.deleteAudio(id);
    const result = this.databaseManager.deleteTranscription(id);
    if (result?.success) {
      setImmediate(() => {
        broadcastToWindows("transcription-deleted", { id });
      });
    }
    return result;
  }
}

module.exports = IPCHandlers;
