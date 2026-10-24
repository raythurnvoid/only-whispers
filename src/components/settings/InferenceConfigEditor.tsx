import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { Key, Cpu, Network, Building2 } from "../icons";
import {
  useSettingsStore,
  selectResolvedLLMConfig,
  setResolvedLLMConfig,
  type ResolvedLLMConfig,
} from "../../stores/settingsStore";
import { isProductMode } from "../../config/productChoices";
import { InferenceModeSelector } from "../ui/SettingsSection";
import type { InferenceModeOption } from "../ui/SettingsSection";
import ReasoningModelSelector from "../ReasoningModelSelector";
import EnterpriseSection from "../EnterpriseSection";
import OpenAICompatiblePanel from "../OpenAICompatiblePanel";
import { Toggle } from "../ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { InferenceMode } from "../../types/electron";
import {
  INFERENCE_SCOPES,
  type InferenceScope,
  type InferenceScopeDefinition,
} from "../../config/inferenceScopes";
import { AUTO_REASONING_EFFORT, isReasoningEffortSupported } from "../../models/reasoningEffort";
import { selectableReasoningEffort } from "../../services/ai/chatRequestBody";
import { offersThinkingToggle } from "../../services/ai/thinkingSuppression";
import { modeSwitchPatch } from "../../utils/llmModeSwitch";

// Radix Select can't hold an empty value, so Auto ("") gets a sentinel.
const AUTO_REASONING_EFFORT_VALUE = "__auto__";

interface InferenceConfigEditorProps {
  scope: InferenceScope;
  onModeChange?: (mode: InferenceMode) => void;
  /** Restrict the selectable modes (e.g. vision override offers cloud/BYOK only). */
  allowedModes?: InferenceMode[];
}

