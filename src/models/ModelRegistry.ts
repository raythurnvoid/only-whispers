import modelDataRaw from "./modelRegistryData.json";
import { getSettings } from "../stores/settingsStore";
import { readCachedTinfoilModels } from "./tinfoilModelCache";
import type { InferenceMode } from "../types/electron";

export interface ModelDefinition {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  description: string;
  descriptionKey?: string;
  fileName: string;
  quantization: string;
  contextLength: number;
  hfRepo: string;
  recommended?: boolean;
  supportsThinking?: boolean;
  // Optional MTP speculative-decoding drafter downloaded alongside the main GGUF.
  draftHfRepo?: string;
  draftFileName?: string;
  draftSizeBytes?: number;
}

export interface LocalProviderData {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelDefinition[];
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelDefinition[];
  getDownloadUrl(model: ModelDefinition): string;
}

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

export interface EnterpriseProviderData extends CloudProviderData {
  allowCustomModelId: boolean;
}

interface ModelRegistryData {
  cloudProviders: CloudProviderData[];
  enterpriseProviders: EnterpriseProviderData[];
  localProviders: LocalProviderData[];
}

const modelData: ModelRegistryData = modelDataRaw as ModelRegistryData;

function getTinfoilCloudProvider(): CloudProviderData | undefined {
  return modelData.cloudProviders.find((provider) => provider.id === "tinfoil");
}

const cachedTinfoilModels = readCachedTinfoilModels().models;
if (cachedTinfoilModels.length > 0) {
  const tinfoilProvider = getTinfoilCloudProvider();
  if (tinfoilProvider) {
    tinfoilProvider.models = cachedTinfoilModels;
  }
}

class ModelRegistry {
  private static instance: ModelRegistry;
  private providers = new Map<string, ModelProvider>();

  private constructor() {
    this.registerProvidersFromData();
  }

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  registerProvider(provider: ModelProvider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }

  getAllProviders(): ModelProvider[] {
    return Array.from(this.providers.values());
  }

  getModel(modelId: string): { model: ModelDefinition; provider: ModelProvider } | undefined {
    for (const provider of this.providers.values()) {
      const model = provider.models.find((m) => m.id === modelId);
      if (model) {
        return { model, provider };
      }
    }
    return undefined;
  }

  getAllModels(): Array<ModelDefinition & { providerId: string }> {
    const models: Array<ModelDefinition & { providerId: string }> = [];
    for (const provider of this.providers.values()) {
      for (const model of provider.models) {
        models.push({ ...model, providerId: provider.id });
      }
    }
    return models;
  }

  getCloudProviders(): CloudProviderData[] {
    return modelData.cloudProviders;
  }

  getEnterpriseProviders(): EnterpriseProviderData[] {
    return modelData.enterpriseProviders;
  }

  private registerProvidersFromData() {
    const localProviders = modelData.localProviders;

    for (const providerData of localProviders) {
      this.registerProvider({
        id: providerData.id,
        name: providerData.name,
        baseUrl: providerData.baseUrl,
        models: providerData.models,
        getDownloadUrl(model: ModelDefinition): string {
          return `${providerData.baseUrl}/${model.hfRepo}/resolve/main/${model.fileName}`;
        },
      });
    }
  }
}

export const modelRegistry = ModelRegistry.getInstance();

export interface ReasoningModel {
  value: string;
  label: string;
  description: string;
  descriptionKey?: string;
}

export interface ReasoningProvider {
  name: string;
  models: ReasoningModel[];
}

export type ReasoningProviders = Record<string, ReasoningProvider>;

export type EnterpriseProvider = "bedrock" | "azure" | "vertex";
export const ENTERPRISE_PROVIDERS: readonly EnterpriseProvider[] = ["bedrock", "azure", "vertex"];
export function isEnterpriseProvider(value: unknown): value is EnterpriseProvider {
  return typeof value === "string" && (ENTERPRISE_PROVIDERS as readonly string[]).includes(value);
}

