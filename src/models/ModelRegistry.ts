import modelDataRaw from "./modelRegistryData.json";
import type { InferenceMode } from "../types/electron";

export interface CloudModelDefinition {
  id: string;
  name: string;
  description: string;
  descriptionKey?: string;
  disableThinking?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  tokenParam?: "max_tokens" | "max_completion_tokens";
  supportsTemperature?: boolean;
  reasoningEffort?: ReasoningEffortCapability;
}

export interface ReasoningEffortCapability {
  options: string[];
  defaultValue?: string;
}

export interface CloudProviderData {
  id: string;
  name: string;
  /** Named default for providers whose list order isn't ours — see pickProviderDefaultModel. */
  defaultModel?: string;
  models: CloudModelDefinition[];
}

interface ModelRegistryData {
  cloudProviders: CloudProviderData[];
}

const modelData: ModelRegistryData = modelDataRaw as ModelRegistryData;

export function isProviderValidForMode(provider: string, mode: InferenceMode): boolean {
  switch (mode) {
    case "providers":
      return modelData.cloudProviders.some((p) => p.id === provider);
    case "local":
    case "enterprise":
      return false;
    default:
      return true;
  }
}

export function getProviderDisplayName(provider: string): string {
  return modelData.cloudProviders.find((p) => p.id === provider)?.name ?? provider;
}

// The cloud provider that lists this model. No default: an unknown model must
// fail closed at dispatch.
export function getModelProvider(modelId: string): string {
  return modelData.cloudProviders.find((p) => p.models.some((m) => m.id === modelId))?.id ?? "";
}

export function getCloudModel(modelId: string): CloudModelDefinition | undefined {
  for (const provider of modelData.cloudProviders) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model;
  }
  return undefined;
}
