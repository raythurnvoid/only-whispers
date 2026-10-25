export function buildLiveTranscriptionPreview(committedText = "", partialText = ""): string {
  return [committedText.trim(), partialText.trim()].filter(Boolean).join(" ");
}

/**
 * Assistant-routed recordings stream their answer into the assistant panel;
 * the floating dictation preview must never appear for them.
 */
export function shouldDisplayDictationPreview(
  enabled: boolean,
  voiceAgentRequested: boolean
): boolean {
  return !!enabled && !voiceAgentRequested;
}
