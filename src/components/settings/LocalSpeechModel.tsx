import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalModelStatus } from "../../types/electron";
import { Button } from "../ui/button";

export default function LocalSpeechModel({
  onReadyChange,
}: {
  onReadyChange?: (ready: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<LocalModelStatus>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [installing, setInstalling] = useState(false);
  const ready = status?.state === "ready";
  const busy = installing || status?.state === "downloading";

  useEffect(() => {
    onReadyChange?.(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const fail = (cause: unknown) => {
      if (active) {
        active = false;
        clearTimeout(timer);
        setStatus(undefined);
        setError(String(cause));
        setInstalling(false);
      }
    };
    const readStatus = async () => {
      try {
        const current = await window.electronAPI.getLocalModelStatus();
        if (!active) return;
        setStatus(current);
        if (current.state === "downloading" || attempt > 0) {
          timer = setTimeout(readStatus, 750);
        }
      } catch (cause) {
        fail(cause);
      }
    };

    if (attempt > 0) {
      window.electronAPI.downloadLocalModel().then((installed) => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        setInstalling(false);
        setStatus(installed);
      }, fail);
    }
    void readStatus();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt]);

  const download = () => {
    setError("");
    setInstalling(true);
    setAttempt((value) => value + 1);
  };

  const failure = error || status?.error;
  const size =
    status &&
    new Intl.NumberFormat(i18n.language, {
      style: "unit",
      unit: "megabyte",
      maximumFractionDigits: 0,
    }).format(status.totalBytes / 1_000_000);
  const percent = status?.totalBytes
    ? Math.floor((status.downloadedBytes / status.totalBytes) * 100)
    : 0;

  return (
    <section className="space-y-2">
      <h4 className="font-medium text-foreground">{t("localSpeech.title")}</h4>
      <p className="text-sm text-muted-foreground">{t("localSpeech.description")}</p>
      {status && (
        <p className="text-sm">
          {status.name} · {size}
        </p>
      )}
      {busy && (
        <progress
          className="w-full accent-primary"
          aria-label={t("localSpeech.download")}
          max={100}
          value={percent}
        />
      )}
      <p role="status" className="text-sm">
        {busy
          ? t("localSpeech.downloading", { percent })
          : ready
            ? t("localSpeech.ready")
            : !status && !error
              ? t("common.loading")
              : ""}
      </p>
      {!busy && failure && (
        <p role="alert" className="break-words text-xs text-destructive">
          {failure}
        </p>
      )}
      {!ready && !busy && (status || error) && (
        <Button variant="outline" size="sm" type="button" onClick={download}>
          {failure || status?.state === "error" ? t("common.retry") : t("localSpeech.download")}
        </Button>
      )}
    </section>
  );
}
