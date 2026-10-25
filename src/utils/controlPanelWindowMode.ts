export type ControlPanelWindowMode = "compact" | "restore";

export interface SettledControlPanelWindowState {
  isControlPanel: boolean;
  isLoading: boolean;
  showOnboarding: boolean;
  microphoneReady: boolean;
}

export function resolveSettledControlPanelWindowMode(
  state: SettledControlPanelWindowState
): ControlPanelWindowMode | null {
  // Setup and the microphone screen pick their own size.
  if (!state.isControlPanel || state.isLoading || state.showOnboarding) return null;
  if (!state.microphoneReady) return null;

  return "restore";
}
