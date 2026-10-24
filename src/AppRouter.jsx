import React, { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import App from "./App.jsx";
import AgentDictationPillOverlay from "./components/dictation/AgentDictationPillOverlay.tsx";
import { PermissionGuideOverlay } from "./components/onboarding/PermissionGuideOverlay";
import { LEGACY_ONBOARDING_STEP_KEY, ONBOARDING_SESSION_KEY } from "./components/onboarding/flow";
import { useControlPanelWindowDrag } from "./hooks/useControlPanelWindowDrag";
import { useTheme } from "./hooks/useTheme";
import { resolveSettledControlPanelWindowMode } from "./utils/controlPanelWindowMode.ts";
import { isControlPanelWindow } from "./utils/windowContext.ts";

// Either marker means the flow is mid-way: the legacy step key is kept for
// back-compat, the v2 session is what the rebuilt flow actually persists.
const isOnboardingInProgress = () =>
  localStorage.getItem(LEGACY_ONBOARDING_STEP_KEY) !== null ||
  localStorage.getItem(ONBOARDING_SESSION_KEY) !== null;

const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
// Replaces upstream onboarding: only a Mistral key and Sign in with ChatGPT.
const RT0Setup = React.lazy(() => import("./components/RT0Setup.tsx"));

export default function AppRouter() {
  useTheme();
  const params = window.location.search;

  if (params.includes("permission-guide=true")) return <PermissionGuideOverlay />;

  if (params.includes("agent-dictation-pill=true")) {
    return <AgentDictationPillOverlay />;
  }

  return <MainApp />;
}

function MainApp() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [postOnboardingSettingsSection, setPostOnboardingSettingsSection] = useState(undefined);

  const isControlPanel = isControlPanelWindow();
  const isDictationPanel = !isControlPanel;
  // Covers every surface this window hosts: onboarding, reauth, the panel.
  useControlPanelWindowDrag(isControlPanel);

  useEffect(() => {
    if (isControlPanel) {
      import("./components/ControlPanel.tsx").catch(() => {});

      if (!localStorage.getItem("onboardingCompleted")) {
        import("./components/RT0Setup.tsx").catch(() => {});
      }
    }
  }, [isControlPanel]);

  useEffect(() => {
    const resolved = localStorage.getItem("onboardingCompleted") === "true";

    if (isControlPanel && !resolved) {
      setShowOnboarding(true);
    }

    if (isDictationPanel && !resolved) {
      // Keep the dictation overlay hidden during onboarding — OnboardingFlow
      // shows it explicitly when the user reaches the activation step.
      window.electronAPI?.hideWindow?.();
    }

    setIsLoading(false);
  }, [isControlPanel, isDictationPanel]);

  useEffect(() => {
    if (!isControlPanel) return;
    // Fast path: a user who already finished onboarding never enters the
    // compact flow, so restore the saved window size right away.
    const completed = localStorage.getItem("onboardingCompleted") === "true";
    if (completed && !isOnboardingInProgress()) {
      void window.electronAPI?.setOnboardingWindowMode?.("restore");
    }
  }, [isControlPanel]);

  const settledControlPanelWindowMode = resolveSettledControlPanelWindowMode({
    isControlPanel,
    isLoading,
    showOnboarding,
  });

  useEffect(() => {
    if (!settledControlPanelWindowMode) return;
    // The main process waits for this renderer decision before showing the
    // control panel, preventing a fresh install from flashing at 1200×800
    // before its route-appropriate window mode is applied.
    void window.electronAPI?.setOnboardingWindowMode?.(settledControlPanelWindowMode);
  }, [settledControlPanelWindowMode]);

  useEffect(() => {
    if (isLoading) return;

    const onboardingCompleted = localStorage.getItem("onboardingCompleted") === "true";
    const normalAppVisible = onboardingCompleted && (!isControlPanel || !showOnboarding);
    // Main starts fail-closed. Only a renderer that has resolved the route and
    // actually committed the normal app may release global hotkeys and popup
    // surfaces; fresh installs and onboarding reloads keep them suppressed.
    void window.electronAPI?.setOnboardingActive?.(!normalAppVisible);
    if (normalAppVisible) window.electronAPI?.markMacAccessibilityFeaturesReady?.();
  }, [isControlPanel, isLoading, showOnboarding]);

  const handleOnboardingComplete = (options) => {
    if (options?.openSettings) {
      setPostOnboardingSettingsSection("transcription");
    }
    setShowOnboarding(false);
    localStorage.setItem("onboardingCompleted", "true");
  };

  // isLoading clears once the onboarding effect has run.
  if (isLoading) {
    return <LoadingFallback />;
  }

  if (isControlPanel && showOnboarding) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <RT0Setup onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  return isControlPanel ? (
    <Suspense fallback={<LoadingFallback />}>
      <ControlPanel initialSettingsSection={postOnboardingSettingsSection} />
    </Suspense>
  ) : (
    <App />
  );
}

function LoadingFallback({ message }) {
  const { t } = useTranslation();
  const fallbackMessage = message || t("common.loading");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 animate-[scale-in_300ms_ease-out]">
        <svg
          viewBox="0 0 1024 1024"
          className="w-12 h-12 drop-shadow-[0_2px_8px_rgba(37,99,235,0.18)] dark:drop-shadow-[0_2px_12px_rgba(100,149,237,0.25)]"
          aria-label="only-whispers"
        >
          <rect width="1024" height="1024" rx="241" fill="#2056DF" />
          <circle cx="512" cy="512" r="314" fill="#2056DF" stroke="white" strokeWidth="74" />
          <path d="M512 383V641" stroke="white" strokeWidth="74" strokeLinecap="round" />
          <path d="M627 457V568" stroke="white" strokeWidth="74" strokeLinecap="round" />
          <path d="M397 457V568" stroke="white" strokeWidth="74" strokeLinecap="round" />
        </svg>
        <div className="w-7 h-7 rounded-full border-[2.5px] border-transparent border-t-primary animate-[spinner-rotate_0.8s_cubic-bezier(0.4,0,0.2,1)_infinite] motion-reduce:animate-none motion-reduce:border-t-muted-foreground motion-reduce:opacity-50" />
        {fallbackMessage && (
          <p className="text-[13px] font-medium text-muted-foreground dark:text-foreground/60 tracking-[-0.01em]">
            {fallbackMessage}
          </p>
        )}
      </div>
    </div>
  );
}
