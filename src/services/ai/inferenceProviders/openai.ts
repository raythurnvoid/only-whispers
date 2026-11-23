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
      // There is no API key here, only the ChatGPT sign-in, so say that.
      throw Object.assign(
        providerError(PROVIDER_ERROR_CODES.KEY_MISSING, { provider: "OpenAI", surface: "llm" }),
        {
          message: "Not signed in with ChatGPT. Sign in again in Settings → AI Models.",
          messageKey: "providerErrors.chatgptSignedOut",
        }
      );
    }
    return callChatGPTPlan({ text, model, agentName, config, ctx }, planToken);
  },
};
