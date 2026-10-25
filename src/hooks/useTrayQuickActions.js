import { useEffect } from "react";
import { resolveTrayAssistantAction } from "../helpers/trayActionPolicy";

/**
 * The tray's Ask assistant, answered by the one renderer that can open the panel.
 *
 * The pill's command menu hides the item while a recording is live; the tray
 * always shows it, so this either opens the panel or explains itself through
 * `refuse`. The tray's listen entry needs no renderer: it goes straight to the
 * dictation start.
 */
export function useTrayQuickActions({
  isRecording,
  liveTranscriptMounted,
  closeCommandMenu,
  openAssistantPanel,
  refuse,
}) {
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpenAssistantPanel?.(() => {
      closeCommandMenu();
      const decision = resolveTrayAssistantAction({ isRecording, liveTranscriptMounted });
      if (decision.action === "refuse") {
        refuse(decision.messageKey);
        return;
      }
      void openAssistantPanel();
    });
    return () => unsubscribe?.();
  }, [isRecording, liveTranscriptMounted, closeCommandMenu, openAssistantPanel, refuse]);
}
