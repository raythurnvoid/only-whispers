import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import ChatGPTSignIn from "./ChatGPTSignIn";
import LocalSpeechModel from "./settings/LocalSpeechModel";
import LaurelLogo from "./LaurelLogo";
import { Button } from "./ui/button";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import type { MicrophoneCheck } from "../hooks/useMicrophoneCheck";
import { usePalazzoTheme } from "../hooks/usePalazzoTheme";
import { useSettingsStore } from "../stores/settingsStore";
import { getDefaultHotkey } from "../utils/hotkeys";

const TRANSCRIPTION_MODEL = "voxtral-mini-transcribe-3-0";
const CLEANUP_MODEL = "gpt-6-luna";

export default function AppSetup({
  microphone,
  onComplete,
}: {
  microphone: MicrophoneCheck;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  usePalazzoTheme();
  const store = useSettingsStore();
  const [modelReady, setModelReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);

  const { registerHotkey } = useHotkeyRegistration({
    onSuccess: (registered) => store.setDictationKey(registered),
    onError: (message) => setError(message),
    showSuccessToast: false,
    showErrorToast: false,
  });

  // The main process shows this window only once the renderer picks its size, and
  // keeps global hotkeys off until setup is done (AppRouter turns them back on).
  useEffect(() => {
    void window.electronAPI?.setOnboardingActive?.(true);
    void window.electronAPI?.setOnboardingWindowMode?.("compact");
  }, []);

  const finish = async () => {
    setFinishing(true);
    setError("");
    try {
      if (!(await registerHotkey(store.dictationKey || getDefaultHotkey()))) return;
      // Hold-to-talk, like Wispr Flow, unless the user already picked a mode.
      if (localStorage.getItem("activationMode") === null) store.setActivationMode("push");

      store.setCloudTranscriptionModel(TRANSCRIPTION_MODEL);
      store.setCloudReasoningForAllScopes({
        cleanupCloudMode: "byok",
        cleanupProvider: "openai",
        cleanupModel: CLEANUP_MODEL,
        useCleanupModel: true,
        useDictationAgent: true,
      });

      await window.electronAPI?.saveAllKeysToEnv?.();
      // macOS asks for the mic only once, so ask on this click. A mic that still
      // can't be used then gets the microphone screen (AppRouter).
      if (microphone.state === "ask") await window.electronAPI?.requestMicrophoneAccess?.();
      await microphone.recheck();
      await window.electronAPI?.setOnboardingWindowMode?.("restore");
      // No upstream account: without these flags the app asks to sign in to one.
      localStorage.setItem("authenticationSkipped", "true");
      localStorage.setItem("skipAuth", "true");
      onComplete();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <main className="pz-window flex h-screen flex-col">
      {/* The frameless window's titlebar. On Windows and Linux the system draws its window
          buttons over it (titleBarOverlay in windowManager.js). */}
      <header
        className="h-10 shrink-0"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
        data-window-drag-zone=""
      />
      <div className="pz-ornament pz-moulding" aria-hidden="true" />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6">
        <div className="mx-auto flex max-w-[26rem] flex-col">
          {/* The same logo as the control panel sidebar and the website. */}
          <LaurelLogo />
          <p className="text-balance text-center text-[15px] italic text-muted-foreground">
            {t("appSetup.description")}
          </p>

          <div className="pz-panel mt-5 divide-y divide-border">
            <div className="px-4 py-4">
              <LocalSpeechModel onReadyChange={setModelReady} />
            </div>
            <div className="px-4 py-4">
              <ChatGPTSignIn onStatusChange={setSignedIn} />
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          <Button
            type="button"
            onClick={finish}
            disabled={!modelReady || !signedIn || finishing}
            className="mt-5 h-10 w-full"
          >
            {finishing ? t("common.loading") : t("appSetup.start")}
          </Button>
        </div>
      </div>
    </main>
  );
}
