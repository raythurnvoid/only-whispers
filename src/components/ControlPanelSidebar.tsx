import React from "react";
import { Settings } from "./icons";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import { useControlPanelNavItems, type ControlPanelView } from "./controlPanelNav";
import LaurelLogo from "./LaurelLogo";
import { getCachedPlatform } from "../utils/platform";

export type { ControlPanelView };

const platform = getCachedPlatform();

// Colors and the active state come from .pz-nav-item (styles/palazzo.css).
const rowButtonClass =
  "pz-nav-item flex items-center gap-2.5 w-full h-[34px] px-2.5 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors duration-150";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const navItems = useControlPanelNavItems();

  return (
    <div className="pz-window relative w-56 h-full shrink-0 flex flex-col ps-2 pe-9 pb-3">
      {/* Drag area; on macOS it also clears the traffic lights. */}
      <div
        className={cn("w-full shrink-0", platform === "darwin" ? "h-10" : "h-3")}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <div style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <LaurelLogo />
      </div>

      {/* Ionic column on the sidebar's end edge. */}
      <div className="pz-column" aria-hidden="true">
        <div className="pz-ornament pz-column-capital" />
        <div className="pz-ornament pz-column-shaft" />
        <div className="pz-ornament pz-column-base" />
      </div>

      <nav className="flex flex-col gap-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              data-active={activeView === item.id}
              className={rowButtonClass}
            >
              <Icon size={16} className="shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <button
        onClick={onOpenSettings}
        aria-label={t("sidebar.settings")}
        className={rowButtonClass}
      >
        <Settings size={16} className="shrink-0" />
        <span>{t("sidebar.settings")}</span>
      </button>
    </div>
  );
}
