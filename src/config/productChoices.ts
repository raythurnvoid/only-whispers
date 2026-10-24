import type { InferenceMode } from "../types/electron";

// only-whispers offers one setup: Mistral Voxtral for speech-to-text and OpenAI Luna
// (on the ChatGPT plan) for cleanup. Settings hide every other mode, provider and model.
const PROVIDERS = { transcription: ["mistral"], llm: ["openai"] };
const MODELS: Record<string, string[]> = {
  mistral: ["voxtral-mini-transcribe-3-0", "voxtral-small-transcribe-3-0"],
  openai: ["gpt-6-luna", "gpt-5.6-luna"],
};

export const isProductMode = (mode: InferenceMode) => mode === "providers";

export const onlyProductProviders = <T extends { id: string }>(
  options: T[],
  scope: keyof typeof PROVIDERS
) => options.filter((option) => PROVIDERS[scope].includes(option.id));

// Transcription models name themselves by `id`, reasoning models by `value`.
export const onlyProductModels = <T extends { id: string } | { value: string }>(
  provider: string,
  models: T[]
) => models.filter((model) => MODELS[provider]?.includes("id" in model ? model.id : model.value));