export function enterpriseProviderName(provider: EnterpriseProvider): string {
  return modelRegistry.getEnterpriseProviders().find((p) => p.id === provider)?.name ?? provider;
}

export function toReasoningModel(m: CloudModelDefinition): ReasoningModel {
  return {
    value: m.id,
    label: m.name,
    description: m.description,
    descriptionKey: m.descriptionKey,
  };
}

export function isProviderValidForMode(provider: string, mode: InferenceMode): boolean {
  switch (mode) {
    case "providers":
      return (
        provider === "custom" ||
        provider === "openrouter" ||
        modelRegistry.getCloudProviders().some((p) => p.id === provider)
      );
    case "local":
      return modelRegistry.getAllProviders().some((p) => p.id === provider);
    case "enterprise":
      return isEnterpriseProvider(provider);
    default:
      return true;
  }
}

function buildReasoningProviders(): ReasoningProviders {
  const providers: ReasoningProviders = {};

  for (const cloudProvider of modelRegistry.getCloudProviders()) {
    providers[cloudProvider.id] = {
      name: cloudProvider.name,
      models: cloudProvider.models.map(toReasoningModel),
    };
  }

  for (const ep of modelRegistry.getEnterpriseProviders()) {
    providers[ep.id] = {
      name: ep.name,
      models: ep.models.map((m) => ({
        value: m.id,
        label: m.name,
        description: m.description,
        descriptionKey: m.descriptionKey,
      })),
    };
  }

  providers.local = {
    name: "Local AI",
    models: modelRegistry.getAllModels().map((model) => ({
      value: model.id,
      label: model.name,
      description: `${model.description} (${model.size})`,
      descriptionKey: model.descriptionKey,
    })),
  };

  return providers;
}

export const REASONING_PROVIDERS = buildReasoningProviders();

export function getTinfoilModels(): CloudModelDefinition[] {
  return getTinfoilCloudProvider()?.models ?? [];
}

export function getCloudProviderDefaultModelId(providerId: string): string | undefined {
  return modelData.cloudProviders.find((provider) => provider.id === providerId)?.defaultModel;
}

export function applyTinfoilModels(models: CloudModelDefinition[]): void {
  const provider = getTinfoilCloudProvider();
  if (provider) {
    provider.models = models;
  }
  const reasoningProvider = REASONING_PROVIDERS.tinfoil;
  if (reasoningProvider) {
    reasoningProvider.models = models.map(toReasoningModel);
  }
}

export interface ReasoningModelWithProvider extends ReasoningModel {
  provider: string;
  fullLabel: string;
}

export function getAllReasoningModels(): ReasoningModelWithProvider[] {
  return Object.entries(REASONING_PROVIDERS).flatMap(([providerId, provider]) =>
    provider.models.map((model) => ({
      ...model,
      provider: providerId,
      fullLabel: `${provider.name} ${model.label}`,
    }))
  );
}

export function getReasoningModelLabel(modelId: string): string {
  const model = getAllReasoningModels().find((m) => m.value === modelId);
  return model?.fullLabel || modelId;
}

const NON_REGISTRY_PROVIDER_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  custom: "Custom",
};

export function getProviderDisplayName(provider: string): string {
  return (
    REASONING_PROVIDERS[provider as keyof typeof REASONING_PROVIDERS]?.name ??
    NON_REGISTRY_PROVIDER_NAMES[provider] ??
    provider
  );
}

