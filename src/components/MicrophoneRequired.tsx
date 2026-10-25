import { useEffect, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import LaurelLogo from "./LaurelLogo";
import WindowControls from "./WindowControls";
import { Button } from "./ui/button";
import type { MicrophoneCheck } from "../hooks/useMicrophoneCheck";
import { usePalazzoTheme } from "../hooks/usePalazzoTheme";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

/**
 * Shown in place of the control panel while the app can't use a microphone,
 * since nothing works without one. Global hotkeys stay off meanwhile
 * (AppRouter), and the screen goes away as soon as the mic can be used.
 */
export default function MicrophoneRequired({ microphone }: { microphone: MicrophoneCheck }) {
  const { t } = useTranslation();
  usePalazzoTheme();
  const { state, recheck } = microphone;

  // The same small window as the setup screen. AppRouter restores the full
  // size once the mic can be used.
  useEffect(() => {
    void window.electronAPI?.setOnboardingWindowMode?.("compact");
  }, []);

  const allow = async () => {
    await window.electronAPI?.requestMicrophoneAccess?.();
    await recheck();
  };
  const actions = {
    ask: { label: t("microphoneCheck.allow"), onClick: allow },
    denied: {
      label: t("microphoneCheck.openSettings"),
      onClick: () => window.electronAPI?.openMicrophoneSettings?.(),
    },
    restart: {
      label: t("microphoneCheck.restart"),
      onClick: () => window.electronAPI?.relaunchApp?.(),
    },
  };
  const action = state in actions ? actions[state as keyof typeof actions] : null;

  // The setup screen's look: marble window, moulded titlebar, one stone panel.
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
          <LaurelLogo />
          <p className="text-balance text-center text-[15px] italic text-muted-foreground">
            {t("microphoneCheck.description")}
          </p>

          <div className="pz-panel mt-5 space-y-2 px-4 py-4">
            <h4 className="font-medium text-foreground">{t("microphoneCheck.title")}</h4>
            <p className="text-sm text-foreground">{t(`microphoneCheck.states.${state}`)}</p>
          </div>

          {action && (
            <Button type="button" onClick={action.onClick} className="mt-5 h-10 w-full">
              {action.label}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
