import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ChatGPTSignIn from "./ChatGPTSignIn";
import OnboardingShell, { CompactOnboardingFrame } from "./onboarding/OnboardingShell";
import { Button } from "./ui/button";
import { FieldLabel, ProviderCheckField } from "./ui/ProviderCheckField";
import { useConnectionAutoCheck } from "../hooks/useConnectionAutoCheck";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { useSettingsStore } from "../stores/settingsStore";
import { getDefaultHotkey } from "../utils/hotkeys";

const TRANSCRIPTION_MODEL = "voxtral-mini-transcribe-3-0";
const CLEANUP_MODEL = "gpt-6-luna";

/**
 * First-run setup, in place of upstream onboarding: a Mistral API key for
 * speech-to-text and Sign in with ChatGPT for cleanup. Everything else keeps
 * its default and can be changed later in Settings.
 */
export default function RT0Setup({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
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
      store.setCloudTranscriptionForAllScopes({
        useLocalWhisper: false,
        cloudTranscriptionMode: "byok",
      });
      store.switchCloudTranscriptionProvider("dictation", "mistral");
      store.setCloudTranscriptionModel(TRANSCRIPTION_MODEL);
      store.setCloudReasoningForAllScopes({
        cleanupCloudMode: "byok",
        cleanupProvider: "openai",
        cleanupModel: CLEANUP_MODEL,
        useCleanupModel: true,
        useDictationAgent: true,
      });

      await window.electronAPI?.saveAllKeysToEnv?.();
      await window.electronAPI?.markBundleMigrated?.();
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
    <OnboardingShell compact stepKey="rt0-setup">
      <CompactOnboardingFrame>
        <div className="onboarding-shell-scroll relative flex h-full flex-col overflow-y-auto px-5 pb-6 pt-45">
          <h1 className="onboarding-display-title mx-auto max-w-96 text-balance text-center text-3xl!">
            {t("rt0Setup.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-center text-sm text-[var(--onboarding-text-secondary)]">
            {t("rt0Setup.description")}
          </p>

          <div className="mt-5 space-y-4 rounded-[1.35rem] bg-[var(--onboarding-surface-secondary)] p-4">
            <label className="block">
              <FieldLabel>{t("rt0Setup.mistralKey")}</FieldLabel>
              <ProviderCheckField
                aria-label={t("rt0Setup.mistralKey")}
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
                className="mt-1.5 inline-block text-xs text-[var(--onboarding-link)] hover:opacity-80"
              >
                {t("rt0Setup.getMistralKey")}
              </a>
            </label>
            <div className="h-px bg-[var(--onboarding-surface-tertiary)]" />
            <ChatGPTSignIn onStatusChange={setSignedIn} />
          </div>

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          <Button
            type="button"
            onClick={finish}
            disabled={!keyUsable || !signedIn || finishing}
            className="mt-5 h-10 w-full rounded-[38px] text-sm"
          >
            {finishing ? t("common.loading") : t("rt0Setup.start")}
          </Button>
        </div>
      </CompactOnboardingFrame>
    </OnboardingShell>
  );
}
