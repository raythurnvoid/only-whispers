import React, { Suspense, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/useToast";
import { useSettings } from "../hooks/useSettings";
import { useCollapsibleSidebar } from "../hooks/useCollapsibleSidebar";
import {
  useTranscriptions,
  useShowDiscarded,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
  updateTranscription as updateInStore,
  clearTranscriptions as clearStore,
  addTranscription as addToStore,
} from "../stores/transcriptionStore";
import { getSettings } from "../stores/settingsStore";
import ControlPanelSidebar from "./ControlPanelSidebar";
import ControlPanelTopBar from "./ControlPanelTopBar";
import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";
import { getCachedPlatform } from "../utils/platform";
import { isAccessibilitySkipped } from "../utils/permissions";
import { hasTextContent } from "../helpers/textContent";
import { applyChineseScript, resolveChineseScriptTarget } from "../utils/chineseScript";
import { getAgentName } from "../utils/agentName";
import HistoryView from "./HistoryView";
import { providerErrorToastProps } from "../utils/describeProviderError";

const platform = getCachedPlatform();

const SIDEBAR_WIDTH_PX = 192;

const SettingsModal = React.lazy(() => import("./SettingsModal"));
const DictionaryView = React.lazy(() => import("./DictionaryView"));
const LogsView = React.lazy(() => import("./LogsView"));

interface ControlPanelProps {
  /** Open the settings modal at this section on mount (e.g. after onboarding). */
  initialSettingsSection?: string;
}

export default function ControlPanel({ initialSettingsSection }: ControlPanelProps = {}) {
  const { t } = useTranslation();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(!!initialSettingsSection);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(
    initialSettingsSection
  );
  // Counts named show-settings requests, so asking again for the section the
  // modal was opened at still lands there after the user moved elsewhere in it.
  const [settingsRequest, setSettingsRequest] = useState(0);
  const [aiCTADismissed, setAiCTADismissed] = useState(
    () => localStorage.getItem("aiCTADismissed") === "true"
  );
  const [isUploading, setIsUploading] = useState(false);
  const showDiscarded = useShowDiscarded();
  const [activeView, setActiveView] = useState<ControlPanelView>("home");
  const navItems = useControlPanelNavItems();
  const {
    collapsed: sidebarCollapsed,
    peek: sidebarPeek,
    toggle: toggleSidebar,
    showPeek: showSidebarPeek,
    hidePeek: hideSidebarPeek,
    leaveToggle: leaveSidebarToggle,
  } = useCollapsibleSidebar();
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const { useCleanupModel } = useSettings();

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const loadTranscriptions = useCallback(
    async (includeDiscarded?: boolean) => {
      try {
        setIsLoading(true);
        await initializeTranscriptions(undefined, includeDiscarded);
      } catch {
        showAlertDialog({
          title: t("controlPanel.history.couldNotLoadTitle"),
          description: t("controlPanel.history.couldNotLoadDescription"),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [showAlertDialog, t]
  );

  useEffect(() => {
    loadTranscriptions();
  }, [loadTranscriptions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = platform === "darwin" ? e.metaKey : e.ctrlKey;
      if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    // A named section waits in main (it can outrace this listener on a cold
    // start); a bare request (app-menu Cmd+,) keeps an open modal where it is.
    const drain = async (showAnyway: boolean) => {
      const section = await window.electronAPI?.getPendingSettingsSection?.();
      if (section) {
        setSettingsSection(section);
        setSettingsRequest((count) => count + 1);
      }
      if (section || showAnyway) setShowSettings(true);
    };
    drain(false);
    const cleanup = window.electronAPI?.onShowSettings?.(() => drain(true));
    return () => cleanup?.();
  }, []);

  // When accessibility is missing on macOS, open the permissions settings page
  useEffect(() => {
    const cleanup = window.electronAPI?.onAccessibilityMissing?.(async () => {
      if (isAccessibilitySkipped()) return;
      setSettingsSection("privacyData");
      setShowSettings(true);
      toast({
        title: t("controlPanel.accessibilityMissing.title"),
        description: t("controlPanel.accessibilityMissing.description"),
        duration: 10000,
      });
    });
    return () => cleanup?.();
  }, [toast, t]);

  // A downloaded update installs on quit anyway; the toast lets the user restart now.
  useEffect(() => {
    const showUpdateReady = () =>
      toast({
        title: t("controlPanel.update.readyTitle"),
        description: t("controlPanel.update.readyDescription"),
        duration: 0,
        actions: [
          {
            label: t("controlPanel.update.installButton"),
            onClick: () => {
              window.electronAPI?.installUpdate?.();
            },
          },
        ],
      });
    window.electronAPI?.getDownloadedUpdate?.().then((version) => {
      if (version) showUpdateReady();
    });
    const cleanup = window.electronAPI?.onUpdateDownloaded?.(showUpdateReady);
    return () => cleanup?.();
  }, [toast, t]);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({
          title: t("controlPanel.history.copiedTitle"),
          description: t("controlPanel.history.copiedDescription"),
          variant: "success",
          duration: 2000,
        });
      } catch (err) {
        toast({
          title: t("controlPanel.history.couldNotCopyTitle"),
          description: t("controlPanel.history.couldNotCopyDescription"),
          variant: "destructive",
        });
      }
    },
    [toast, t]
  );

  const deleteTranscription = useCallback(
    async (id: number) => {
      showConfirmDialog({
        title: t("controlPanel.history.deleteTitle"),
        description: t("controlPanel.history.deleteDescription"),
        onConfirm: async () => {
          try {
            const result = await window.electronAPI.deleteTranscription(id);
            if (result.success) {
              removeFromStore(id);
            } else {
              showAlertDialog({
                title: t("controlPanel.history.couldNotDeleteTitle"),
                description: t("controlPanel.history.couldNotDeleteDescription"),
              });
            }
          } catch {
            showAlertDialog({
              title: t("controlPanel.history.couldNotDeleteTitle"),
              description: t("controlPanel.history.couldNotDeleteDescriptionGeneric"),
            });
          }
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, showAlertDialog, t]
  );

  const clearAllTranscriptions = useCallback(() => {
    showConfirmDialog({
      title: t("controlPanel.history.clearAllTitle"),
      description: t("controlPanel.history.clearAllDescriptionDevice"),
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          if (result.success) {
            clearStore();
            toast({
              title: t("controlPanel.history.clearAllSuccess"),
              variant: "success",
              duration: 2000,
            });
          } else {
            showAlertDialog({
              title: t("controlPanel.history.clearAllErrorTitle"),
              description: t("controlPanel.history.clearAllErrorDescription"),
            });
          }
        } catch {
          showAlertDialog({
            title: t("controlPanel.history.clearAllErrorTitle"),
            description: t("controlPanel.history.clearAllErrorDescription"),
          });
        }
      },
      variant: "destructive",
    });
  }, [showConfirmDialog, showAlertDialog, toast, t]);

  const showAudioInFolder = useCallback(
    async (id: number) => {
      try {
        const result = await window.electronAPI.showAudioInFolder(id);
        if (!result?.success) {
          toast({
            title: t("controlPanel.history.audioNotFound"),
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("controlPanel.history.audioNotFound"),
          variant: "destructive",
        });
      }
    },
    [toast, t]
  );

  const retryTranscription = useCallback(
    async (id: number, options?: { isRecover?: boolean }) => {
      try {
        const s = getSettings();
        const result = await window.electronAPI.retryTranscription(id, {
          cloudTranscriptionModel: s.cloudTranscriptionModel,
          preferredLanguage: s.preferredLanguage,
        });
        if (result.success && result.transcription) {
          const rawText = result.transcription.text;
          let finalTranscription = result.transcription;

          // Apply AI reasoning if enabled
          if (useCleanupModel) {
            try {
              const [
                { default: ReasoningService },
                { getEffectiveCleanupModel, isCloudCleanupMode, getSettings },
              ] = await Promise.all([
                import("../services/ReasoningService"),
                import("../stores/settingsStore"),
              ]);
              const model = getEffectiveCleanupModel();
              const isCloud = isCloudCleanupMode();
              if (model || isCloud) {
                const agentName = getAgentName();
                const reasonedText = await ReasoningService.processText(rawText, model, agentName, {
                  disableThinking: getSettings().cleanupDisableThinking,
                  reasoningEffort: getSettings().cleanupReasoningEffort,
                  requireCompleteOutput: true,
                });
                if (hasTextContent(reasonedText) && reasonedText !== rawText) {
                  const updated = await window.electronAPI.updateTranscriptionText(
                    id,
                    reasonedText,
                    rawText
                  );
                  if (updated.success && updated.transcription) {
                    finalTranscription = updated.transcription;
                  }
                }
              }
            } catch (cleanupError) {
              // The row keeps its raw transcript, so the retry must not look like it
              // cleaned anything — report why, the way dictation does (#2091).
              toast({
                title: t("app.toasts.cleanupFailed.title"),
                ...providerErrorToastProps(cleanupError, t),
                variant: "destructive",
              });
            }
          }

          // Deterministic Chinese script pass, mirroring dictation (#975). Runs last so
          // it covers the cleaned text, or the raw transcript when cleanup did not run.
          try {
            const scripted = await applyChineseScript(
              finalTranscription.text,
              resolveChineseScriptTarget(
                s.preferredLanguage,
                s.chineseScriptPreference,
                finalTranscription.text
              )
            );
            if (scripted !== finalTranscription.text) {
              const updated = await window.electronAPI.updateTranscriptionText(
                id,
                scripted,
                rawText
              );
              if (updated.success && updated.transcription) {
                finalTranscription = updated.transcription;
              }
            }
          } catch {
            // Conversion failed — keep the text as transcribed
          }

          updateInStore(finalTranscription);
          toast({
            title: t(
              options?.isRecover
                ? "controlPanel.history.discarded.recovered"
                : "controlPanel.history.retrySuccess"
            ),
            // A partial result still replaced the row; say so, as dictation does.
            ...(result.warning
              ? { description: t("hooks.audioRecording.partialTranscription.description") }
              : {}),
          });
        } else {
          toast({
            title: t("controlPanel.history.retryError"),
            ...providerErrorToastProps({ ...result, message: result.error }, t),
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("controlPanel.history.retryError"),
          variant: "destructive",
        });
      }
    },
    [toast, t, useCleanupModel]
  );

  // An uploaded file becomes a failed row with its audio, then runs the same
  // path as Retry: transcribe, clean up, and fill in the row.
  const uploadAudioFile = useCallback(async () => {
    setIsUploading(true);
    try {
      const imported = await window.electronAPI.importAudioFile();
      if (!imported?.success || !imported.transcription) {
        if (imported?.error) {
          toast({
            title: t("controlPanel.history.uploadError"),
            description: imported.error,
            variant: "destructive",
          });
        }
        return;
      }
      addToStore(imported.transcription);
      await retryTranscription(imported.transcription.id);
    } finally {
      setIsUploading(false);
    }
  }, [retryTranscription, toast, t]);

  const toggleShowDiscarded = useCallback(() => {
    loadTranscriptions(!showDiscarded);
  }, [loadTranscriptions, showDiscarded]);

  return (
    <div className="h-screen bg-surface-window flex flex-col">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            // SettingsModal reads initialSection only on open, so a named request remounts it.
            key={`${settingsSection ?? "default"}-${settingsRequest}`}
            open={showSettings}
            onOpenChange={(open) => {
              setShowSettings(open);
              if (!open) setSettingsSection(undefined);
            }}
            initialSection={settingsSection}
          />
        </Suspense>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        <div
          className="shrink-0 transition-[width] duration-300 ease-out"
          style={{ width: sidebarCollapsed ? 0 : SIDEBAR_WIDTH_PX }}
        />
        <div
          className={`absolute inset-y-0 start-0 z-30 transition-transform duration-300 ease-out ${
            !sidebarCollapsed || sidebarPeek
              ? "translate-x-0"
              : "ltr:-translate-x-full rtl:translate-x-full"
          }${
            sidebarCollapsed && sidebarPeek
              ? " shadow-[10px_0_40px_-18px_rgba(0,0,0,0.2)] rtl:shadow-[-10px_0_40px_-18px_rgba(0,0,0,0.2)]"
              : ""
          }`}
          onMouseEnter={sidebarCollapsed ? showSidebarPeek : undefined}
          onMouseLeave={sidebarCollapsed ? hideSidebarPeek : undefined}
        >
          <ControlPanelSidebar
            activeView={activeView}
            onViewChange={setActiveView}
            onOpenSettings={() => {
              setSettingsSection(undefined);
              setShowSettings(true);
            }}
          />
        </div>
        <main className="flex-1 flex flex-col overflow-hidden p-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-clip rounded-(--radius-shell) border border-border bg-background dark:border-white/10">
            <ControlPanelTopBar
              title={navItems.find((item) => item.id === activeView)?.label ?? ""}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
              onToggleMouseEnter={sidebarCollapsed ? showSidebarPeek : undefined}
              onToggleMouseLeave={sidebarCollapsed ? leaveSidebarToggle : undefined}
            />
            <div className="scrollbar-hidden flex-1 overflow-y-auto">
              {activeView === "home" && (
                <HistoryView
                  history={history}
                  isLoading={isLoading}
                  hotkey={hotkey}
                  aiCTADismissed={aiCTADismissed}
                  setAiCTADismissed={setAiCTADismissed}
                  useCleanupModel={useCleanupModel}
                  copyToClipboard={copyToClipboard}
                  deleteTranscription={deleteTranscription}
                  clearAllTranscriptions={clearAllTranscriptions}
                  onShowAudioInFolder={showAudioInFolder}
                  onRetryTranscription={retryTranscription}
                  onUploadAudio={uploadAudioFile}
                  isUploading={isUploading}
                  showDiscarded={showDiscarded}
                  onToggleDiscarded={toggleShowDiscarded}
                  onOpenSettings={(section) => {
                    setSettingsSection(section);
                    setShowSettings(true);
                  }}
                />
              )}
              {activeView === "dictionary" && (
                <Suspense fallback={null}>
                  <DictionaryView />
                </Suspense>
              )}
              {activeView === "logs" && (
                <Suspense fallback={null}>
                  <LogsView />
                </Suspense>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
