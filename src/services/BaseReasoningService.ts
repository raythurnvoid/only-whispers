import { getCleanupSystemPrompt } from "../config/prompts";
import { getSettings } from "../stores/settingsStore";
import { resolveCleanupLanguage } from "../utils/chineseScript";
import { getDictionaryHintWords } from "../utils/snippets";
import type { InferenceScope } from "../config/inferenceScopes";
import type { DictationToneStyle } from "../config/toneStyle";
import type { ScreenContextImage } from "../types/electron";

export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  provider?: string;
  disableThinking?: boolean;
  reasoningEffort?: string;
  /** Screenshot attached to voice-agent requests when screen context is on. */
  screenContext?: ScreenContextImage;
  /** Dictation cleanup only: the Tone & Style tone for the app being dictated into. */
  toneStyle?: DictationToneStyle | null;
  /** Suffix-free prompt used when a screenshot-carrying request is retried text-only. */
  textOnlySystemPrompt?: string;
  language?: string;
  requireCompleteOutput?: boolean;
  /** Tags the request so `cancelRequest` (ai/requestCancellation) can abort it. */
  requestId?: string;
  requiresAgent?: boolean;
  inferenceScope?: InferenceScope;
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  protected getCustomDictionary(): string[] {
    return getDictionaryHintWords(getSettings());
  }

  // Auto must remain auto here: zh-CN/zh-TW instructions make cleanup write its
  // entire response in Chinese before the transcription language is known. The
  // final deterministic script pass handles likely-Chinese output instead. See #975.
  protected getPreferredLanguage(): string {
    return resolveCleanupLanguage(getSettings().preferredLanguage);
  }

  protected getSystemPrompt(
    agentName: string | null,
    toneStyle?: DictationToneStyle | null
  ): string {
    // Always the English prompt: dictation is English only, and the UI
    // language can follow the OS language, which would pick a translated prompt.
    return getCleanupSystemPrompt(
      agentName,
      this.getCustomDictionary(),
      this.getPreferredLanguage(),
      "en",
      toneStyle
    );
  }

  abstract isAvailable(): Promise<boolean>;

  abstract processText(
    text: string,
    modelId: string,
    agentName?: string | null,
    config?: ReasoningConfig
  ): Promise<string>;
}
