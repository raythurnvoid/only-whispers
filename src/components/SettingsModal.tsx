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

const LEGACY_SUB_TAB: Record<string, string> = {
  dictationAgent: "dictationAgent",
  intelligence: "dictationCleanup",
  agentMode: "chatIntelligence",
  agentConfig: "chatIntelligence",
  aiModels: "dictationCleanup",
  prompts: "dictationCleanup",
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
      {
        id: "general",
        label: t("settingsModal.sections.general.label"),
        icon: Sliders,
        description: t("settingsModal.sections.general.description"),
        group: t("settingsModal.groups.app"),
      },
      {
        id: "hotkeys",
        label: t("settingsModal.sections.hotkeys.label"),
        icon: Keyboard,
        description: t("settingsModal.sections.hotkeys.description"),
        group: t("settingsModal.groups.app"),
      },
      {
        id: "llms",
        label: t("settingsModal.sections.aiModels.label"),
        icon: Brain,
        description: t("settingsModal.sections.aiModels.description"),
        group: t("settingsModal.groups.app"),
      },
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
  const [initialSubTab, setInitialSubTab] = useState<string | undefined>(() =>
    initialSection ? LEGACY_SUB_TAB[initialSection] : undefined
  );
  const [prevOpen, setPrevOpen] = useState(open);

  if (open && !prevOpen && initialSection) {
    setPrevOpen(open);
    setActiveSection(resolveSection(initialSection));
    setInitialSubTab(LEGACY_SUB_TAB[initialSection]);
  } else if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setInitialSubTab(undefined);
  }

  const handleSectionChange = (section: SettingsSectionType, subTab?: string) => {
    setActiveSection(section);
    setInitialSubTab(subTab);
  };

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title={t("settingsModal.title")}
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
    >
      <SettingsPage
        activeSection={activeSection}
        onNavigateToSection={handleSectionChange}
        initialSubTab={initialSubTab}
      />
    </SidebarModal>
  );
}
