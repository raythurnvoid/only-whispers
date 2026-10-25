import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// Renderer-side AI SDK factory for the assistant panel's chat stream.
export async function getAIModel(
  provider: string,
  model: string,
  apiKey: string
): Promise<LanguageModel> {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(model);
    default:
      throw new Error(`Unsupported AI SDK provider for renderer: ${provider}`);
  }
}
