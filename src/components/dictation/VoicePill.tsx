import { forwardRef, type HTMLAttributes } from "react";
import { ChevronUp, X } from "../icons";
import { cn } from "../lib/utils";
import { MistralIcon, OpenAIIcon } from "./ModelIcons";
import { PillWaveform } from "./PillWaveform";
import { VoiceIdentityIcon } from "./VoiceIdentityIcon";
import { RESTING_WAVE_SILHOUETTE, WAVEFORM_BAR_COUNT } from "./waveformMath";
import {
  VOICE_PILL_CANCEL,
  VOICE_PILL_FOOTPRINT,
  VOICE_PILL_GROW_TRANSITION,
} from "../../helpers/voicePillPresentation";

export type VoicePillState =
  "idle" | "hover" | "recording" | "processing" | "thinking" | "unavailable";

/** Which model is working right now, shown on plain dictation's status pill. */
export interface DictationPillStatus {
  phase: "listening" | "processing";
  provider: "mistral" | "openai";
  model: string;
  activity: string;
}

interface VoicePillProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  variant: "floating" | "panel";
  state: VoicePillState;
  getAudioLevel: () => number | null;
  expanded?: boolean;
  collapseToLogo?: boolean;
  waveformVisible?: boolean;
  waveformOnlyWhileRecording?: boolean;
  integratedWithPanel?: boolean;
  agentMode?: boolean;
  showExpandChevron?: boolean;
  isDragging?: boolean;
  horizontalDirection?: "left" | "right";
  /** Set for plain dictation: one fixed-size pill with the model's icon, a
   *  short status label and a mini waveform. Null keeps the original pill. */
  dictationStatus?: DictationPillStatus | null;
  /** Shows a ring while recording hands-free: "locked" by a double tap (with a
   *  short snap) or "tap" mode. Null while the key is held. */
  handsFree?: "locked" | "tap" | null;
  /** Set while a recording or its processing can be discarded: shows the X
   *  inside the pill, at its end. */
  cancel?: { label: string; onCancel: () => void } | null;
}

// Mini waveform for the dictation status pill. "Voxtral is listening" is
// short, so the live wave gets more bars to fill the space after it; the
// longer processing label leaves room for the 7-bar ripple only.
const DICTATION_LISTENING_BAR_COUNT = 15;
const DICTATION_RIPPLE_BAR_COUNT = 7;
const DICTATION_WAVE_MAX_PX = 14;

// Sized from WAVEFORM_BAR_COUNT so a bar-count change can never silently
// desync the resting silhouette from the live waveform's footprint.
const RESTING_WAVE_HEIGHTS = Array.from(
  { length: WAVEFORM_BAR_COUNT },
  (_, index) => RESTING_WAVE_SILHOUETTE[index % RESTING_WAVE_SILHOUETTE.length]
);

// Icon↔waveform spacing inside the compact pill. Together with the 98px
// recording footprint and pr-1.5, centering lands the documented 6/12 edge
// insets (VOICE_PILL_FOOTPRINT in voicePillPresentation.js).
const COMPACT_CONTENT_GAP_PX = 6;

const STATE_APPEARANCE: Record<VoicePillState, string> = {
  idle: "border-border-hover bg-surface-1 text-muted-foreground dark:border-border/50",
  hover: "border-border-hover bg-surface-3 text-foreground",
  recording: "border-border-hover bg-surface-1 text-foreground",
  processing: "border-border/60 bg-surface-1 text-foreground/70",
  thinking: "border-border/60 bg-surface-1 text-foreground",
  unavailable: "border-border/60 bg-surface-1 text-muted-foreground",
};

