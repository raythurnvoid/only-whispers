import React from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose } from "./icons";
import { BrandMarkIcon } from "./dictation/BrandMarkIcon";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

// Keep the native window buttons clear, including the traffic lights on macOS.
const titleBarStyle = {
  WebkitAppRegion: "drag",
  paddingLeft: platform === "darwin" ? "88px" : "calc(env(titlebar-area-x, 0px) + 0.75rem)",
  paddingRight:
    "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.75rem)",
} as React.CSSProperties;

// Controls inside the drag region must opt out or the click starts a window drag.
const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const toggleIconClass =
  "text-foreground/60 group-hover:text-foreground/75 dark:text-foreground/50 dark:group-hover:text-foreground/65 transition-colors duration-150 rtl:scale-x-[-1]";

interface ControlPanelTopBarProps {
  title: string;
  sidebarCollapsed: boolean;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onToggleMouseEnter?: () => void;
  onToggleMouseLeave?: () => void;
}

export default function ControlPanelTopBar({
  title,
  sidebarCollapsed,
  sidebarVisible,
  onToggleSidebar,
  onToggleMouseEnter,
  onToggleMouseLeave,
}: ControlPanelTopBarProps) {
  const { t } = useTranslation();

  return (
    <>
      <header className="flex h-10 shrink-0 items-center" style={titleBarStyle}>
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleSidebar}
            onMouseEnter={onToggleMouseEnter}
            onMouseLeave={onToggleMouseLeave}
            aria-label={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            aria-controls="control-panel-sidebar"
            aria-expanded={sidebarVisible}
            data-no-window-drag=""
            style={noDragStyle}
            className="group flex h-8 w-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors duration-150 hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-primary/30 dark:hover:bg-white/5"
          >
            <PanelLeftClose size={16} className={toggleIconClass} />
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <BrandMarkIcon size={28} />
            <span className="pz-display whitespace-nowrap text-sm font-semibold tracking-[0.1em] uppercase">
              Only Whispers
            </span>
          </div>
          {/* Global h1 styles are display-sized; this is chrome, so pin it down. */}
          <h1 className="truncate border-s border-border ps-2.5 text-sm! font-medium! leading-none! tracking-[0.12em]! uppercase text-foreground">
            {title}
          </h1>
        </div>
      </header>
      {/* Egg-and-dart moulding: the titlebar's bottom edge (styles/palazzo.css). */}
      <div className="pz-ornament pz-moulding" aria-hidden="true" />
    </>
  );
}
