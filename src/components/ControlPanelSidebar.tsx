import { useEffect, useState } from "react";
import { Settings } from "./icons";
import { useTranslation } from "react-i18next";
import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";

export type { ControlPanelView };

// Colors and the active state come from .pz-nav-item (styles/palazzo.css).
const rowButtonClass =
  "pz-nav-item flex items-center gap-2.5 w-full h-[34px] px-2.5 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors duration-150";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: (section?: string) => void;
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const navItems = useControlPanelNavItems();
  // OpenAI ended the ChatGPT sign-in: cleanup is off until the user signs in again.
  const [chatgptExpired, setChatgptExpired] = useState(false);

  useEffect(() => {
    window.electronAPI?.chatgptStatus?.().then((status) => setChatgptExpired(!!status?.expired));
    return window.electronAPI?.onChatGPTStatusChanged?.((status) =>
      setChatgptExpired(!!status.expired)
    );
  }, []);

  return (
    <aside className="pz-window relative flex h-full w-56 flex-col ps-2 pe-9 py-3">
      {/* Ionic column on the sidebar's end edge. */}
      <div className="pz-column" aria-hidden="true">
        <div className="pz-ornament pz-column-capital" />
        <div className="pz-ornament pz-column-shaft" />
        <div className="pz-ornament pz-column-base" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                data-active={activeView === item.id}
                aria-current={activeView === item.id ? "page" : undefined}
                className={rowButtonClass}
              >
                <Icon size={16} className="shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {chatgptExpired && (
          <div className="mt-2 rounded-md border border-border bg-surface-1/60 px-2.5 py-2 text-xs">
            <p className="text-foreground">{t("app.toasts.chatgptSignInExpired.title")}</p>
            <button
              onClick={() => onOpenSettings("llms")}
              className="mt-1 text-link hover:opacity-80"
            >
              {t("providerErrors.openSettings")}
            </button>
          </div>
        )}
      </div>
      <footer className="mx-1 shrink-0 border-t border-border pt-2">
        <button
          onClick={() => onOpenSettings()}
          aria-label={t("sidebar.settings")}
          className={rowButtonClass}
        >
          <Settings size={16} className="shrink-0" />
          <span>{t("sidebar.settings")}</span>
        </button>
      </footer>
    </aside>
  );
}
