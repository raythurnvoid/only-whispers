import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { useToast } from "./useToast";

interface TranscriptTextEditorProps {
  initialText?: string;
  placeholder?: string;
  /** Returns false (or throws) when the text could not be saved. */
  onSave: (text: string) => Promise<boolean>;
  onCancel: () => void;
}

// Text area with Save and Cancel, for writing a transcript or editing one.
// Ctrl+Enter (Cmd+Enter on macOS) saves and Esc cancels.
export default function TranscriptTextEditor({
  initialText = "",
  placeholder,
  onSave,
  onCancel,
}: TranscriptTextEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [isSaving, setIsSaving] = useState(false);
  const canSave = text.trim() !== "" && text !== initialText && !isSaving;

  // Start with the caret at the end, ready to keep typing.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const save = async () => {
    if (!canSave) return;
    setIsSaving(true);
    let saved = false;
    try {
      saved = await onSave(text.trim());
    } catch {
      saved = false;
    }
    setIsSaving(false);
    if (!saved) toast({ title: t("controlPanel.history.saveFailed"), variant: "destructive" });
  };

  return (
    <div>
      <Textarea
        ref={textareaRef}
        dir="auto"
        value={text}
        placeholder={placeholder}
        rows={Math.min(12, Math.max(3, text.split("\n").length + 1))}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
        className="border-border bg-background text-base text-foreground placeholder:text-muted-foreground hover:border-border focus:border-primary focus:ring-primary/20 dark:border-white/10 dark:bg-surface-1"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={save} disabled={!canSave}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
