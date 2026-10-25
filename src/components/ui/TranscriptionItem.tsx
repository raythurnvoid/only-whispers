import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Tooltip } from "./tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import {
  Copy,
  Trash2,
  FileText,
  FolderOpen,
  RotateCcw,
  Loader2,
  AlertCircle,
  ArchiveRestore,
  MoreVertical,
  Pencil,
  Play,
  Square,
} from "../icons";
import TranscriptTextEditor from "./TranscriptTextEditor";
import { updateTranscription } from "../../stores/transcriptionStore";
import type {
  TranscriptionItem as TranscriptionItemType,
  TranscriptionErrorCode,
} from "../../types/electron";
import { cn } from "../lib/utils";
import { getCachedPlatform } from "../../utils/platform";
import { formatMmSs } from "../../utils/formatDuration";

const platform = getCachedPlatform();

const ACTION_BUTTON_CLASS =
  "h-7 w-7 rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-foreground/6 dark:hover:bg-white/6";

const TRANSCRIPT_TEXT_CLASS =
  "text-base leading-[1.55] wrap-break-word whitespace-pre-wrap text-foreground";

function getShowInFolderKey(): string {
  if (platform === "win32") return "controlPanel.history.showInFolderWindows";
  if (platform === "linux") return "controlPanel.history.showInFolderLinux";
  return "controlPanel.history.showInFolder";
}

interface MenuAction {
  key: string;
  icon: typeof Copy;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface TranscriptionItemProps {
  item: TranscriptionItemType;
  onCopy: (text: string) => void;
  onDelete: (id: number) => void;
  onShowAudioInFolder?: (id: number) => void;
  onRetryTranscription?: (id: number, options?: { isRecover?: boolean }) => Promise<void>;
  onOpenSettings?: (section?: string) => void;
}

export default function TranscriptionItem({
  item,
  onCopy,
  onDelete,
  onShowAudioInFolder,
  onRetryTranscription,
  onOpenSettings,
}: TranscriptionItemProps) {
  const { t, i18n } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);

