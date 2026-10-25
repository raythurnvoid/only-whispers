import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

/** Sign in with ChatGPT, so OpenAI cleanup runs on the user's ChatGPT plan. */
export default function ChatGPTSignIn({
  onStatusChange,
}: {
  onStatusChange?: (signedIn: boolean) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState({ signedIn: false, email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    window.electronAPI.chatgptStatus().then(setStatus);
  }, []);

  useEffect(() => {
    onStatusChange?.(status.signedIn);
  }, [onStatusChange, status.signedIn]);

  const signIn = async () => {
    setBusy(true);
    setError("");
    const result = await window.electronAPI.chatgptSignIn();
    setBusy(false);
    if ("error" in result) setError(result.error);
    else setStatus(result);
  };

  const signOut = async () => {
    await window.electronAPI.chatgptSignOut();
    setStatus({ signedIn: false, email: "" });
  };

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-foreground">{t("reasoning.chatgpt.title")}</h4>
      {status.signedIn ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-foreground">
            {t("reasoning.chatgpt.signedInAs", { email: status.email })}
          </p>
          <Button variant="outline" size="sm" onClick={signOut}>
            {t("reasoning.chatgpt.signOut")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={signIn} disabled={busy}>
          {busy ? t("reasoning.chatgpt.signingIn") : t("reasoning.chatgpt.signIn")}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
