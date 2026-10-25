import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sliders, Brain, Keyboard } from "./icons";
import SidebarModal, { type SidebarItem } from "./ui/SidebarModal";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";

export type { SettingsSectionType };

// Older section IDs still arrive from deep links (toasts, banners); each one
// opens the section that now holds its settings.
const SECTION_ALIASES: Record<string, SettingsSectionType> = {
  aiModels: "llms",
  agentConfig: "llms",
  agentMode: "llms",
  dictationAgent: "llms",
  intelligence: "llms",
  prompts: "llms",
  speechToText: "llms",
  transcription: "llms",
};

const SECTION_IDS: SettingsSectionType[] = ["general", "hotkeys", "llms"];

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
}

export default function SettingsModal({ open, onOpenChange, initialSection }: SettingsModalProps) {
  const { t } = useTranslation();
  const sidebarItems: SidebarItem<SettingsSectionType>[] = useMemo(
    () => [
      { id: "general", label: t("settingsModal.sections.general.label"), icon: Sliders },
      { id: "hotkeys", label: t("settingsModal.sections.hotkeys.label"), icon: Keyboard },
      { id: "llms", label: t("settingsModal.sections.aiModels.label"), icon: Brain },
    ],
    [t]
  );

  // Removed sections (account, privacy, system, ...) fall back to General.
  const resolveSection = (section: string | undefined): SettingsSectionType => {
    const resolved = section ? (SECTION_ALIASES[section] ?? section) : "general";
    return SECTION_IDS.includes(resolved as SettingsSectionType)
      ? (resolved as SettingsSectionType)
      : "general";
  };

  const [activeSection, setActiveSection] = React.useState<SettingsSectionType>(() =>
    resolveSection(initialSection)
  );
  const [prevOpen, setPrevOpen] = useState(open);

  if (open && !prevOpen && initialSection) {
    setPrevOpen(open);
    setActiveSection(resolveSection(initialSection));
  } else if (open !== prevOpen) {
    setPrevOpen(open);
  }

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title={t("settingsModal.title")}
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
    >
      <SettingsPage activeSection={activeSection} />
    </SidebarModal>
  );
}