  const timestampSource = item.timestamp.endsWith("Z") ? item.timestamp : `${item.timestamp}Z`;
  const timestampDate = new Date(timestampSource);
  // Split so the ledger shows "11:27" over a small "PM" (no period in 24-hour locales).
  const timeParts = Number.isNaN(timestampDate.getTime())
    ? []
    : new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).formatToParts(
        timestampDate
      );
  const formattedTime = timeParts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const dayPeriod = timeParts.find((part) => part.type === "dayPeriod")?.value;

  const handleRetry = async () => {
    if (isRetrying || !onRetryTranscription) return;
    setIsRetrying(true);
    try {
      await onRetryTranscription(item.id, { isRecover: item.status === "discarded" });
    } finally {
      setIsRetrying(false);
    }
  };

  const stopAudio = () => {
    const player = playerRef.current;
    if (!player) return;
    playerRef.current = null;
    player.audio.pause();
    URL.revokeObjectURL(player.url);
    setIsPlaying(false);
  };

  const toggleAudio = async () => {
    if (playerRef.current) {
      stopAudio();
      return;
    }
    const result = await window.electronAPI.getTranscriptionAudio(item.id);
    if (!result.success) return;
    const url = URL.createObjectURL(new Blob([result.buffer], { type: "audio/webm" }));
    const audio = new Audio(url);
    playerRef.current = { audio, url };
    audio.onended = stopAudio;
    setIsPlaying(true);
    await audio.play().catch(stopAudio);
  };

  // Stop playback when the row goes away.
  useEffect(() => stopAudio, []);

  // The raw transcript stays as it was heard; only the shown text changes.
  const handleSaveEdit = async (text: string) => {
    const result = await window.electronAPI.updateTranscriptionText(item.id, text, item.raw_text);
    if (!result?.success || !result.transcription) return false;
    updateTranscription(result.transcription);
    setIsEditing(false);
    return true;
  };

  const isFailed = item.status === "failed";
  const isDiscarded = item.status === "discarded";
  const isTranscribed = !isFailed && !isDiscarded;
  const discardedDuration =
    item.audio_duration_ms && item.audio_duration_ms > 0
      ? formatMmSs(Math.round(item.audio_duration_ms / 1000))
      : null;
  const rawText = item.raw_text;
  const hasAudio = item.has_audio === 1;
  // A failed row keeps the transcript when only a later step failed.
  const hasKeptText = isFailed && item.text.trim() !== "";

  const errorCode = item.error_code as TranscriptionErrorCode;
  const isConfigError =
    errorCode === "API_KEY_MISSING" ||
    errorCode === "INVALID_KEY" ||
    errorCode === "PROVIDER_AUTH_FAILED" ||
    errorCode === "PROVIDER_ACCESS_DENIED" ||
    errorCode === "PROVIDER_QUOTA_EXHAUSTED" ||
    errorCode === "PROVIDER_MODEL_NOT_FOUND" ||
    errorCode === "PROVIDER_NO_RESPONSE" ||
    errorCode === "MODEL_NOT_AVAILABLE" ||
    errorCode === "CUSTOM_ENDPOINT_INVALID";
  const isLimitError = errorCode === "LIMIT_REACHED";
  const isOfflineError = errorCode === "OFFLINE";

  const retryLabel = t("controlPanel.history.retryTranscription");

  // Copy stays visible as the one-tap action; everything else lives in the menu.
  const candidateActions: (MenuAction | false)[] = [
    isDiscarded &&
      hasAudio && {
        key: "recover",
        icon: ArchiveRestore,
        label: t("controlPanel.history.discarded.recover"),
        onSelect: handleRetry,
      },
    !isDiscarded &&
      hasAudio && { key: "retry", icon: RotateCcw, label: retryLabel, onSelect: handleRetry },
    isTranscribed &&
      rawText !== null && {
        key: "raw",
        icon: FileText,
        label: t("controlPanel.history.viewRawTranscript"),
        onSelect: () => setIsExpanded((expanded) => !expanded),
      },
    hasAudio && {
      key: "folder",
      icon: FolderOpen,
      label: t(getShowInFolderKey()),
      onSelect: () => onShowAudioInFolder?.(item.id),
    },
    {
      key: "delete",
      icon: Trash2,
      label: t("controlPanel.history.deleteItem"),
      onSelect: () => onDelete(item.id),
      destructive: true,
    },
  ];
  const menuActions = candidateActions.filter((action): action is MenuAction => action !== false);

  return (
    <div
      className={cn(
        // A ledger row: time in the left gutter, text beside it, actions in their own
        // column so they never cover the text. Washes are see-through so the marble shows.
        "group/row grid grid-cols-[72px_minmax(0,1fr)_auto] gap-x-3 ps-5 pe-3 pt-4 pb-[18px] transition-colors duration-150",
        isFailed
          ? "bg-(--danger-wash)/85"
          : isDiscarded
            ? "bg-muted/40 opacity-80"
            : "hover:bg-muted/75"
      )}
    >
      <span className="pz-time pt-1 tabular-nums">
        {formattedTime}
        {dayPeriod && <small>{dayPeriod}</small>}
      </span>
      <div
        className={cn(
          "col-start-3 row-start-1 -mt-1 flex items-start justify-end gap-0.5 transition-opacity duration-150",
          // Actions surface on hover, keyboard focus, or while the menu is open; failed and
          // discarded rows keep them visible because recovery is the point of the row.
          isTranscribed &&
            "opacity-0 group-hover/row:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-state=open]]:opacity-100"
        )}
      >
        {/* Recovery is the point of a failed or discarded row, so its retry is a
              visible button, not only a menu item. */}
        {!isTranscribed && hasAudio && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={isRetrying}
            className="h-7 rounded-full px-3 text-xs"
          >
            {isRetrying ? (
              <Loader2 size={13} className="animate-spin" />
            ) : isDiscarded ? (
              <ArchiveRestore size={13} />
            ) : (
              <RotateCcw size={13} />
            )}
            {isDiscarded ? t("controlPanel.history.discarded.recover") : retryLabel}
          </Button>
        )}
        {hasAudio && (
          <Tooltip
            content={t(
              isPlaying ? "controlPanel.history.stopAudio" : "controlPanel.history.playAudio"
            )}
          >
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleAudio}
              aria-label={t(
                isPlaying ? "controlPanel.history.stopAudio" : "controlPanel.history.playAudio"
              )}
              className={ACTION_BUTTON_CLASS}
            >
              {isPlaying ? <Square size={13} /> : <Play size={13} />}
            </Button>
          </Tooltip>
        )}
        {(isTranscribed || hasKeptText) && (
          <Tooltip content={t("controlPanel.history.copyText")}>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onCopy(item.text)}
              aria-label={t("controlPanel.history.copyText")}
              className={ACTION_BUTTON_CLASS}
            >
              <Copy size={13} />
            </Button>
          </Tooltip>
        )}
        {isTranscribed && (
          <Tooltip content={t("controlPanel.history.editItem")}>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              disabled={isEditing}
              aria-label={t("controlPanel.history.editItem")}
              className={ACTION_BUTTON_CLASS}
            >
              <Pencil size={13} />
            </Button>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              disabled={isRetrying}
              aria-label={t("controlPanel.history.moreActions")}
              className={ACTION_BUTTON_CLASS}
            >
              {isRetrying ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <MoreVertical size={13} />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuActions.map(({ key, icon: Icon, label, onSelect, destructive }) => (
              <DropdownMenuItem
                key={key}
                onSelect={onSelect}
                className={cn(
                  "gap-2.5",
                  destructive && "text-destructive focus:bg-destructive/8 focus:text-destructive"
                )}
              >
                <Icon size={14} className="shrink-0 opacity-70" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="col-start-2 row-start-1 min-w-0">
        {isFailed ? (
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive">
                {t(
                  hasKeptText
                    ? "controlPanel.history.editFailedTranscriptKept"
                    : "controlPanel.history.transcriptionFailed"
                )}
              </p>
              {item.error_message && (
                <p className="mt-0.5 text-xs leading-relaxed wrap-break-word text-muted-foreground">
                  {item.error_message}
                </p>
              )}
              {isConfigError && hasKeptText && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <button
                    onClick={() => onOpenSettings?.("dictationAgent")}
                    className="cursor-pointer text-primary hover:underline"
                  >
                    {t("controlPanel.history.failedCtaAiSettings")}
                  </button>
                </p>
              )}
              {isConfigError && !hasKeptText && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasAudio ? (
                    <>
                      <button
                        onClick={() => onOpenSettings?.()}
                        className="cursor-pointer text-primary hover:underline"
                      >
                        {t("controlPanel.history.failedCtaSettings")}
                      </button>{" "}
                      {t("controlPanel.history.failedCtaAndRetry")}
                    </>
                  ) : (
                    <button
                      onClick={() => onOpenSettings?.()}
                      className="cursor-pointer text-primary hover:underline"
                    >
                      {t("controlPanel.history.failedCtaSettingsOnly")}
                    </button>
                  )}
                </p>
              )}
              {isLimitError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("controlPanel.history.failedLimitReached")}
                </p>
              )}
              {isOfflineError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("controlPanel.history.failedOffline")}
                </p>
              )}
            </div>
          </div>
        ) : isDiscarded ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("controlPanel.history.discarded.badge")}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {discardedDuration
                ? t("controlPanel.history.discarded.recordingWithDuration", {
                    duration: discardedDuration,
                  })
                : t("controlPanel.history.discarded.recording")}
            </span>
          </div>
        ) : isEditing ? (
          <TranscriptTextEditor
            initialText={item.text}
            onSave={handleSaveEdit}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <p dir="auto" className={TRANSCRIPT_TEXT_CLASS}>
            {item.text}
          </p>
        )}
        {hasKeptText && (
          <p dir="auto" className={cn("mt-2", TRANSCRIPT_TEXT_CLASS)}>
            {item.text}
          </p>
        )}
      </div>

      {isTranscribed && rawText !== null && (
        <div
          inert={!isExpanded}
          className={cn(
            "col-start-2 grid transition-[grid-template-rows] duration-200",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mt-2 border-t border-border/70 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("controlPanel.history.rawTranscript")}
                </span>
                <Tooltip content={t("controlPanel.history.copyRawTranscript")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onCopy(rawText)}
                    className="h-5 w-5 rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  >
                    <Copy size={10} />
                  </Button>
                </Tooltip>
              </div>
              <p dir="auto" className="mt-1 text-xs leading-relaxed text-muted-foreground/80">
                {rawText}
              </p>
              {rawText === item.text && (
                <p className="mt-1 text-[10px] italic text-muted-foreground/70">
                  {t("controlPanel.history.noAiProcessing")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
