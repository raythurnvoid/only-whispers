import React, { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import App from "./App.jsx";
import AgentDictationPillOverlay from "./components/dictation/AgentDictationPillOverlay.tsx";
import { BrandMarkIcon } from "./components/dictation/BrandMarkIcon.tsx";
import { PermissionGuideOverlay } from "./components/onboarding/PermissionGuideOverlay";
import { useControlPanelWindowDrag } from "./hooks/useControlPanelWindowDrag";
import { checkMicrophone, useMicrophoneCheck } from "./hooks/useMicrophoneCheck";
import { useTheme } from "./hooks/useTheme";
import { resolveSettledControlPanelWindowMode } from "./utils/controlPanelWindowMode.ts";
import { isControlPanelWindow } from "./utils/windowContext.ts";

// Keys the upstream onboarding flow persisted. Either one means a setup from
// an older build was left unfinished.
const ONBOARDING_SESSION_KEY = "onboardingSessionV2";
const LEGACY_ONBOARDING_STEP_KEY = "onboardingCurrentStep";
const isOnboardingInProgress = () =>
  localStorage.getItem(LEGACY_ONBOARDING_STEP_KEY) !== null ||
  localStorage.getItem(ONBOARDING_SESSION_KEY) !== null;

const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
// Replaces upstream onboarding: only a Mistral key and Sign in with ChatGPT.
const AppSetup = React.lazy(() => import("./components/AppSetup.tsx"));
const MicrophoneRequired = React.lazy(() => import("./components/MicrophoneRequired.tsx"));

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

  const isControlPanel = isControlPanelWindow();
  const isDictationPanel = !isControlPanel;
  // Covers every surface this window hosts: onboarding, reauth, the panel.
  useControlPanelWindowDrag(isControlPanel);
  // The app can't work without a microphone, so the control panel shows the
  // microphone screen in place of everything else until one can be used.
  const microphone = useMicrophoneCheck(isControlPanel);
  const microphoneReady = microphone.state === "ready";

  // A start in the tray creates no control panel, so the always-open dictation
  // window checks the mic at launch and opens the panel when it can't be used.
  useEffect(() => {
    if (!isDictationPanel || localStorage.getItem("onboardingCompleted") !== "true") return;
    checkMicrophone().then((state) => {
      if (state !== "ready") window.electronAPI?.showMicrophoneRequired?.();
    });
  }, [isDictationPanel]);

  useEffect(() => {
    if (isControlPanel) {
      import("./components/ControlPanel.tsx").catch(() => {});

      if (!localStorage.getItem("onboardingCompleted")) {
        import("./components/AppSetup.tsx").catch(() => {});
      }
    }
  }, [isControlPanel]);

  useEffect(() => {
    const resolved = localStorage.getItem("onboardingCompleted") === "true";

    if (isControlPanel && !resolved) {
      setShowOnboarding(true);
    }

    if (isDictationPanel && !resolved) {
      // Keep the dictation overlay hidden until the setup screen is done.
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
    microphoneReady,
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
    const normalAppVisible =
      onboardingCompleted && (!isControlPanel || (!showOnboarding && microphoneReady));
    // Main starts fail-closed. Only a renderer that has resolved the route and
    // actually committed the normal app may release global hotkeys and popup
    // surfaces; fresh installs, onboarding reloads and the microphone screen
    // keep them suppressed.
    void window.electronAPI?.setOnboardingActive?.(!normalAppVisible);
    if (normalAppVisible) window.electronAPI?.markMacAccessibilityFeaturesReady?.();
  }, [isControlPanel, isLoading, showOnboarding, microphoneReady]);

  const handleOnboardingComplete = () => {
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
        <AppSetup microphone={microphone} onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  if (isControlPanel && microphone.state === "checking") {
    return <LoadingFallback />;
  }

  if (isControlPanel && !microphoneReady) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <MicrophoneRequired microphone={microphone} />
      </Suspense>
    );
  }

  return isControlPanel ? (
    <Suspense fallback={<LoadingFallback />}>
      <ControlPanel />
    </Suspense>
  ) : (
    <App />
  );
}

function LoadingFallback() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 animate-[scale-in_300ms_ease-out]">
        <BrandMarkIcon size={48} className="text-foreground" />
        <div className="w-7 h-7 rounded-full border-[2.5px] border-transparent border-t-primary animate-[spinner-rotate_0.8s_cubic-bezier(0.4,0,0.2,1)_infinite] motion-reduce:animate-none motion-reduce:border-t-muted-foreground motion-reduce:opacity-50" />
        <p className="text-[13px] font-medium text-muted-foreground dark:text-foreground/60 tracking-[-0.01em]">
          {t("common.loading")}
        </p>
      </div>
    </div>
  );
}
