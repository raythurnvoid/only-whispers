import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import appIcon from "@/assets/icon.png";
import ChatGPTSignIn from "./ChatGPTSignIn";
import WindowControls from "./WindowControls";
import { Button } from "./ui/button";
import { FieldLabel, ProviderCheckField } from "./ui/ProviderCheckField";
import { useConnectionAutoCheck } from "../hooks/useConnectionAutoCheck";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { usePalazzoTheme } from "../hooks/usePalazzoTheme";
import { useSettingsStore } from "../stores/settingsStore";
import { getDefaultHotkey } from "../utils/hotkeys";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

const TRANSCRIPTION_MODEL = "voxtral-mini-transcribe-3-0";
const CLEANUP_MODEL = "gpt-6-luna";

/**
 * First-run setup, in place of upstream onboarding: a Mistral API key for
 * speech-to-text and Sign in with ChatGPT for cleanup. Everything else keeps
 * its default and can be changed later in Settings.
 */
export default function AppSetup({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  usePalazzoTheme();
  const store = useSettingsStore();
  // null until edited, so the saved key fills the field when it loads.
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const mistralKey = draftKey ?? store.mistralApiKey;
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);

  const check = useConnectionAutoCheck({
    config: {
      scope: "transcription",
      provider: "mistral",
      apiKey: mistralKey,
      model: TRANSCRIPTION_MODEL,
    },
    ready: Boolean(mistralKey.trim()),
  });
  const keyUsable = check.phase === "connected" || check.phase === "unverified";

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

      store.setMistralApiKey(mistralKey.trim());
      store.setCloudTranscriptionModel(TRANSCRIPTION_MODEL);
      store.setCloudReasoningForAllScopes({
        cleanupCloudMode: "byok",
        cleanupProvider: "openai",
        cleanupModel: CLEANUP_MODEL,
        useCleanupModel: true,
        useDictationAgent: true,
      });

      await window.electronAPI?.saveAllKeysToEnv?.();
      await window.electronAPI?.setOnboardingWindowMode?.("restore");
      // No upstream account: without these flags the app asks to sign in to one.
      localStorage.setItem("authenticationSkipped", "true");
      localStorage.setItem("skipAuth", "true");
      onComplete();
    } finally {
      setFinishing(false);
    }
  };

  // The Palazzo look of the control panel: marble window, moulded titlebar, a stone
  // panel for the two fields (styles/palazzo.css).
  return (
    <main className="pz-window flex h-screen flex-col">
      {/* The frameless window's titlebar. */}
      <header
        className="flex h-10 shrink-0 items-center justify-end px-3"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
        data-window-drag-zone=""
      >
        {platform !== "darwin" && (
          <div data-no-window-drag="" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
            <WindowControls />
          </div>
        )}
      </header>
      <div className="pz-ornament pz-moulding" aria-hidden="true" />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6">
        <div className="mx-auto flex max-w-[26rem] flex-col">
          <img
            src={appIcon}
            alt=""
            aria-hidden="true"
            width={64}
            height={64}
            decoding="async"
            draggable={false}
            className="mx-auto"
          />
          <h1 className="mt-3 text-balance text-center text-xl text-foreground">
            {t("appSetup.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-center text-[15px] italic text-muted-foreground">
            {t("appSetup.description")}
          </p>

          <div className="pz-panel mt-5 divide-y divide-border">
            <label className="block px-4 py-4">
              <FieldLabel>{t("appSetup.mistralKey")}</FieldLabel>
              <ProviderCheckField
                aria-label={t("appSetup.mistralKey")}
                check={check}
                invalidOn="credentialsRejected"
                type="password"
                value={mistralKey}
                onChange={(event) => setDraftKey(event.target.value)}
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
            <div className="px-4 py-4">
              <ChatGPTSignIn onStatusChange={setSignedIn} />
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          <Button
            type="button"
            onClick={finish}
            disabled={!keyUsable || !signedIn || finishing}
            className="mt-5 h-10 w-full"
          >
            {finishing ? t("common.loading") : t("appSetup.start")}
          </Button>
        </div>
      </div>
    </main>
  );
}