export default function InferenceConfigEditor({
  scope,
  onModeChange,
  allowedModes,
}: InferenceConfigEditorProps) {
  const { t } = useTranslation();
  const config = useSettingsStore(
    useShallow((settings): ResolvedLLMConfig => {
      const resolved = selectResolvedLLMConfig(settings, scope);
      const definition: InferenceScopeDefinition = INFERENCE_SCOPES[scope];
      // Inherited runtime defaults are not an explicit selection in an optional picker.
      return definition.optional
        ? { ...resolved, model: settings[definition.storeKeys.model] as string }
        : resolved;
    })
  );
  const keepLocalModelLoaded = useSettingsStore((s) => s.keepLocalModelLoaded);
  const setKeepLocalModelLoaded = useSettingsStore((s) => s.setKeepLocalModelLoaded);
  const effectiveMode = config.mode;
  const modes = (
    [
      {
        id: "providers",
        label: t("settingsPage.aiModels.modes.providers"),
        description: t("settingsPage.aiModels.modes.providersDesc"),
        icon: <Key className="w-4 h-4" />,
      },
      {
        id: "local",
        label: t("settingsPage.aiModels.modes.local"),
        description: t("settingsPage.aiModels.modes.localDesc"),
        icon: <Cpu className="w-4 h-4" />,
      },
      {
        id: "self-hosted",
        label: t("settingsPage.aiModels.modes.selfHosted"),
        description: t("settingsPage.aiModels.modes.selfHostedDesc"),
        icon: <Network className="w-4 h-4" />,
      },
      {
        id: "enterprise",
        label: t("settingsPage.aiModels.modes.enterprise"),
        description: t("settingsPage.aiModels.modes.enterpriseDesc"),
        icon: <Building2 className="w-4 h-4" />,
      },
    ] as InferenceModeOption[]
  ).filter((mode) => isProductMode(mode.id) && (!allowedModes || allowedModes.includes(mode.id)));

  const setField = useCallback(
    <K extends keyof Omit<typeof config, "scope">>(field: K) =>
      (value: NonNullable<(typeof config)[K]>) => {
        setResolvedLLMConfig(scope, { [field]: value });
      },
    [scope]
  );

  const handleModeSelect = useCallback(
    (mode: InferenceMode) => {
      if (mode === effectiveMode) return;

      setResolvedLLMConfig(
        scope,
        modeSwitchPatch({ provider: config.provider, model: config.model }, mode)
      );
      onModeChange?.(mode);
    },
    [scope, config.provider, config.model, effectiveMode, onModeChange]
  );

  const setMode = setField("mode");
  const setProvider = setField("provider");
  const setModel = setField("model");

  const renderModelSelector = (mode?: "cloud" | "local") => (
    <ReasoningModelSelector
      reasoningModel={config.model}
      setReasoningModel={setModel}
      localReasoningProvider={config.provider}
      setLocalReasoningProvider={setProvider}
      cloudReasoningBaseUrl={config.cloudBaseUrl ?? ""}
      setCloudReasoningBaseUrl={setField("cloudBaseUrl")}
      customReasoningApiKey={config.customApiKey ?? ""}
      setCustomReasoningApiKey={setField("customApiKey")}
      setReasoningMode={setMode}
      mode={mode}
    />
  );

  const showThinkingToggle = offersThinkingToggle(effectiveMode, config.provider, config.model);

  const effortCapability =
    effectiveMode === "providers"
      ? selectableReasoningEffort(config.provider, config.model, config, config.cloudBaseUrl)
      : null;

  return (
    <div className="space-y-3">
      {modes.length > 1 && (
        <InferenceModeSelector
          modes={modes}
          activeMode={effectiveMode}
          onSelect={handleModeSelect}
        />
      )}

      {effectiveMode === "providers" && renderModelSelector("cloud")}
      {effectiveMode === "local" && renderModelSelector("local")}

      {effectiveMode === "self-hosted" && (
        <OpenAICompatiblePanel
          baseUrl={config.remoteUrl ?? ""}
          setBaseUrl={setField("remoteUrl")}
          apiKey={config.customApiKey ?? ""}
          setApiKey={setField("customApiKey")}
          model={config.model}
          setModel={setModel}
          baseUrlPlaceholder="http://192.168.1.126:11434/v1"
          helpExamples={
            <p className="text-xs text-muted-foreground">
              {t("reasoning.selfHosted.endpointHelp")}
            </p>
          }
        />
      )}

      {showThinkingToggle && (
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-foreground">
              {t("reasoning.disableThinking.label")}
            </h4>
            <p className="text-xs text-muted-foreground">{t("reasoning.disableThinking.help")}</p>
          </div>
          <Toggle checked={config.disableThinking} onChange={setField("disableThinking")} />
        </div>
      )}

      {effortCapability && (
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-foreground">{t("reasoning.effort.title")}</h4>
            <p className="text-xs text-muted-foreground">
              {effortCapability.defaultValue
                ? t("reasoning.effort.descriptionWithDefault", {
                    value: t(`reasoning.effort.options.${effortCapability.defaultValue}`),
                  })
                : t("reasoning.effort.description")}
            </p>
          </div>
          <Select
            value={
              isReasoningEffortSupported(effortCapability, config.reasoningEffort)
                ? config.reasoningEffort
                : AUTO_REASONING_EFFORT_VALUE
            }
            onValueChange={(value) =>
              setField("reasoningEffort")(
                value === AUTO_REASONING_EFFORT_VALUE ? AUTO_REASONING_EFFORT : value
              )
            }
          >
            <SelectTrigger className="h-7 w-44 shrink-0 text-xs rounded-lg px-2.5 [&>svg]:h-3 [&>svg]:w-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value={AUTO_REASONING_EFFORT_VALUE}
                className="text-xs py-1.5 ps-2.5 pe-7 rounded-md"
              >
                {t("reasoning.effort.auto")}
              </SelectItem>
              {effortCapability.options.map((effort) => (
                <SelectItem
                  key={effort}
                  value={effort}
                  className="text-xs py-1.5 ps-2.5 pe-7 rounded-md"
                >
                  {t(`reasoning.effort.options.${effort}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {effectiveMode === "local" && (
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-foreground">
              {t("reasoning.keepModelLoaded.label")}
            </h4>
            <p className="text-xs text-muted-foreground">{t("reasoning.keepModelLoaded.help")}</p>
          </div>
          <Toggle checked={keepLocalModelLoaded} onChange={setKeepLocalModelLoaded} />
        </div>
      )}

      {effectiveMode === "enterprise" && (
        <EnterpriseSection
          currentProvider={config.provider}
          reasoningModel={config.model}
          setReasoningModel={setModel}
          setLocalReasoningProvider={setProvider}
        />
      )}
    </div>
  );
}
