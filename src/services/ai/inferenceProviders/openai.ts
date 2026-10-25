import type { InferenceProvider } from "./types";
import { callChatGPTPlan } from "../chatgptPlan";
import { PROVIDER_ERROR_CODES, providerError } from "../../../helpers/providerHttpErrors.js";

export const openaiProvider: InferenceProvider = {
  id: "openai",
  supportsImages: true,
  async call({ text, model, agentName, config, ctx }) {
    // OpenAI models run only on the user's ChatGPT plan ("Sign in with ChatGPT").
    const planToken =
      typeof window !== "undefined" ? await window.electronAPI?.getChatGPTAccessToken?.() : "";
    if (!planToken) {
      throw providerError(PROVIDER_ERROR_CODES.KEY_MISSING, { provider: "OpenAI", surface: "llm" });
    }
    return callChatGPTPlan({ text, model, agentName, config, ctx }, planToken);
  },
};
