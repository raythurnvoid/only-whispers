import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PasteToolsResult } from "../types/electron";
import { useLocalStorage } from "./useLocalStorage";
import logger from "../utils/logger";

// The microphone is not here: useMicrophoneCheck and the microphone screen own it.
export interface UsePermissionsReturn {
  // State
  accessibilityPermissionGranted: boolean;
  pasteToolsInfo: PasteToolsResult | null;
  isCheckingPasteTools: boolean;
  accessibilityTroubleshooting: boolean;

  requestAccessibilityPermission: () => Promise<void>;
  checkPasteToolsAvailability: () => Promise<PasteToolsResult | null>;
  setAccessibilityPermissionGranted: (granted: boolean) => void;
}

export interface UsePermissionsProps {
  showAlertDialog: (dialog: { title: string; description?: string }) => void;
}

interface UsePermissionsOptions {
  macAccessibilityChecksEnabled?: boolean;
}

const getPlatform = (): "darwin" | "win32" | "linux" => {
  if (typeof window !== "undefined" && window.electronAPI?.getPlatform) {
    const platform = window.electronAPI.getPlatform();
    if (platform === "darwin" || platform === "win32" || platform === "linux") {
      return platform;
    }
  }
  // Fallback to user agent detection
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "darwin";
    if (ua.includes("win")) return "win32";
    if (ua.includes("linux")) return "linux";
  }
  return "darwin"; // Default fallback
};

export const usePermissions = (
  showAlertDialog?: UsePermissionsProps["showAlertDialog"],
  { macAccessibilityChecksEnabled = true }: UsePermissionsOptions = {}
): UsePermissionsReturn => {
  const { t } = useTranslation();
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useLocalStorage(
    "accessibilityPermissionGranted",
    false
  );
  const [pasteToolsInfo, setPasteToolsInfo] = useState<PasteToolsResult | null>(null);
  const [isCheckingPasteTools, setIsCheckingPasteTools] = useState(false);
  const [accessibilityTroubleshooting, setAccessibilityTroubleshooting] = useState(false);
  const accessibilityPollCount = useRef(0);

  const openSystemSettings = useCallback(
    async (
      settingType: "microphone" | "sound" | "accessibility",
      apiMethod: () => Promise<{ success: boolean; error?: string } | undefined> | undefined
    ) => {
      const titles = {
        microphone: t("hooks.permissions.settingsTitles.microphone"),
        sound: t("hooks.permissions.settingsTitles.sound"),
        accessibility: t("hooks.permissions.settingsTitles.accessibility"),
      };
      const unableToOpenDescriptions = {
        microphone: t("hooks.permissions.settingsErrors.unableToOpenMicrophone"),
        sound: t("hooks.permissions.settingsErrors.unableToOpenSound"),
        accessibility: t("hooks.permissions.settingsErrors.unableToOpenAccessibility"),
      };
      try {
        const result = await apiMethod?.();
        if (result && !result.success && result.error) {
          showAlertDialog?.({ title: titles[settingType], description: result.error });
        }
      } catch (error) {
        logger.error(`Failed to open ${settingType} settings:`, error);
        showAlertDialog?.({
          title: titles[settingType],
          description: unableToOpenDescriptions[settingType],
        });
      }
    },
    [showAlertDialog, t]
  );

  const checkPasteToolsAvailability = useCallback(async (): Promise<PasteToolsResult | null> => {
    setIsCheckingPasteTools(true);
    try {
      if (window.electronAPI?.checkPasteTools) {
        const result = await window.electronAPI.checkPasteTools();
        setPasteToolsInfo(result);

        // On Windows and Linux with tools available, auto-grant accessibility
        if (result.platform === "win32") {
          setAccessibilityPermissionGranted(true);
        } else if (result.platform === "linux" && result.available) {
          setAccessibilityPermissionGranted(true);
        }
        return result;
      }
      return null;
    } catch (error) {
      logger.error("Failed to check paste tools:", error);
      return null;
    } finally {
      setIsCheckingPasteTools(false);
    }
  }, [setAccessibilityPermissionGranted]);

  const requestAccessibilityPermission = useCallback(async () => {
    const platform = getPlatform();

    if (platform === "darwin") {
      // Check if already granted
      const alreadyGranted = await window.electronAPI?.checkAccessibilityPermission?.(true);
      if (alreadyGranted) {
        setAccessibilityPermissionGranted(true);
        return;
      }

      // Open System Settings directly — avoids the undismissable macOS TCC dialog
      // that isTrustedAccessibilityClient(true) would show.
      await openSystemSettings("accessibility", window.electronAPI?.openAccessibilitySettings);
      return;
    }

    // On Windows, PowerShell SendKeys is always available
    if (platform === "win32") {
      setAccessibilityPermissionGranted(true);
      return;
    }

    // On Linux, auto-paste is optional — grant regardless of paste tool availability
    if (platform === "linux") {
      await checkPasteToolsAvailability();
      setAccessibilityPermissionGranted(true);
    }
  }, [openSystemSettings, checkPasteToolsAvailability, setAccessibilityPermissionGranted]);

  // Check paste tools on mount
  useEffect(() => {
    checkPasteToolsAvailability();
  }, [checkPasteToolsAvailability]);

  // On macOS, re-validate accessibility permission once this screen is allowed
  // to touch protected features, overriding stale localStorage values.
  useEffect(() => {
    if (getPlatform() !== "darwin" || !macAccessibilityChecksEnabled) return;
    window.electronAPI?.checkAccessibilityPermission?.(true).then((granted) => {
      setAccessibilityPermissionGranted(granted);
    });
  }, [macAccessibilityChecksEnabled, setAccessibilityPermissionGranted]);

  // Poll for accessibility permission changes on macOS (e.g. user grants in System Settings)
  useEffect(() => {
    if (getPlatform() !== "darwin" || !macAccessibilityChecksEnabled) return;
    if (accessibilityPermissionGranted) {
      setAccessibilityTroubleshooting(false);
      accessibilityPollCount.current = 0;
      return;
    }

    const interval = setInterval(() => {
      window.electronAPI?.checkAccessibilityPermission?.(true).then((granted) => {
        if (granted) {
          setAccessibilityPermissionGranted(true);
          setAccessibilityTroubleshooting(false);
          accessibilityPollCount.current = 0;
        } else {
          accessibilityPollCount.current += 1;
          // After ~10s of failed polls, show troubleshooting tips
          if (accessibilityPollCount.current >= 5) {
            setAccessibilityTroubleshooting(true);
          }
        }
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [
    accessibilityPermissionGranted,
    macAccessibilityChecksEnabled,
    setAccessibilityPermissionGranted,
  ]);

  return {
    accessibilityPermissionGranted,
    pasteToolsInfo,
    isCheckingPasteTools,
    accessibilityTroubleshooting,
    requestAccessibilityPermission,
    checkPasteToolsAvailability,
    setAccessibilityPermissionGranted,
  };
};
