import { useEffect } from "react";

/**
 * Turns on the Palazzo look (styles/palazzo.css) while the calling window's
 * root is mounted. It sits on <html>, so dialogs, menus and toasts portalled
 * into body get it too.
 */
export function usePalazzoTheme() {
  useEffect(() => {
    document.documentElement.classList.add("palazzo");
    return () => document.documentElement.classList.remove("palazzo");
  }, []);
}
