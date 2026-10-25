import React, { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { BIDI_VALUE_TOKEN, BidiInterpolatedText } from "./ui/BidiInterpolatedText";
import { Mic, Shield, Info, CircleCheck, CircleX, RotateCw, BookOpen, Copy } from "./icons";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import MicrophoneSettings from "./ui/MicrophoneSettings";
import PermissionCard from "./ui/PermissionCard";
import PasteToolsInfo from "./ui/PasteToolsInfo";
import NixOsPasteInfo from "./ui/NixOsPasteInfo";
import ChatGPTSignIn from "./ChatGPTSignIn";
import {
  ConfirmDialog,
  AlertDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";
import { useConnectionAutoCheck } from "../hooks/useConnectionAutoCheck";
import { HotkeyListInput } from "./ui/HotkeyListInput";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { useHotkeyModeInfo } from "../hooks/useHotkeyModeInfo";
import { validateHotkeyForSlot } from "../utils/hotkeyValidation";
import { getCachedPlatform } from "../utils/platform";
import { formatHotkeyLabel } from "../utils/hotkeys";
import {
  getLinuxPasteInstallCommands,
  needsLinuxPasteToolGuidance,
} from "../utils/linuxPasteTools";
import { ActivationModeSelector } from "./ui/ActivationModeSelector";
import LinuxPttSetupInfo from "./ui/LinuxPttSetupInfo";
import { Toggle } from "./ui/toggle";
import { useToast } from "./ui/useToast";
import logger from "../utils/logger";
import { SettingsRow, SettingsPanel, SettingsPanelRow } from "./ui/SettingsSection";
import { FieldLabel, ProviderCheckField } from "./ui/ProviderCheckField";
import { useSettingsStore } from "../stores/settingsStore";

export type SettingsSectionType = "general" | "hotkeys" | "speechToText" | "llms";

interface SettingsPageProps {
  activeSection?: SettingsSectionType;
  // Unused while the AI models section has no sub-tabs (the assistant is hidden).
  onNavigateToSection?: (section: SettingsSectionType, subTab?: string) => void;
  initialSubTab?: string;
}

function SectionHeader({
  title,
  description,
  note,
}: {
  title: string;
  description?: string;
  note?: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-semibold text-foreground tracking-tight">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>
      )}
      {note && <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{note}</p>}
    </div>
  );
}

