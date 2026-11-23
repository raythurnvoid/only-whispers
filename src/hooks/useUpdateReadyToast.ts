import { useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import type { ToastContextType } from "../components/ui/useToast";

/**
 * A downloaded update installs on quit anyway; this toast lets the user restart now.
 * One toast at a time: a newer release replaces the card and names its version
 * (the install button always installs the newest download).
 */
export function useUpdateReadyToast({
  toast,
  dismiss,
  t,
}: {
  toast: ToastContextType["toast"];
  dismiss: ToastContextType["dismiss"];
  t: TFunction;
}): void {
  const updateToastId = useRef<string | null>(null);
  useEffect(() => {
    const showUpdateReady = (version?: string | null) => {
      if (updateToastId.current) dismiss(updateToastId.current);
      updateToastId.current = toast({
        title: version
          ? t("controlPanel.update.readyTitleVersion", { version })
          : t("controlPanel.update.readyTitle"),
        description: t("controlPanel.update.readyDescription"),
        duration: 0,
        onClose: () => {
          updateToastId.current = null;
        },
        actions: [
          {
            label: t("controlPanel.update.installButton"),
            onClick: () => {
              window.electronAPI?.installUpdate?.();
            },
          },
        ],
      });
    };
    window.electronAPI?.getDownloadedUpdate?.().then((version) => {
      if (version) showUpdateReady(version);
    });
    const cleanup = window.electronAPI?.onUpdateDownloaded?.((payload) =>
      showUpdateReady(payload?.version)
    );
    return () => cleanup?.();
  }, [toast, dismiss, t]);
}
