import { useEffect, useRef } from "react";
import type { TFunction } from "i18next";
import { ToastActionButton } from "../components/ui/Toast";
import type { ToastContextType } from "../components/ui/useToast";
import { providerErrorActions } from "../utils/describeProviderError";

/**
 * Surfaces main-process notifications (hotkey fallback/failure, learned
 * dictionary corrections, a ChatGPT sign-in that stopped working) as toasts in
 * the dictation window.
 */
export function useMainProcessNotifications({
  toast,
  dismiss,
  t,
}: {
  toast: ToastContextType["toast"];
  dismiss: ToastContextType["dismiss"];
  t: TFunction;
}): void {
  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyChanged.title"),
        description: t("app.toasts.hotkeyChanged.description", {
          original: data.original,
          fallback: data.fallback,
        }),
        duration: 8000,
      });
    });

    // Main's translated reason names the hotkey, which matters when several slots
    // restore at startup.
    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyUnavailable.title"),
        description: data?.error || t("app.toasts.hotkeyUnavailable.description"),
        duration: 10000,
      });
    });

    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.(
      ({ words, pasteId }) => {
        if (words && words.length > 0) {
          const wordList = words.map((w) => `“${w}”`).join(", ");
          let toastId: string;
          toastId = toast({
            title: t("app.toasts.addedToDict", { words: wordList }),
            variant: "success",
            duration: 6000,
            onClose: () => window.electronAPI?.dictionaryToastEnded?.(pasteId, words, "closed"),
            onTimeout: () =>
              window.electronAPI?.dictionaryToastEnded?.(pasteId, words, "timed-out"),
            action: (
              <ToastActionButton
                onClick={async () => {
                  try {
                    const result = await window.electronAPI?.undoLearnedCorrections?.(
                      words,
                      pasteId
                    );
                    if (result?.success) {
                      dismiss(toastId);
                    }
                  } catch {
                    // silently fail — word stays in dictionary
                  }
                }}
              >
                {t("app.toasts.undo")}
              </ToastActionButton>
            ),
          });
        }
      }
    );

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeCorrections?.();
    };
  }, [toast, dismiss, t]);

  // OpenAI refused to renew the ChatGPT sign-in, so cleanup is off and every
  // dictation is pasted raw. The dictation window shows no error cards, so this
  // is a plain card that stays until the user closes it. One card at a time.
  const signInToastId = useRef<string | null>(null);
  useEffect(() => {
    const showSignInExpired = () => {
      if (signInToastId.current) return;
      signInToastId.current = toast({
        title: t("app.toasts.chatgptSignInExpired.title"),
        description: t("app.toasts.chatgptSignInExpired.description"),
        duration: 0,
        actions: providerErrorActions({ settingsTarget: "llms" }, t),
        onClose: () => {
          signInToastId.current = null;
        },
      });
    };
    // Also at launch, when the sign-in broke while the app was closed.
    window.electronAPI
      ?.chatgptStatus?.()
      .then((status) => {
        if (status?.expired) showSignInExpired();
      })
      .catch(() => {});
    return window.electronAPI?.onChatGPTSignInExpired?.(showSignInExpired);
  }, [toast, t]);
}