// Mistral Voxtral is the only speech-to-text service, so its key is the whole section.
function MistralKeySection() {
  const { t } = useTranslation();
  const mistralApiKey = useSettingsStore((s) => s.mistralApiKey);
  const setMistralApiKey = useSettingsStore((s) => s.setMistralApiKey);
  const model = useSettingsStore((s) => s.cloudTranscriptionModel);
  const check = useConnectionAutoCheck({
    config: { scope: "transcription", provider: "mistral", apiKey: mistralApiKey, model },
    ready: Boolean(mistralApiKey.trim()),
  });

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.speechToText.title")}
        description={t("settingsPage.speechToText.description")}
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <label className="block">
            <FieldLabel>{t("appSetup.mistralKey")}</FieldLabel>
            <ProviderCheckField
              aria-label={t("appSetup.mistralKey")}
              check={check}
              invalidOn="credentialsRejected"
              type="password"
              value={mistralApiKey}
              onChange={(event) => setMistralApiKey(event.target.value.trim())}
              placeholder={t("onboarding.rehaul.provider.apiKeyPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
            <a
              href="https://admin.mistral.ai/organization/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-xs text-link hover:opacity-80"
            >
              {t("appSetup.getMistralKey")}
            </a>
          </label>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

// Cleanup always runs on gpt-6-luna through the user's ChatGPT plan.
function CleanupSection() {
  const { t } = useTranslation();
  const { useCleanupModel, updateCleanupSettings } = useSettings();

  return (
    <div className="space-y-4">
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.aiModels.enableTextCleanup")}
            description={t("settingsPage.aiModels.enableTextCleanupDescription")}
          >
            <Toggle
              checked={useCleanupModel}
              onChange={(value) => updateCleanupSettings({ useCleanupModel: value })}
            />
          </SettingsRow>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <ChatGPTSignIn />
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

// 0.1.0 ships cleanup only, so the assistant tabs are not shown.
function LlmsSection() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <SectionHeader title={t("settingsPage.llms.title")} />
      <CleanupSection />
    </div>
  );
}

export default function SettingsPage({ activeSection = "general" }: SettingsPageProps) {
  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const {
    dictationKey,
    activationMode,
    setActivationMode,
    microphoneSelectionMode,
    selectedMicDeviceId,
    selectedMicDeviceLabel,
    micWarmHoldSeconds,
    setMicrophoneSelectionMode,
    setSelectedMicDevice,
    setMicWarmHoldSeconds,
    setDictationKey,
    autoLearnCorrections,
    setAutoLearnCorrections,
    floatingIconAutoHide,
    setFloatingIconAutoHide,
    muteAppsOnDictation,
    setMuteAppsOnDictation,
  } = useSettings();

  const { t } = useTranslation();
  const { toast } = useToast();

  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog);

  // Wayland paste tool status for diagnostics.
  const [ydotoolStatus, setYdotoolStatus] = useState<{
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
    isKde: boolean;
    isWlroots: boolean;
    isCosmic: boolean;
    requiresWlCopy: boolean;
    isNixOS: boolean;
  } | null>(null);
  const [ydotoolGuideKey, setYdotoolGuideKey] = useState<string | null>(null);

  const refreshYdotoolStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI?.getYdotoolStatus?.();
      if (status) setYdotoolStatus(status);
    } catch {}
  }, []);

  useEffect(() => {
    refreshYdotoolStatus();
  }, [refreshYdotoolStatus]);

  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: true,
    showAlert: showAlertDialog,
  });

  // The voice assistant hotkey is hidden and never registered, so there is no
  // other slot to conflict with.
  const validateDictationHotkey = useCallback(
    (hotkey: string) => validateHotkeyForSlot(hotkey, {}, t),
    [t]
  );

  const {
    isUsingNativeShortcut,
    isUsingHyprland,
    hyprlandConfigStatus,
    pushToTalkUnavailableReason,
    linuxInputAccessDenied,
  } = useHotkeyModeInfo("settings", dictationKey);
  const [effectiveDefaultHotkey, setEffectiveDefaultHotkey] = useState<string | null>(null);
  const [linuxPttAvailable, setLinuxPttAvailable] = useState(true);

  const platform = getCachedPlatform();

  useEffect(() => {
    const loadEffectiveDefaultHotkey = async () => {
      try {
        const key = await window.electronAPI?.getEffectiveDefaultHotkey?.();
        if (key) setEffectiveDefaultHotkey(key);
      } catch (error) {
        logger.error("Failed to get effective default hotkey", error, "settings");
      }
    };
    loadEffectiveDefaultHotkey();
  }, []);

  useEffect(() => {
    const cleanup = window.electronAPI?.onLinuxPttPermissionDenied?.(() => {
      setLinuxPttAvailable(false);
      toast({
        title: t("settingsPage.general.hotkey.linuxPttPermissionTitle"),
        description: t("settingsPage.general.hotkey.linuxPttPermissionDescription"),
        variant: "destructive",
        duration: 15000,
      });
      setActivationMode("tap");
    });
    return () => cleanup?.();
  }, [toast, t, setActivationMode]);

  const resetAccessibilityPermissions = () => {
    const message = t("settingsPage.permissions.resetAccessibility.description");

    showConfirmDialog({
      title: t("settingsPage.permissions.resetAccessibility.title"),
      description: message,
      onConfirm: () => {
        permissionsHook.requestAccessibilityPermission();
      },
    });
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-6">
            {/* Microphone */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.microphone.title")}
                description={t("settingsPage.general.microphone.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <MicrophoneSettings
                    microphoneSelectionMode={microphoneSelectionMode}
                    selectedMicDeviceId={selectedMicDeviceId}
                    selectedMicDeviceLabel={selectedMicDeviceLabel}
                    micWarmHoldSeconds={micWarmHoldSeconds}
                    onSelectionModeChange={setMicrophoneSelectionMode}
                    onDeviceSelect={setSelectedMicDevice}
                    onMicWarmHoldSecondsChange={setMicWarmHoldSeconds}
                  />
                </SettingsPanelRow>
                {/* Muting uses Windows audio sessions, so other platforms skip it. */}
                {platform === "win32" && (
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.general.microphone.muteOtherApps")}
                      description={t("settingsPage.general.microphone.muteOtherAppsDescription")}
                    >
                      <Toggle checked={muteAppsOnDictation} onChange={setMuteAppsOnDictation} />
                    </SettingsRow>
                  </SettingsPanelRow>
                )}
              </SettingsPanel>
            </div>

            {/* Floating Icon */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.floatingIcon.title")}
                description={t("settingsPage.general.floatingIcon.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.floatingIcon.alwaysVisible")}
                    description={t("settingsPage.general.floatingIcon.alwaysVisibleDescription")}
                  >
                    <Toggle
                      checked={!floatingIconAutoHide}
                      onChange={(value) => setFloatingIconAutoHide(!value)}
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Dictionary */}
            <div>
              <SectionHeader
                title={t("settingsPage.dictionary.autoLearnTitle", {
                  defaultValue: "Auto-learn from corrections",
                })}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.dictionary.autoLearnTitle", {
                      defaultValue: "Auto-learn from corrections",
                    })}
                    description={t("settingsPage.dictionary.autoLearnDescription", {
                      defaultValue:
                        "When you correct a transcription in the target app, the corrected word is automatically added to your dictionary.",
                    })}
                  >
                    <Toggle checked={autoLearnCorrections} onChange={setAutoLearnCorrections} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Permissions */}
            <div>
              <SectionHeader
                title={t("settingsPage.permissions.title")}
                description={t("settingsPage.permissions.description")}
              />

              <div className="space-y-3">
                <PermissionCard
                  icon={Mic}
                  title={t("settingsPage.permissions.microphoneTitle")}
                  description={t("settingsPage.permissions.microphoneDescription")}
                  granted={permissionsHook.micPermissionGranted}
                  onRequest={permissionsHook.requestMicPermission}
                  buttonText={t("settingsPage.permissions.grantAccess")}
                />

                {platform === "darwin" && (
                  <PermissionCard
                    icon={Shield}
                    title={t("settingsPage.permissions.accessibilityTitle")}
                    description={t("settingsPage.permissions.accessibilityDescription")}
                    granted={permissionsHook.accessibilityPermissionGranted}
                    onRequest={permissionsHook.requestAccessibilityPermission}
                    buttonText={t("settingsPage.permissions.grantAccess")}
                  />
                )}
              </div>

              {!permissionsHook.micPermissionGranted && permissionsHook.micPermissionError && (
                <MicPermissionWarning
                  error={permissionsHook.micPermissionError}
                  onOpenSoundSettings={permissionsHook.openSoundInputSettings}
                  onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
                />
              )}

              {platform === "linux" &&
                permissionsHook.pasteToolsInfo &&
                needsLinuxPasteToolGuidance(permissionsHook.pasteToolsInfo) && (
                  <PasteToolsInfo
                    pasteToolsInfo={permissionsHook.pasteToolsInfo}
                    isChecking={permissionsHook.isCheckingPasteTools}
                    onCheck={permissionsHook.checkPasteToolsAvailability}
                  />
                )}

              {platform === "darwin" && (
                <div className="mt-5">
                  <p className="text-xs font-medium text-foreground mb-3">
                    {t("settingsPage.permissions.troubleshootingTitle")}
                  </p>
                  <SettingsPanel>
                    <SettingsPanelRow>
                      <SettingsRow
                        label={t("settingsPage.permissions.resetAccessibility.label")}
                        description={t(
                          "settingsPage.permissions.resetAccessibility.rowDescription"
                        )}
                      >
                        <Button
                          onClick={resetAccessibilityPermissions}
                          variant="ghost"
                          size="sm"
                          className="text-foreground/70 hover:text-foreground"
                        >
                          {t("settingsPage.permissions.troubleshoot")}
                        </Button>
                      </SettingsRow>
                    </SettingsPanelRow>
                  </SettingsPanel>
                </div>
              )}
            </div>

            {/* Wayland Paste Diagnostics — only on Linux + Wayland */}
            {ydotoolStatus?.isLinux && ydotoolStatus?.isWayland && (
              <div>
                <SectionHeader
                  title={t("settingsPage.general.waylandPaste.title", {
                    defaultValue: "Wayland Paste Setup",
                  })}
                  description={t("settingsPage.general.waylandPaste.description", {
                    defaultValue:
                      "Auto-paste on Wayland uses ydotool or wtype. wtype is preferred on wlroots compositors.",
                  })}
                />
                {(() => {
                  if (ydotoolStatus.isNixOS) {
                    return (
                      <NixOsPasteInfo status={ydotoolStatus} onRecheck={refreshYdotoolStatus} />
                    );
                  }
                  const checks = [
                    {
                      key: "hasWtype",
                      label: "wtype",
                      ok: ydotoolStatus.hasWtype,
                      required: ydotoolStatus.isWlroots || ydotoolStatus.isCosmic,
                      desc: t("settingsPage.general.waylandPaste.wtypeDesc"),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.wtype.step1Title"),
                          desc: t("settingsPage.general.waylandPaste.guide.wtype.step1Desc"),
                          cmds: getLinuxPasteInstallCommands(t, "wtype"),
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.wtype.step2Title"),
                          cmds: [{ cmd: "which wtype" }],
                        },
                      ],
                    },
                    {
                      key: "hasYdotool",
                      label: "ydotool",
                      ok: ydotoolStatus.hasYdotool,
                      required: !ydotoolStatus.isWlroots,
                      desc: t("settingsPage.general.waylandPaste.ydotoolDesc", {
                        defaultValue: "Input automation tool for Wayland",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.ydotool.step1Title", {
                            defaultValue: "Install ydotool",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.ydotool.step1Desc", {
                            defaultValue:
                              "Use your distribution's package manager to install ydotool.",
                          }),
                          cmds: getLinuxPasteInstallCommands(t, "ydotool"),
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.ydotool.step2Title", {
                            defaultValue: "Verify installation",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.ydotool.step2Desc", {
                            defaultValue: "Check that ydotool is available in your PATH.",
                          }),
                          cmds: [{ cmd: "which ydotool" }],
                        },
                      ],
                    },
                    {
                      key: "hasYdotoold",
                      label: "ydotoold",
                      ok: ydotoolStatus.hasYdotoold,
                      required: !ydotoolStatus.isWlroots,
                      desc: t("settingsPage.general.waylandPaste.ydotooldDesc", {
                        defaultValue: "Daemon for ydotool (separate package on Ubuntu/Pop!_OS)",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.ydotoold.step1Title", {
                            defaultValue: "Install ydotoold",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.ydotoold.step1Desc", {
                            defaultValue:
                              "On Ubuntu and Pop!_OS, ydotoold is a separate package. On Fedora, it's included with ydotool.",
                          }),
                          cmds: [
                            {
                              label: "Ubuntu / Pop!_OS / Debian",
                              cmd: "sudo apt install ydotoold",
                            },
                            { label: "Fedora", cmd: "# Already included in the ydotool package" },
                            { label: "Arch Linux", cmd: "# Included in the ydotool package" },
                          ],
                        },
                      ],
                    },
                    {
                      key: "hasUinput",
                      label: "/dev/uinput",
                      ok: ydotoolStatus.hasUinput,
                      required: !ydotoolStatus.isWlroots,
                      desc: t("settingsPage.general.waylandPaste.uinputDesc", {
                        defaultValue: "Kernel input device access",
                      }),
                      note: !ydotoolStatus.hasUinput
                        ? ydotoolStatus.hasUdevRule
                          ? t("settingsPage.general.waylandPaste.uinputRuleFound", {
                              defaultValue: "Rule present but not active. A reboot should fix it.",
                            })
                          : t("settingsPage.general.waylandPaste.uinputRuleMissing", {
                              defaultValue: "no udev rule found",
                            })
                        : undefined,
                      steps:
                        ydotoolStatus.hasUdevRule && !ydotoolStatus.hasUinput
                          ? [
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.ruleFoundTitle",
                                  {
                                    defaultValue: "udev rule already configured",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.ruleFoundDesc",
                                  {
                                    defaultValue:
                                      "The udev rule for /dev/uinput is already on your system but hasn't taken effect. Try reloading:",
                                  }
                                ),
                                cmds: [
                                  {
                                    cmd: "sudo udevadm control --reload-rules && sudo udevadm trigger /dev/uinput",
                                  },
                                ],
                              },
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.rebootTitle",
                                  {
                                    defaultValue: "If reloading didn't help, reboot",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.rebootDesc",
                                  {
                                    defaultValue:
                                      "On some distros, udev changes only apply after a full reboot. Restart your computer and come back to re-check.",
                                  }
                                ),
                              },
                            ]
                          : [
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step1Title",
                                  {
                                    defaultValue: "Create a udev rule",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step1Desc",
                                  {
                                    defaultValue:
                                      "This rule grants access to /dev/uinput for users in the input group.",
                                  }
                                ),
                                cmds: [
                                  {
                                    cmd: 'echo \'KERNEL=="uinput", GROUP="input", MODE="0660", TAG+="uaccess"\' | sudo tee /etc/udev/rules.d/70-uinput.rules',
                                  },
                                ],
                              },
                              {
                                title: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step2Title",
                                  {
                                    defaultValue: "Reload udev rules",
                                  }
                                ),
                                desc: t(
                                  "settingsPage.general.waylandPaste.guide.uinput.step2Desc",
                                  {
                                    defaultValue: "Apply the new rule without rebooting.",
                                  }
                                ),
                                cmds: [
                                  {
                                    cmd: "sudo udevadm control --reload-rules && sudo udevadm trigger /dev/uinput",
                                  },
                                ],
                              },
                            ],
                    },
                    {
                      key: "hasGroup",
                      label: t("settingsPage.general.waylandPaste.inputGroup", {
                        defaultValue: "input group",
                      }),
                      ok: ydotoolStatus.hasGroup,
                      required: !ydotoolStatus.isWlroots,
                      desc: t("settingsPage.general.waylandPaste.inputGroupDesc", {
                        defaultValue: "User must be in the input group (requires re-login)",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.group.step1Title", {
                            defaultValue: "Add your user to the input group",
                          }),
                          cmds: [{ cmd: "sudo usermod -aG input $USER" }],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.group.step2Title", {
                            defaultValue: "Log out and back in",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.group.step2Desc", {
                            defaultValue:
                              "Group changes only take effect after a new login session. Log out of your desktop and log back in, then reopen only-whispers.",
                          }),
                        },
                      ],
                    },
                    {
                      key: "hasService",
                      label: t("settingsPage.general.waylandPaste.service", {
                        defaultValue: "systemd service",
                      }),
                      ok: ydotoolStatus.hasService,
                      required: !ydotoolStatus.isWlroots,
                      desc: t("settingsPage.general.waylandPaste.serviceDesc", {
                        defaultValue: "User service file for auto-starting ydotoold",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.service.step1Title", {
                            defaultValue: "Create the service directory",
                          }),
                          cmds: [{ cmd: "mkdir -p ~/.config/systemd/user" }],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.service.step2Title", {
                            defaultValue: "Create the service file",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.service.step2Desc", {
                            defaultValue:
                              "This creates a user-level systemd service that starts ydotoold automatically when you log in.",
                          }),
                          cmds: [
                            {
                              cmd: `cat > ~/.config/systemd/user/ydotoold.service << 'EOF'
[Unit]
Description=ydotoold - ydotool daemon
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart=/usr/bin/ydotoold
Restart=on-failure
RestartSec=1s

[Install]
WantedBy=graphical-session.target
EOF`,
                            },
                          ],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.service.step3Title", {
                            defaultValue: "Reload and enable",
                          }),
                          cmds: [
                            {
                              cmd: "systemctl --user daemon-reload && systemctl --user enable ydotoold",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      key: "daemonRunning",
                      label: t("settingsPage.general.waylandPaste.daemon", {
                        defaultValue: "ydotoold daemon",
                      }),
                      ok: ydotoolStatus.daemonRunning,
                      required: !ydotoolStatus.isWlroots,
                      desc: t("settingsPage.general.waylandPaste.daemonDesc", {
                        defaultValue: "Background service must be running",
                      }),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.daemon.step1Title", {
                            defaultValue: "Start the daemon",
                          }),
                          desc: t("settingsPage.general.waylandPaste.guide.daemon.step1Desc", {
                            defaultValue: "Start ydotoold and enable it so it runs on every login.",
                          }),
                          cmds: [
                            {
                              cmd: "systemctl --user enable ydotoold && systemctl --user start ydotoold",
                            },
                            {
                              label: "Arch Linux (service is named ydotool.service)",
                              cmd: "systemctl --user enable --now ydotool.service",
                            },
                          ],
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.daemon.step2Title", {
                            defaultValue: "Verify it's running",
                          }),
                          cmds: [
                            { cmd: "systemctl --user status ydotoold" },
                            {
                              label: "Arch Linux",
                              cmd: "systemctl --user status ydotool.service",
                            },
                          ],
                        },
                      ],
                    },
                  ];

                  if (ydotoolStatus.requiresWlCopy || ydotoolStatus.isKde) {
                    checks.push({
                      key: "hasWlCopy",
                      label: "wl-copy",
                      ok: ydotoolStatus.hasWlCopy,
                      required: ydotoolStatus.requiresWlCopy || ydotoolStatus.isKde,
                      desc: t("settingsPage.general.waylandPaste.wlCopyDesc"),
                      steps: [
                        {
                          title: t("settingsPage.general.waylandPaste.guide.wlCopy.step1Title"),
                          cmds: getLinuxPasteInstallCommands(t, "wl-clipboard"),
                        },
                        {
                          title: t("settingsPage.general.waylandPaste.guide.wlCopy.step2Title"),
                          cmds: [{ cmd: "which wl-copy" }],
                        },
                      ],
                    });
                  }

                  const allOk = checks.filter((c) => c.required).every((c) => c.ok);
                  const activeGuide = checks.find((c) => c.key === ydotoolGuideKey);

                  return (
                    <>
                      {allOk ? (
                        <SettingsPanel>
                          <SettingsPanelRow>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <CircleCheck className="h-4 w-4 text-emerald-500" />
                                <span className="text-sm">
                                  {t("settingsPage.general.waylandPaste.allGoodDesc", {
                                    defaultValue: "Auto-paste is ready to go.",
                                  })}
                                </span>
                              </div>
                              <button
                                onClick={refreshYdotoolStatus}
                                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <RotateCw className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </SettingsPanelRow>
                        </SettingsPanel>
                      ) : (
                        <>
                          <div className="rounded-xl border border-border overflow-hidden">
                            <div className="divide-y divide-border">
                              {checks.map((item) => (
                                <div key={item.key} className="px-4 py-3">
                                  <div className="flex items-center gap-2.5">
                                    {item.ok ? (
                                      <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                      <CircleX className="h-4 w-4 shrink-0 text-red-500" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <span className="text-sm font-medium">{item.label}</span>
                                      <span className="text-xs text-muted-foreground ms-2">
                                        {item.desc}
                                      </span>
                                      {item.note && (
                                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                          {item.note}
                                        </p>
                                      )}
                                    </div>
                                    {!item.ok && (
                                      <button
                                        onClick={() => setYdotoolGuideKey(item.key)}
                                        className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors text-foreground"
                                      >
                                        <BookOpen className="w-3 h-3" />
                                        {t("settingsPage.general.waylandPaste.guide.open", {
                                          defaultValue: "Guide",
                                        })}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={refreshYdotoolStatus}
                            className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <RotateCw className="w-3 h-3" />
                            {t("settingsPage.general.waylandPaste.recheck", {
                              defaultValue: "Re-check",
                            })}
                          </button>
                        </>
                      )}

                      {/* Step-by-step guide dialog */}
                      <Dialog
                        open={!!activeGuide}
                        onOpenChange={(open) => !open && setYdotoolGuideKey(null)}
                      >
                        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                          {activeGuide && (
                            <>
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                  <BookOpen className="w-4 h-4" />
                                  {activeGuide.label}
                                </DialogTitle>
                                <DialogDescription>{activeGuide.desc}</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-5 mt-2">
                                {activeGuide.steps.map((step, i) => (
                                  <div key={i}>
                                    <div className="flex items-start gap-3">
                                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                                        {i + 1}
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium">{step.title}</p>
                                        {step.desc && (
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {step.desc}
                                          </p>
                                        )}
                                        {step.cmds && step.cmds.length > 0 && (
                                          <div className="mt-2 space-y-2">
                                            {step.cmds.map((c, j) => (
                                              <div key={j}>
                                                {c.label && (
                                                  <p className="text-[11px] text-muted-foreground mb-1">
                                                    {c.label}
                                                  </p>
                                                )}
                                                <div className="flex items-start gap-1.5">
                                                  <pre
                                                    dir="ltr"
                                                    className="flex-1 text-[11px] bg-muted/60 rounded-md px-3 py-2 font-mono whitespace-pre-wrap break-all select-all overflow-x-auto"
                                                  >
                                                    {c.cmd}
                                                  </pre>
                                                  <button
                                                    onClick={() =>
                                                      navigator.clipboard.writeText(c.cmd)
                                                    }
                                                    className="shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                                    title={t(
                                                      "settingsPage.general.waylandPaste.copy",
                                                      { defaultValue: "Copy" }
                                                    )}
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </DialogContent>
                      </Dialog>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        );

      case "hotkeys":
        return (
          <div className="space-y-6">
            {isUsingHyprland && hyprlandConfigStatus && !hyprlandConfigStatus.canWrite && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>
                  {t("settingsPage.general.hotkey.hyprlandConfigWriteWarningTitle")}
                </AlertTitle>
                <AlertDescription>
                  <BidiInterpolatedText
                    text={t("settingsPage.general.hotkey.hyprlandConfigWriteWarningDescription", {
                      path: BIDI_VALUE_TOKEN,
                    })}
                    value={hyprlandConfigStatus.path}
                  />
                </AlertDescription>
              </Alert>
            )}
            {/* Dictation Hotkey */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.hotkey.title")}
                description={t("settingsPage.general.hotkey.description")}
                note={isUsingHyprland && t("settingsPage.general.hotkey.hyprlandUnbindDescription")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyListInput
                    value={dictationKey}
                    onChange={(list) => registerHotkey(list)}
                    validate={validateDictationHotkey}
                    disabled={isHotkeyRegistering}
                    maxHotkeys={isUsingNativeShortcut ? 1 : undefined}
                    required
                    footerEnd={
                      effectiveDefaultHotkey &&
                      dictationKey &&
                      dictationKey !== effectiveDefaultHotkey ? (
                        <button
                          onClick={() => registerHotkey(effectiveDefaultHotkey)}
                          disabled={isHotkeyRegistering}
                          className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          <BidiInterpolatedText
                            text={t("settingsPage.general.hotkey.resetToDefault", {
                              hotkey: BIDI_VALUE_TOKEN,
                            })}
                            value={formatHotkeyLabel(effectiveDefaultHotkey)}
                          />
                        </button>
                      ) : null
                    }
                  />
                </SettingsPanelRow>

                {(!isUsingNativeShortcut || getCachedPlatform() === "linux") && (
                  <SettingsPanelRow>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground/80">
                        {t("settingsPage.general.hotkey.activationMode")}
                      </span>
                      <ActivationModeSelector
                        value={activationMode}
                        onChange={setActivationMode}
                        pushDisabledReason={pushToTalkUnavailableReason ?? undefined}
                      />
                    </div>
                    {/* Denied input access gets the setup box below instead. */}
                    {pushToTalkUnavailableReason && !linuxInputAccessDenied && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {pushToTalkUnavailableReason}
                      </p>
                    )}
                    {getCachedPlatform() === "linux" &&
                      (activationMode === "push" || linuxInputAccessDenied) && (
                        <LinuxPttSetupInfo
                          isAvailable={!linuxInputAccessDenied && linuxPttAvailable}
                        />
                      )}
                  </SettingsPanelRow>
                )}
              </SettingsPanel>
            </div>
          </div>
        );

      case "speechToText":
        return <MistralKeySection />;

      case "llms":
        return <LlmsSection />;

      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {renderSectionContent()}
    </>
  );
}
