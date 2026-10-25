import type { InferenceProvider } from "./types";
import { openaiProvider } from "./openai";

// OpenAI on the user's ChatGPT plan is the only cleanup provider.
export const PROVIDER_REGISTRY: Readonly<Record<string, InferenceProvider>> = Object.freeze({
  openai: openaiProvider,
});

export type { InferenceProvider, ProviderContext, ProviderCallParams } from "./types";

// Whether a provider's AI-SDK client is wired to send image parts. Shared by
// the dictation route and the assistant panel so both gate screenshots alike.
export const providerSupportsImages = (providerId: string | undefined): boolean =>
  !!(providerId && PROVIDER_REGISTRY[providerId]?.supportsImages);
