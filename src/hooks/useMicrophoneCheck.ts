import { useState, useCallback, useEffect } from "react";

/**
 * Whether the app can use a microphone, and if not, what the user must do:
 * allow it (macOS asks once), turn it on in the OS settings, restart the app
 * (macOS, after allowing it in System Settings), or plug one in.
 */
export type MicrophoneState = "checking" | "ready" | "ask" | "denied" | "restart" | "missing";

// Reads the OS permission and the device list. It never opens the mic, so the
// OS "mic in use" light doesn't flash at every start.
export async function checkMicrophone(): Promise<Exclude<MicrophoneState, "checking">> {
  try {
    const access = await window.electronAPI?.checkMicrophoneAccess?.();
    if (access?.needsRelaunch) return "restart";
    if (access && !access.granted) return access.status === "not-determined" ? "ask" : "denied";
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((device) => device.kind === "audioinput") ? "ready" : "missing";
  } catch {
    // A check that can't run must not lock the user out; a dictation that
    // then fails on the mic opens the microphone screen anyway.
    return "ready";
  }
}

export interface MicrophoneCheck {
  state: MicrophoneState;
  recheck: () => Promise<void>;
}

export function useMicrophoneCheck(enabled: boolean): MicrophoneCheck {
  const [state, setState] = useState<MicrophoneState>("checking");

  const recheck = useCallback(() => checkMicrophone().then(setState), []);

  // The fix happens outside the app (OS settings, plugging a mic in), so check
  // again when the user comes back and when the devices change.
  useEffect(() => {
    if (!enabled) return;
    recheck();
    window.addEventListener("focus", recheck);
    navigator.mediaDevices?.addEventListener("devicechange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      navigator.mediaDevices?.removeEventListener("devicechange", recheck);
    };
  }, [enabled, recheck]);

  // Poll while the mic can't be used, so the screen goes away on its own.
  const blocked = state !== "ready" && state !== "checking";
  useEffect(() => {
    if (!enabled || !blocked) return;
    const interval = setInterval(recheck, 2000);
    return () => clearInterval(interval);
  }, [enabled, blocked, recheck]);

  return { state, recheck };
}
