import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { version } from "../../../package.json";
import type { UpdateCheck } from "../../types/electron";
import { Button } from "../ui/button";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";

export default function UpdatesSection({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<UpdateCheck | { status: "checking"; currentVersion: string }>({
    status: "checking",
    currentVersion: version,
  });
  const [attempt, setAttempt] = useState(0);
  const [downloaded, setDownloaded] = useState<string>();
  const [install, setInstall] = useState<"idle" | "restarting" | "failed">("idle");

  useEffect(() => {
    return window.electronAPI?.onUpdateDownloaded?.(({ version }) => setDownloaded(version));
  }, []);

  useEffect(() => {
    let active = true;
    async function checkUpdates() {
      try {
        const result = await window.electronAPI.checkForUpdates();
        if (active) setCheck(result);
      } catch {
        if (active) setCheck({ status: "error", currentVersion: version });
      }
    }
    void checkUpdates();
    return () => {
      active = false;
    };
  }, [attempt]);

  const restart = async () => {
    setInstall("restarting");
    try {
      if (await window.electronAPI.installUpdate()) return;
    } catch {
      // The existing install path can reject or report that it could not start.
    }
    setInstall("failed");
  };

  // A deep link still checks once when Settings opens. Switching tabs reuses that result.
  if (!visible) return null;
  const readyVersion = downloaded || (check.status === "ready" && check.updateVersion);
  const message =
    install === "failed"
      ? t("controlPanel.update.installError")
      : readyVersion
        ? t("controlPanel.update.readyTitleVersion", { version: readyVersion })
        : t(`controlPanel.update.${check.status}`);

  return (
    <section className="mb-6">
      <h3 className="mb-3 text-xs font-semibold text-foreground tracking-tight">
        {t("controlPanel.update.title")}
      </h3>
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("controlPanel.update.installed", { version: check.currentVersion })}
            description={<span role="status">{message}</span>}
          >
            {readyVersion ? (
              <Button type="button" size="sm" disabled={install === "restarting"} onClick={restart}>
                {t(
                  install === "restarting"
                    ? "controlPanel.update.restarting"
                    : "controlPanel.update.restart"
                )}
              </Button>
            ) : check.status !== "dev" && check.status !== "unsupported" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={check.status === "checking"}
                onClick={() => {
                  setCheck({ status: "checking", currentVersion: check.currentVersion });
                  setAttempt((value) => value + 1);
                }}
              >
                {t(check.status === "error" ? "common.retry" : "controlPanel.update.check")}
              </Button>
            ) : null}
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
    </section>
  );
}