/** One persistent control that resizes between the floating and panel layouts. */
export const VoicePill = forwardRef<HTMLDivElement, VoicePillProps>(function VoicePill(
  {
    variant,
    state,
    getAudioLevel,
    expanded = false,
    collapseToLogo = false,
    waveformVisible = true,
    waveformOnlyWhileRecording = false,
    integratedWithPanel = false,
    agentMode = false,
    showExpandChevron = false,
    isDragging = false,
    horizontalDirection = "right",
    dictationStatus = null,
    handsFree = null,
    cancel = null,
    className,
    style,
    ...props
  },
  ref
) {
  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const isThinking = state === "thinking";
  const isUnavailable = state === "unavailable";
  // One Signal glow (comet orbit over a breathing halo) serves both
  // identities; only the palette differs. It lights for the real thinking
  // state alone — glowing during the entrance or while listening would read
  // as work already in flight before any transcript exists.
  const showSignalGlow = !isUnavailable && isThinking;
  const isPanel = variant === "panel";
  const collapseToIdentity = collapseToLogo || isThinking;
  const showCompactPill =
    !collapseToIdentity && (isRecording || expanded || (isPanel && !waveformOnlyWhileRecording));
  const showDivider = showCompactPill && waveformVisible && !isRecording;
  // The hidden divider's margins are what carry the compact pill's 6px
  // icon↔waveform gap; a visible divider keeps 4px flanking its 1px rule.
  const dividerMargin = showCompactPill ? (showDivider ? 4 : COMPACT_CONTENT_GAP_PX / 2) : 0;
  const identitySize = 22;
  const floatingHover = !isPanel && state === "hover";
  const baseFootprint = dictationStatus
    ? VOICE_PILL_FOOTPRINT.dictation
    : showCompactPill
      ? VOICE_PILL_FOOTPRINT.recording
      : VOICE_PILL_FOOTPRINT.idle;
  // The X sits inside the pill, so the pill grows by its slot. Only the
  // dictation and compact pills have room for it; the idle circle has none.
  const showCancel = Boolean(cancel) && (Boolean(dictationStatus) || showCompactPill);
  const footprint = showCancel
    ? {
        width: baseFootprint.width + VOICE_PILL_CANCEL.size + VOICE_PILL_CANCEL.gap,
        height: baseFootprint.height,
      }
    : baseFootprint;
  // The dictation pill appears at its final size and keeps it, so it skips
  // the width/height morph.
  const sizeTransition = dictationStatus
    ? ""
    : `width ${VOICE_PILL_GROW_TRANSITION}, height ${VOICE_PILL_GROW_TRANSITION}, padding-left ${VOICE_PILL_GROW_TRANSITION}, padding-right ${VOICE_PILL_GROW_TRANSITION}, `;

  const pill = (
    <div
      ref={ref}
      className={cn(
        "voice-pill-control relative flex items-center overflow-hidden rounded-full border",
        dictationStatus ? "gap-1.5 pl-2 pr-2.5" : "justify-center",
        !dictationStatus && showCompactPill && "pr-1.5",
        "shadow-[var(--shadow-card)]",
        STATE_APPEARANCE[state],
        className
      )}
      style={{
        // Listening uses the same compact pill as the assistant panel. The
        // previous wide recording bar made the control feel like a different
        // surface and forced an unnecessary large window resize.
        width: footprint.width,
        height: footprint.height,
        cursor: isProcessing || isThinking ? "not-allowed" : isDragging ? "grabbing" : "pointer",
        boxShadow: floatingHover ? "var(--shadow-card-hover-subtle)" : undefined,
        transition: `${sizeTransition}background-color 220ms ease-out, border-color 220ms ease-out, box-shadow 220ms ease-out`,
        ...style,
      }}
      data-horizontal-direction={horizontalDirection}
      data-integrated-with-panel={integratedWithPanel || undefined}
      data-agent-mode={agentMode || undefined}
      data-agent-beam-active={(agentMode && isThinking) || undefined}
      data-expand-chevron={showExpandChevron || undefined}
      data-hands-free={handsFree || undefined}
      {...props}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-foreground/10 to-transparent transition-opacity duration-200 ease-out"
        style={{ opacity: state === "hover" ? 0.72 : 0 }}
      />

      {dictationStatus ? (
        <>
          {dictationStatus.provider === "openai" ? (
            <OpenAIIcon className="relative size-3.5 shrink-0" />
          ) : (
            <MistralIcon className="relative size-3.5 shrink-0" />
          )}
          <span
            className={cn(
              "relative min-w-0 truncate text-[10.5px] leading-none",
              dictationStatus.phase === "processing" && "inline-response-shimmer"
            )}
          >
            <span className="font-semibold">{dictationStatus.model}</span>{" "}
            <span className="text-muted-foreground">{dictationStatus.activity}</span>
          </span>
          {dictationStatus.phase === "listening" ? (
            <PillWaveform
              getLevel={getAudioLevel}
              active={isRecording}
              barCount={DICTATION_LISTENING_BAR_COUNT}
              maxBarPx={DICTATION_WAVE_MAX_PX}
              className="relative h-4 min-w-0 flex-1 gap-0.5"
            />
          ) : (
            // A soft ripple says the model is working. It takes the waveform's
            // stretchy, centered spot, so the label can change (Voxtral, then
            // Luna) without leaving a gap.
            <span
              className="relative flex h-4 min-w-0 flex-1 items-center justify-center gap-0.5 overflow-hidden"
              aria-hidden="true"
            >
              {Array.from({ length: DICTATION_RIPPLE_BAR_COUNT }, (_, index) => (
                <span
                  key={index}
                  className="dictation-pill-ripple-bar h-2.5 w-0.5 rounded-full bg-current"
                  style={{ animationDelay: `${index * 90}ms` }}
                />
              ))}
            </span>
          )}
        </>
      ) : (
        <>
          <span
            className="voice-pill-identity-slot relative inline-block shrink-0 transition-[width,height] duration-200"
            style={{ width: identitySize, height: identitySize }}
            aria-hidden="true"
          >
            <span
              className={cn(
                "voice-pill-identity-logo absolute inset-0 transition-[opacity,transform] duration-200 ease-out",
                showExpandChevron ? "translate-y-1 scale-75 opacity-0" : "scale-100 opacity-100"
              )}
            >
              <VoiceIdentityIcon
                size={identitySize}
                agentMode={agentMode}
                className={cn(
                  "transition-[width,height] duration-200",
                  state === "idle" && "text-foreground",
                  (isUnavailable || isProcessing) && "animate-pulse"
                )}
              />
            </span>
            <ChevronUp
              className={cn(
                "voice-pill-expand-chevron absolute inset-0 m-auto size-5 transition-[opacity,transform] duration-200 ease-out",
                showExpandChevron ? "scale-100 opacity-100" : "translate-y-1 scale-75 opacity-0"
              )}
              strokeWidth={2}
            />
          </span>

          <div
            className="shrink-0 overflow-hidden bg-border/60"
            style={{
              height: showCompactPill ? 16 : 20,
              width: showDivider ? 1 : 0,
              marginLeft: dividerMargin,
              marginRight: dividerMargin,
              opacity: showDivider ? 1 : 0,
              transition: `width ${VOICE_PILL_GROW_TRANSITION}, margin ${VOICE_PILL_GROW_TRANSITION}, opacity 180ms ease-out`,
            }}
          />

          <div
            className="voice-pill-waveform relative shrink-0 overflow-hidden text-foreground"
            style={{
              width: showCompactPill ? 52 : 0,
              height: showCompactPill ? 24 : 32,
              transition: `width ${VOICE_PILL_GROW_TRANSITION}, height ${VOICE_PILL_GROW_TRANSITION}`,
            }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center gap-0.75 transition-opacity duration-200 ease-out"
              style={{ opacity: showCompactPill && waveformVisible && !isRecording ? 1 : 0 }}
              aria-hidden="true"
            >
              {RESTING_WAVE_HEIGHTS.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  className="w-0.5 rounded-full bg-current"
                  style={{ height }}
                />
              ))}
            </div>
            <PillWaveform
              getLevel={getAudioLevel}
              active={isRecording}
              className={cn(
                "absolute inset-0 transition-opacity duration-200 ease-out",
                showCompactPill && waveformVisible && isRecording ? "opacity-100" : "opacity-0"
              )}
            />
          </div>
        </>
      )}

      {showCancel && cancel && (
        // Stop every event so the pill's own toggle, drag and key handlers
        // do not also fire.
        <button
          type="button"
          aria-label={cancel.label}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancel.onCancel();
          }}
          className="relative flex shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          style={{
            width: VOICE_PILL_CANCEL.size,
            height: VOICE_PILL_CANCEL.size,
            // The dictation pill's flex gap already spaces it.
            marginLeft: dictationStatus ? 0 : VOICE_PILL_CANCEL.gap,
          }}
        >
          <X size={11} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}

      {isUnavailable && (
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-foreground/30 animate-pulse" />
      )}
    </div>
  );

  return (
    <span className="voice-pill-glow-anchor">
      <span
        aria-hidden="true"
        className="processing-signal-glow"
        data-active={showSignalGlow ? "true" : undefined}
        data-agent={agentMode || undefined}
      >
        <span className="processing-signal-ring" />
      </span>
      {pill}
    </span>
  );
});
