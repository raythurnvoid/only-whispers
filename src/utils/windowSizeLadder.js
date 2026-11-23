// Single owner of the pill window's size priority: panel > toast > compact
// listening pill > base. The assistant panel must never be collapsed by a toast
// dismissing underneath it — higher states always win.
export const SIZE_RANK = {
  BASE: 0,
  RECORDING: 1,
  DICTATION_ERROR: 2,
  DICTATION_ERROR_WITH_TRANSCRIPT: 3,
  WITH_TOAST: 4,
  ASSISTANT: 5,
};

export function resolveMainWindowSizeKey({
  panelOpen,
  toastCount,
  compactPill,
  dictationErrorActionCount = 0,
}) {
  if (panelOpen) return "ASSISTANT";
  if (dictationErrorActionCount > 1) return "DICTATION_ERROR_WITH_TRANSCRIPT";
  if (dictationErrorActionCount === 1) return "DICTATION_ERROR";
  if (toastCount > 0) return "WITH_TOAST";
  if (compactPill) return "RECORDING";
  return "BASE";
}
