import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { useToast } from "./useToast";

interface TranscriptTextEditorProps {
  initialText?: string;
  placeholder?: string;
  review?: boolean;
  onRemove?: () => Promise<boolean>;
  /** Returns false (or throws) when the text could not be saved. */
  onSave: (text: string) => Promise<boolean>;
  onCancel: () => void;
}

// Text area with Save and Cancel, for writing a transcript or editing one.
// Ctrl+Enter (Cmd+Enter on macOS) saves and Esc cancels.
export default function TranscriptTextEditor({
  initialText = "",
  placeholder,
  review = false,
  onRemove,
  onSave,
  onCancel,
}: TranscriptTextEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [isSaving, setIsSaving] = useState(false);
  // Unchanged words and confirmed silence are both useful review results.
  const canSave = !isSaving && (review || (text.trim() !== "" && text !== initialText));

  // Start with the caret at the end, ready to keep typing.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const save = async (remove = false) => {
    if (!canSave) return;
    setIsSaving(true);
    let saved = false;
    try {
      saved = remove && onRemove ? await onRemove() : await onSave(text.trim());
    } catch {
      saved = false;
    }
    setIsSaving(false);
    if (!saved) toast({ title: t("controlPanel.history.saveFailed"), variant: "destructive" });
  };

  return (
    <div>
      {review && (
        <p className="mb-2 text-xs text-muted-foreground">{t("controlPanel.history.reviewHint")}</p>
      )}
      <Textarea
        ref={textareaRef}
        aria-label={review ? t("controlPanel.history.reviewWords") : undefined}
        dir="auto"
        value={text}
        placeholder={placeholder}
        rows={Math.min(12, Math.max(3, text.split("\n").length + 1))}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!isSaving) onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
        className="border-border bg-background text-base text-foreground placeholder:text-muted-foreground hover:border-border focus:border-primary focus:ring-primary/20 dark:border-white/10 dark:bg-surface-1"
      />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="me-auto h-7 text-xs"
            disabled={isSaving}
            onClick={() => void save(true)}
          >
            {t("controlPanel.history.removeReview")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onCancel}
          disabled={isSaving}
        >
          {t("common.cancel")}
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={!canSave}>
          {t(
            review
              ? text.trim()
                ? "controlPanel.history.confirmWords"
                : "controlPanel.history.confirmSilence"
              : "common.save"
          )}
        </Button>
      </div>
    </div>
  );
}
