import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, RefreshCw, Trash2 } from "./icons";
import { Button } from "./ui/button";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";
import { cn } from "./lib/utils";
import { CARD_SURFACE_CLASS } from "./ui/surfaces";

type ErrorLogEntry = Awaited<ReturnType<Window["electronAPI"]["getErrorLog"]>>[number];

/** Warnings and errors from logs/errors.log, newest first. The dictation widget shows none. */
export default function LogsView() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);

  const refresh = useCallback(async () => {
    setEntries(await window.electronAPI.getErrorLog());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="h-full overflow-y-auto">
      <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "flex flex-col gap-3 px-6 py-5")}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-base italic text-muted-foreground">{t("logsView.description")}</p>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw size={12} />
              {t("logsView.refresh")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.electronAPI.openLogsFolder()}>
              <FolderOpen size={12} />
              {t("logsView.openFolder")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={entries.length === 0}
              onClick={async () => {
                await window.electronAPI.clearErrorLog();
                setEntries([]);
              }}
            >
              <Trash2 size={12} />
              {t("logsView.clear")}
            </Button>
          </div>
        </div>

        <div className={CARD_SURFACE_CLASS}>
          {entries.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground text-center">{t("logsView.empty")}</p>
          ) : (
            <ul>
              {entries.map((entry, index) => (
                <li
                  key={`${entry.time}-${index}`}
                  // A ledger row: date over time, level, then the message.
                  className="grid grid-cols-[112px_64px_minmax(0,1fr)] items-baseline gap-x-3 px-5 py-3 border-b border-border last:border-b-0"
                >
                  <div className="contents">
                    <span className="pz-time text-[12.5px] tabular-nums">
                      {new Date(entry.time).toLocaleDateString()}
                      <small>{new Date(entry.time).toLocaleTimeString()}</small>
                    </span>
                    <span
                      className={cn(
                        "pz-section-label text-[11px] font-semibold",
                        entry.level === "warn" ? "text-warning" : "text-destructive"
                      )}
                    >
                      {entry.level}
                    </span>
                    <span dir="auto" className="text-base text-foreground break-words min-w-0">
                      {entry.message}
                    </span>
                  </div>
                  {entry.details && (
                    <details className="col-start-3 mt-1">
                      <summary className="cursor-pointer text-sm text-muted-foreground">
                        {t("logsView.details")}
                      </summary>
                      <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/70 px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {entry.details}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
