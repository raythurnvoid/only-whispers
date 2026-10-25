import { getModelProvider, getCloudModel, getProviderDisplayName } from "../models/ModelRegistry";
import { chosenReasoningEffort } from "../models/reasoningEffort";
import { BaseReasoningService, ReasoningConfig } from "./BaseReasoningService";
import { SecureCache } from "../utils/SecureCache";
import logger from "../utils/logger";
import { assertValidCleanupOutput } from "../utils/cleanupOutput";
import { getSettings } from "../stores/settingsStore";
import { streamText, stepCountIs } from "ai";
import { getAIModel } from "./ai/providers";
import { PROVIDER_REGISTRY, type ProviderContext } from "./ai/inferenceProviders";
import {
  PROVIDER_ERROR_CODES,
  asProviderError,
  providerError,
} from "../helpers/providerHttpErrors.js";

export type ToolMetadata = Record<string, unknown> | Array<Record<string, unknown>>;

export type AgentStreamChunk =
  | { type: "content"; text: string }
  | { type: "tool_calls"; calls: Array<{ id: string; name: string; arguments: string }> }
  | {
      type: "tool_result";
      callId: string;
      toolName: string;
      displayText: string;
      metadata?: ToolMetadata;
    }
  | { type: "done"; finishReason?: string };

class ReasoningService extends BaseReasoningService {
  private apiKeyCache: SecureCache<string>;
  private static readonly MAX_TOOL_STEPS = 20;
  private cacheCleanupStop: (() => void) | undefined;
  private streamAbortController: AbortController | null = null;

  private readonly providerContext: ProviderContext;