export function getModelProvider(modelId: string): string {
  const storedProvider = getSettings().cleanupProvider;

  if (storedProvider === "custom") {
    return "custom";
  }

  if (storedProvider === "openrouter") {
    return "openrouter";
  }

  if (isEnterpriseProvider(storedProvider)) {
    return storedProvider;
  }

  const model = getAllReasoningModels().find((m) => m.value === modelId);

  if (!model) {
    // An unknown model here is one Tinfoil retired or added since our last
    // sync — don't let the id heuristics misroute it.
    if (storedProvider === "tinfoil") return "tinfoil";
    if (modelId.includes("claude")) return "anthropic";
    if (modelId.includes("gemini") && !modelId.includes("gemma")) return "gemini";
    if ((modelId.includes("gpt-4") || modelId.includes("gpt-5")) && !modelId.includes("gpt-oss"))
      return "openai";
    if (
      modelId.includes("qwen/") ||
      modelId.includes("openai/") ||
      modelId.includes("llama-3.1-8b-instant") ||
      modelId.includes("llama-3.3-") ||
      modelId.includes("meta-llama/llama-4-") ||
      modelId.includes("groq/compound") ||
      modelId.includes("moonshotai/kimi-k2-")
    )
      return "groq";
    if (
      modelId.includes("qwen") ||
      modelId.includes("llama") ||
      modelId.includes("mistral") ||
      modelId.includes("lfm2") ||
      modelId.includes("gemma") ||
      modelId.includes("gpt-oss-20b-mxfp4")
    )
      return "local";
  }

  // No default: an unrecognized model must fail closed at dispatch instead of
  // being routed to OpenAI with whatever key that attaches.
  return model?.provider || "";
}

// Local catalog IDs group models for selection and downloads, but all execute
// through the single local llama.cpp inference provider.
export function resolveInferenceProvider(
  configuredProvider: string | undefined,
  modelId: string
): string {
  const provider = configuredProvider?.trim();
  if (provider && modelRegistry.getProvider(provider)) return "local";
  return provider || getModelProvider(modelId);
}

export function getCloudModel(
  modelId: string,
  providerId?: string
): CloudModelDefinition | undefined {
  for (const provider of modelData.cloudProviders) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model;
  }
  for (const provider of modelData.enterpriseProviders) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return model;
  }
  // OpenRouter ids carry a vendor prefix (google/gemini-3.5-flash-lite) that the
  // registry stores without, so retry on the upstream id.
  if (providerId === "openrouter" && modelId.includes("/")) {
    return getCloudModel(modelId.slice(modelId.lastIndexOf("/") + 1));
  }
  return undefined;
}

export function getLocalModel(modelId: string): ModelDefinition | undefined {
  return modelRegistry.getModel(modelId)?.model;
}

export interface OpenAiApiConfig {
  tokenParam: "max_tokens" | "max_completion_tokens";
  supportsTemperature: boolean;
}

export function getOpenAiApiConfig(modelId: string, provider?: string): OpenAiApiConfig {
  const model = getCloudModel(modelId);
  if (model?.tokenParam) {
    return {
      tokenParam: model.tokenParam,
      supportsTemperature: model.supportsTemperature ?? true,
    };
  }

  // OpenRouter's vendor-prefixed ids (openai/gpt-4o, anthropic/claude-…) speak
  // standard Chat Completions. Scoped to the provider so vendor-prefixed ids on
  // custom endpoints keep the request shape they had before OpenRouter landed.
  // Sampling params pass through to the upstream vendor, so a model the
  // registry knows rejects temperature (Claude Opus 4.7+, #1417) must keep it
  // omitted here too — OpenRouter forwards the 400 rather than stripping it.
  if (provider === "openrouter" && modelId.includes("/")) {
    const upstream = getCloudModel(modelId, provider);
    return { tokenParam: "max_tokens", supportsTemperature: upstream?.supportsTemperature ?? true };
  }

  // Fallback for models not in the registry (custom model IDs, etc.)
  const isLegacy =
    modelId.startsWith("gpt-3") ||
    modelId.startsWith("gpt-4o") ||
    modelId.startsWith("gpt-4-") ||
    modelId === "gpt-4";

  if (isLegacy) {
    return { tokenParam: "max_tokens", supportsTemperature: true };
  }

  // gpt-4.1* supports temperature but uses max_completion_tokens
  if (modelId.startsWith("gpt-4.1")) {
    return { tokenParam: "max_completion_tokens", supportsTemperature: true };
  }

  // gpt-5* reasoning models: no temperature
  return { tokenParam: "max_completion_tokens", supportsTemperature: false };
}
