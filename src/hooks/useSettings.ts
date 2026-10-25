import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useSettingsStore,
  initializeSettings,
  selectLocalServerPrefs,
} from "../stores/settingsStore";
import logger from "../utils/logger";
import { useLocalStorage } from "./useLocalStorage";
import type { ChineseScriptPreference, InferenceMode } from "../types/electron";
import type { Snippet } from "../utils/snippets";

export interface TranscriptionSettings {
  uiLanguage: string;
  preferredLanguage: string;
  /** When transcription language is Auto, force Chinese output script. See #975. */
  chineseScriptPreference: ChineseScriptPreference;
  /** Mistral Voxtral model; anything else reads as the default. */
  cloudTranscriptionModel: string;
  customDictionary: string[];
  snippets: Snippet[];
  showTranscriptionPreview: boolean;
}

export interface CleanupSettings {
  useCleanupModel: boolean;
  useDictationAgent: boolean;
  cleanupModel: string;
  cleanupProvider: string;
  cleanupCloudBaseUrl?: string;
  cleanupCloudMode: string;
  cleanupMode: InferenceMode;
  cleanupRemoteUrl: string;
}

export interface HotkeySettings {
  dictationKey: string;
  /** Hotkeys actually registered by the main process (may be a subset of
   * dictationKey, e.g. primary-only on GNOME/KDE/Hyprland). Display-only. */
  activeDictationKey: string | null;
  voiceAgentKey: string;
  activationMode: "tap" | "push";
}

export interface OnboardingSettings {
  onboardingUseCases: string[];
  onboardingUseCaseNote: string;
  spokenLanguages: string[];
}

export interface MicrophoneSettings {
  microphoneSelectionMode: "system" | "built-in" | "specific";
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
  selectedMicDeviceLabel: string;
  micWarmHoldSeconds: number;
}

export interface ApiKeySettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  openrouterApiKey: string;
  cortiApiKey: string;
  tinfoilApiKey: string;
  cleanupCustomApiKey: string;
}

export interface PrivacySettings {
  cloudBackupEnabled: boolean;
  insightsSyncEnabled: boolean;
  telemetryEnabled: boolean;
  audioRetentionDays: number;
  transcriptRetentionDays: number;
  dataRetentionEnabled: boolean;
  saveDiscardedTranscriptions: boolean;
}

export interface ThemeSettings {
  theme: "light" | "dark" | "auto";
}

export interface ChatAgentSettings {
  chatAgentModel: string;
  chatAgentProvider: string;
  chatAgentCloudMode: string;
  chatAgentMode: InferenceMode;
  chatAgentCloudBaseUrl: string;
  chatAgentRemoteUrl: string;
  chatAgentCustomApiKey: string;
}

