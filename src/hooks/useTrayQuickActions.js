import { useEffect } from "react";
import { resolveTrayAssistantAction } from "../helpers/trayActionPolicy";

/**
 * The tray's Ask assistant, answered by the one renderer that can open the panel.
 *
 * The tray always shows the item, so this either opens the panel or explains
 * itself through `refuse`. The tray's listen entry needs no renderer: it goes
 * straight to the dictation start.
 */
export function useTrayQuickActions({
  isRecording,
  liveTranscriptMounted,
  openAssistantPanel,
  refuse,
}) {
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpenAssistantPanel?.(() => {
      const decision = resolveTrayAssistantAction({ isRecording, liveTranscriptMounted });
      if (decision.action === "refuse") {
        refuse(decision.messageKey);
        return;
      }
      void openAssistantPanel();
    });
    return () => unsubscribe?.();
  }, [isRecording, liveTranscriptMounted, openAssistantPanel, refuse]);
}
