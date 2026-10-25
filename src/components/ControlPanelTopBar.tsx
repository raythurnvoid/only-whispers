import React from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose } from "./icons";
import WindowControls from "./WindowControls";
import { cn } from "./lib/utils";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

// Controls inside the drag region must opt out or the click starts a window drag.
const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const toggleIconClass =
  "text-foreground/60 group-hover:text-foreground/75 dark:text-foreground/50 dark:group-hover:text-foreground/65 transition-colors duration-150 rtl:scale-x-[-1]";

interface ControlPanelTopBarProps {
  title: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleMouseEnter?: () => void;
  onToggleMouseLeave?: () => void;
}

export default function ControlPanelTopBar({
  title,
  sidebarCollapsed,
  onToggleSidebar,
  onToggleMouseEnter,
  onToggleMouseLeave,
}: ControlPanelTopBarProps) {
  const { t } = useTranslation();
  // With the sidebar out of the way the container's start edge sits under the
  // macOS traffic lights, so the leading controls shift past them.
  const clearTrafficLights = platform === "darwin" && sidebarCollapsed;

  return (
    <>
      <header
        className={cn(
          "flex h-10 shrink-0 items-center gap-4 px-3",
          // Eased with the sidebar spacer so the toggle glides instead of jumping when the
          // clearance switches; a jump would drag it back under the cursor and re-trigger peek.
          "transition-[padding] duration-300 ease-out",
          clearTrafficLights && "ltr:ps-[76px]"
        )}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleSidebar}
            onMouseEnter={onToggleMouseEnter}
            onMouseLeave={onToggleMouseLeave}
            aria-label={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            data-no-window-drag=""
            style={noDragStyle}
            // z-40 keeps the toggle above the peeking sidebar (z-30) so the panel slides in
            // underneath it and the button stays clickable while collapsed.
            className="group relative z-40 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors duration-150 hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-primary/30 dark:hover:bg-white/5"
          >
            <PanelLeftClose size={16} className={toggleIconClass} />
          </button>
          {/* Global h1 styles are display-sized; this is chrome, so pin it down. */}
          <h1 className="truncate text-sm! font-medium! leading-none! tracking-[0.12em]! uppercase text-foreground">
            {title}
          </h1>
        </div>

        {platform !== "darwin" && (
          <div data-no-window-drag="" style={noDragStyle} className="ms-auto">
            <WindowControls />
          </div>
        )}
      </header>
      {/* Egg-and-dart moulding: the titlebar's bottom edge (styles/palazzo.css). */}
      <div className="pz-ornament pz-moulding" aria-hidden="true" />
    </>
  );
}