  constructor() {
    super();
    this.apiKeyCache = new SecureCache();
    this.cacheCleanupStop = this.apiKeyCache.startAutoCleanup();
    this.providerContext = {
      getSystemPrompt: this.getSystemPrompt.bind(this),
    };

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.destroy());
    }
  }

  // The OpenAI API key, used only by the assistant panel's chat stream.
  private async getApiKey(provider: "openai"): Promise<string> {
    let apiKey = this.apiKeyCache.get(provider);

    logger.logReasoning(`${provider.toUpperCase()}_KEY_RETRIEVAL`, {
      provider,
      fromCache: !!apiKey,
      cacheSize: this.apiKeyCache.size || 0,
    });

    if (!apiKey) {
      try {
        apiKey = (await window.electronAPI.getOpenAIKey()) ?? undefined;

        logger.logReasoning(`${provider.toUpperCase()}_KEY_FETCHED`, {
          provider,
          hasKey: !!apiKey,
          keyLength: apiKey?.length || 0,
        });

        if (apiKey) {
          this.apiKeyCache.set(provider, apiKey);
        }
      } catch (error) {
        logger.logReasoning(`${provider.toUpperCase()}_KEY_FETCH_ERROR`, {
          provider,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
      }
    }

    if (!apiKey) {
      const displayName = getProviderDisplayName(provider);
      const errorMsg = `${displayName} API key not configured`;
      logger.logReasoning(`${provider.toUpperCase()}_KEY_MISSING`, {
        provider,
        error: errorMsg,
      });
      throw providerError(PROVIDER_ERROR_CODES.KEY_MISSING, {
        provider: displayName,
        surface: "llm",
      });
    }

    return apiKey;
  }

  async processText(
    text: string,
    model: string = "",
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    config = { ...config, inferenceScope: config.inferenceScope || "dictationCleanup" };
    const trimmedModel = model?.trim?.() || "";
    const settings = getSettings();
    const validateCleanup =
      config.inferenceScope === "dictationCleanup" &&
      !config.systemPrompt &&
      !config.requiresAgent &&
      !settings.customPrompts.cleanup;
    const providerId =
      (config.provider ?? settings.cleanupProvider)?.trim() || getModelProvider(trimmedModel);
    if (!providerId) {
      throw new Error("No reasoning provider selected");
    }
    if (!trimmedModel) {
      throw new Error("No reasoning model selected");
    }

    logger.logReasoning("PROVIDER_SELECTION", {
      provider: providerId,
      model: trimmedModel,
      agentName,
      textLength: text.length,
    });

    const handler = PROVIDER_REGISTRY[providerId];
    if (!handler) {
      throw new Error(`Unsupported reasoning provider: ${providerId}`);
    }

    const startTime = Date.now();
    try {
      const result = await handler.call({
        text,
        model: trimmedModel,
        agentName,
        config,
        ctx: this.providerContext,
      });

      if (validateCleanup) assertValidCleanupOutput(text, result);

      logger.logReasoning("PROVIDER_SUCCESS", {
        provider: providerId,
        model: trimmedModel,
        processingTimeMs: Date.now() - startTime,
        resultLength: result.length,
      });

      return result;
    } catch (error) {
      logger.logReasoning("PROVIDER_ERROR", {
        provider: providerId,
        model: trimmedModel,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async *processTextStreamingAI(
    // Content is a string, or text+image parts when a screenshot rides along
    // (image-capable providers only — the caller drops it elsewhere).
    messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
    model: string,
    provider: string,
    config: ReasoningConfig & { systemPrompt: string },
    tools?: Record<string, import("ai").Tool>
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    config = { ...config, inferenceScope: config.inferenceScope || "chatIntelligence" };
    if (provider !== "openai") {
      throw new Error(`Unsupported reasoning provider: ${provider}`);
    }
    // Cancellation must survive the asynchronous key and model setup.
    const abortController = new AbortController();
    this.streamAbortController = abortController;
    // Signed in with ChatGPT, the assistant runs on the plan: the token works as a
    // Bearer key on the same Responses endpoint. An OpenAI API key is the fallback.
    const planToken = (await window.electronAPI?.getChatGPTAccessToken?.()) || "";
    const apiKey = planToken || (await this.getApiKey(provider));
    const reasoningEffort = chosenReasoningEffort(model, config);
    const aiModel = await getAIModel(provider, model, apiKey);

    if (abortController.signal.aborted) {
      yield { type: "done", finishReason: "stop" };
      return;
    }

    const providerOptions = {
      // store: false makes the SDK resend each tool step's reasoning inline
      // (encrypted) rather than by id: a Zero Data Retention org keeps nothing
      // to look an id up in, so the step after a tool call would 404.
      // The SDK sends a Responses effort only for model ids it knows as reasoning
      // models; forceReasoning covers newer OpenAI ids such as gpt-6-astra.
      openai: {
        store: false,
        ...(reasoningEffort ? { reasoningEffort, forceReasoning: true } : {}),
      },
    };

    logger.logReasoning("AGENT_AI_SDK_STREAM_REQUEST", {
      model,
      provider,
      hasTools: !!tools,
      toolCount: tools ? Object.keys(tools).length : 0,
      messageCount: messages.length,
    });

    // GPT-5 and newer reject temperature; the registry says which models take it.
    // The plan route rejects temperature and max_output_tokens (see chatgptPlan.ts).
    const useTemperature = !planToken && !!getCloudModel(model)?.supportsTemperature;

    const result = streamText({
      model: aiModel,
      messages: messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })) as import("ai").ModelMessage[],
      tools: tools || undefined,
      stopWhen: stepCountIs(tools ? ReasoningService.MAX_TOOL_STEPS : 1),
      abortSignal: abortController.signal,
      ...(useTemperature ? { temperature: config.temperature ?? 0.3 } : {}),
      ...(planToken ? {} : { maxOutputTokens: config.maxTokens || 4096 }),
      providerOptions,
    });

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          if (chunk.text) yield { type: "content", text: chunk.text };
        } else if (chunk.type === "tool-call") {
          yield {
            type: "tool_calls",
            calls: [
              {
                id: chunk.toolCallId,
                name: chunk.toolName,
                arguments: JSON.stringify(chunk.input),
              },
            ],
          };
        } else if (chunk.type === "tool-result") {
          const output = chunk.output;
          const displayText =
            typeof output === "string" ? output : output?.error ? String(output.error) : "Done";
          // Successful object outputs become metadata so tool-result cards
          // render. Only the registry's bare { error } wrapper is a failure: a
          // connector's own "failed" result carries `error` beside its status,
          // and the history reads that status.
          const isToolFailure =
            output && typeof output === "object" && "error" in output && !("status" in output);
          const metadata =
            output && typeof output === "object" && !isToolFailure
              ? (output as ToolMetadata)
              : undefined;
          yield {
            type: "tool_result",
            callId: chunk.toolCallId,
            toolName: chunk.toolName,
            displayText,
            ...(metadata ? { metadata } : {}),
          };
        } else if (chunk.type === "tool-error") {
          // A call the SDK rejected (unknown tool, invalid input) never ran; without
          // a result it would read as cut off mid-send in the chat and its history.
          const cause = chunk.error;
          yield {
            type: "tool_result",
            callId: chunk.toolCallId,
            toolName: chunk.toolName,
            displayText: `Error: ${cause instanceof Error ? cause.message : String(cause)}`,
          };
        } else if (chunk.type === "error") {
          // streamText reports provider failures as error parts and then ends
          // the stream; swallowing them leaves callers with an empty reply and
          // no terminal signal. Re-throw unless we aborted on purpose.
          if (!abortController.signal.aborted) {
            const cause = (chunk as { error?: unknown }).error;
            throw cause instanceof Error ? cause : new Error(String(cause ?? "Stream failed"));
          }
        } else if (chunk.type === "finish") {
          yield { type: "done", finishReason: chunk.finishReason };
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        yield { type: "done", finishReason: "stop" };
        return;
      }
      // Failures arrive as AI SDK errors.
      const classified = asProviderError(error, {
        provider: getProviderDisplayName(provider),
        selfHosted: false,
        model,
        surface: "llm",
      });
      // The classified details already hold the status and the redacted body.
      const details = classified.technicalDetails;
      logger.warn(
        "BYOK chat stream failed",
        { provider, status: details?.status, body: details?.underlyingError },
        "reasoning"
      );
      throw classified;
    } finally {
      if (this.streamAbortController === abortController) {
        this.streamAbortController = null;
      }
    }
  }

  /** Aborts the chat/agent stream only (panel Esc, chat surface unmount). */
  cancelActiveStream(): void {
    this.streamAbortController?.abort();
    this.streamAbortController = null;
  }

  /**
   * Used by the dictation cancel path. Only the chat stream is aborted here;
   * ChatGPT plan cleanup requests are not.
   */
  cancelAllRequests(): void {
    this.cancelActiveStream();
  }

  // Cleanup runs only on the user's ChatGPT plan, so it is available once signed in.
  async isAvailable(): Promise<boolean> {
    try {
      const signedIn = !!(await window.electronAPI?.chatgptStatus?.())?.signedIn;
      logger.logReasoning("API_KEY_CHECK", { chatgptSignedIn: signedIn });
      return signedIn;
    } catch (error) {
      logger.logReasoning("API_KEY_CHECK_ERROR", {
        error: (error as Error).message,
        stack: (error as Error).stack,
        name: (error as Error).name,
      });
      return false;
    }
  }

  clearApiKeyCache(provider?: string): void {
    if (provider) {
      this.apiKeyCache.delete(provider);
      logger.logReasoning("API_KEY_CACHE_CLEARED", { provider });
    } else {
      this.apiKeyCache.clear();
      logger.logReasoning("API_KEY_CACHE_CLEARED", { provider: "all" });
    }
  }

  destroy(): void {
    this.cancelAllRequests();
    if (this.cacheCleanupStop) {
      this.cacheCleanupStop();
    }
  }
}

export default new ReasoningService();