function useSettingsInternal() {
  const store = useSettingsStore();
  const { applyCustomDictionaryFromExternal, applySnippetsFromExternal } = store;

  // One-time initialization: sync API keys, dictation key, activation mode,
  // UI language, and dictionary from the main process / SQLite.
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    initializeSettings().catch((err) => {
      logger.warn(
        "Failed to initialize settings store",
        { error: (err as Error).message },
        "settings"
      );
    });
  }, []);

  // Refresh the in-memory store from main-process broadcasts (auto-learn, sync
  // pulls) without re-triggering a sync — that would loop, since pulls emit the
  // broadcast. Writes that must sync go through setCustomDictionary instead.
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onDictionaryUpdated) return;
    const unsubscribe = window.electronAPI.onDictionaryUpdated((words: string[]) => {
      if (Array.isArray(words)) {
        applyCustomDictionaryFromExternal(words);
      }
    });
    return unsubscribe;
  }, [applyCustomDictionaryFromExternal]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onSnippetsUpdated) return;
    const unsubscribe = window.electronAPI.onSnippetsUpdated((snippets: Snippet[]) => {
      if (Array.isArray(snippets)) {
        applySnippetsFromExternal(snippets);
      }
    });
    return unsubscribe;
  }, [applySnippetsFromExternal]);

  // Auto-learn corrections from user edits in external apps
  const [autoLearnCorrections, setAutoLearnCorrectionsRaw] = useLocalStorage(
    "autoLearnCorrections",
    true,
    {
      serialize: String,
      deserialize: (value: string) => value !== "false",
    }
  );

  const setAutoLearnCorrections = useCallback(
    (enabled: boolean) => {
      setAutoLearnCorrectionsRaw(enabled);
      window.electronAPI?.setAutoLearnEnabled?.(enabled);
    },
    [setAutoLearnCorrectionsRaw]
  );

  // Sync auto-learn state to main process on mount
  useEffect(() => {
    window.electronAPI?.setAutoLearnEnabled?.(autoLearnCorrections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retention periods are enforced by the main process cleanup sweep
  const { audioRetentionDays, transcriptRetentionDays, dataRetentionEnabled } = store;
  useEffect(() => {
    window.electronAPI?.syncRetentionSettings?.({
      audioRetentionDays,
      transcriptRetentionDays,
      dataRetentionEnabled,
    });
  }, [audioRetentionDays, transcriptRetentionDays, dataRetentionEnabled]);

  // Sync startup pre-warming preferences to main process
  const { keepLocalModelLoaded } = store;
  // Every window runs this sync, and the main process stops the shared
  // llama-server from it, so it must see every scope's resolved local model.
  const localServerPrefs = useSettingsStore(useShallow(selectLocalServerPrefs));

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.syncStartupPreferences) return;

    window.electronAPI
      .syncStartupPreferences({
        ...localServerPrefs,
        keepLocalModelLoaded,
      })
      .catch((err) =>
        logger.warn(
          "Failed to sync startup preferences",
          { error: (err as Error).message },
          "settings"
        )
      );
  }, [localServerPrefs, keepLocalModelLoaded]);

  return {
    uiLanguage: store.uiLanguage,
    preferredLanguage: store.preferredLanguage,
    chineseScriptPreference: store.chineseScriptPreference,
    cloudTranscriptionModel: store.cloudTranscriptionModel,
    cleanupCloudBaseUrl: store.cleanupCloudBaseUrl,
    cleanupCloudMode: store.cleanupCloudMode,
    cleanupMode: store.cleanupMode,
    cleanupRemoteUrl: store.cleanupRemoteUrl,
    customDictionary: store.customDictionary,
    snippets: store.snippets,
    setSnippets: store.setSnippets,
    useCleanupModel: store.useCleanupModel,
    useDictationAgent: store.useDictationAgent,
    cleanupModel: store.cleanupModel,
    cleanupProvider: store.cleanupProvider,
    openaiApiKey: store.openaiApiKey,
    anthropicApiKey: store.anthropicApiKey,
    geminiApiKey: store.geminiApiKey,
    groqApiKey: store.groqApiKey,
    xaiApiKey: store.xaiApiKey,
    mistralApiKey: store.mistralApiKey,
    openrouterApiKey: store.openrouterApiKey,
    tinfoilApiKey: store.tinfoilApiKey,
    dictationKey: store.dictationKey,
    voiceAgentKey: store.voiceAgentKey,
    theme: store.theme,
    setUiLanguage: store.setUiLanguage,
    setPreferredLanguage: store.setPreferredLanguage,
    setChineseScriptPreference: store.setChineseScriptPreference,
    setCloudTranscriptionModel: store.setCloudTranscriptionModel,
    setCleanupCloudBaseUrl: store.setCleanupCloudBaseUrl,
    setCleanupCloudMode: store.setCleanupCloudMode,
    setCleanupMode: store.setCleanupMode,
    setCleanupRemoteUrl: store.setCleanupRemoteUrl,
    setCustomDictionary: store.setCustomDictionary,
    updateCustomDictionary: store.updateCustomDictionary,
    setUseCleanupModel: store.setUseCleanupModel,
    setUseDictationAgent: store.setUseDictationAgent,
    setCleanupModel: store.setCleanupModel,
    setCleanupProvider: store.setCleanupProvider,
    setOpenaiApiKey: store.setOpenaiApiKey,
    setAnthropicApiKey: store.setAnthropicApiKey,
    setGeminiApiKey: store.setGeminiApiKey,
    setGroqApiKey: store.setGroqApiKey,
    setMistralApiKey: store.setMistralApiKey,
    cleanupCustomApiKey: store.cleanupCustomApiKey,
    setCleanupCustomApiKey: store.setCleanupCustomApiKey,
    setDictationKey: store.setDictationKey,
    setVoiceAgentKey: store.setVoiceAgentKey,
    onboardingUseCases: store.onboardingUseCases,
    onboardingUseCaseNote: store.onboardingUseCaseNote,
    spokenLanguages: store.spokenLanguages,
    setTheme: store.setTheme,
    activationMode: store.activationMode,
    setActivationMode: store.setActivationMode,
    audioCuesEnabled: store.audioCuesEnabled,
    pauseMediaOnDictation: store.pauseMediaOnDictation,
    muteAppsOnDictation: store.muteAppsOnDictation,
    setMuteAppsOnDictation: store.setMuteAppsOnDictation,
    floatingIconAutoHide: store.floatingIconAutoHide,
    setFloatingIconAutoHide: store.setFloatingIconAutoHide,
    startMinimized: store.startMinimized,
    panelStartPosition: store.panelStartPosition,
    setPanelStartPosition: store.setPanelStartPosition,
    microphoneSelectionMode: store.microphoneSelectionMode,
    preferBuiltInMic: store.preferBuiltInMic,
    selectedMicDeviceId: store.selectedMicDeviceId,
    selectedMicDeviceLabel: store.selectedMicDeviceLabel,
    micWarmHoldSeconds: store.micWarmHoldSeconds,
    setMicrophoneSelectionMode: store.setMicrophoneSelectionMode,
    setSelectedMicDevice: store.setSelectedMicDevice,
    setMicWarmHoldSeconds: store.setMicWarmHoldSeconds,
    autoLearnCorrections,
    setAutoLearnCorrections,
    showTranscriptionPreview: store.showTranscriptionPreview,
    setShowTranscriptionPreview: store.setShowTranscriptionPreview,
    autoPasteEnabled: store.autoPasteEnabled,
    keepTranscriptionInClipboard: store.keepTranscriptionInClipboard,
    cloudBackupEnabled: store.cloudBackupEnabled,
    insightsSyncEnabled: store.insightsSyncEnabled,
    telemetryEnabled: store.telemetryEnabled,
    audioRetentionDays: store.audioRetentionDays,
    transcriptRetentionDays: store.transcriptRetentionDays,
    dataRetentionEnabled: store.dataRetentionEnabled,
    saveDiscardedTranscriptions: store.saveDiscardedTranscriptions,
    updateCleanupSettings: store.updateCleanupSettings,
  };
}

export type SettingsValue = ReturnType<typeof useSettingsInternal>;

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const value = useSettingsInternal();
  return React.createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
