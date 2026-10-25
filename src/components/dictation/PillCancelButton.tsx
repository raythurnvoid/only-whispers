import { X } from "../icons";
import { VOICE_PILL_CANCEL } from "../../helpers/voicePillPresentation";

const { size: CANCEL_BUTTON_SIZE, gap: CANCEL_BUTTON_GAP } = VOICE_PILL_CANCEL;

interface PillCancelButtonProps {
  visible: boolean;
  ariaLabel: string;
  onCancel: () => void;
}

/** The pill's discard control. It stays beside the pill for the whole
 *  recording and processing, muted until hovered. */
export function PillCancelButton({ visible, ariaLabel, onCancel }: PillCancelButtonProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      className="flex shrink-0 items-center justify-center rounded-full border border-border/55 bg-surface-2 text-muted-foreground shadow-sm transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      style={{
        // Sized from the shared contract: the pill window is sized to fit the
        // widest pill plus this gap and button (windowConfig.js).
        width: CANCEL_BUTTON_SIZE,
        height: CANCEL_BUTTON_SIZE,
        marginLeft: CANCEL_BUTTON_GAP,
      }}
    >
      <X size={13} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
