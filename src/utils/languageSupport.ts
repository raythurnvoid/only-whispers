import registry from "../config/languageRegistry.json";

const LANGUAGE_INSTRUCTIONS: Record<string, string> = Object.fromEntries(
  registry.languages
    .filter(
      (l): l is typeof l & { instruction: string } =>
        "instruction" in l && typeof l.instruction === "string"
    )
    .map((l) => [l.code, l.instruction])
);

export function getBaseLanguageCode(language: string | null | undefined): string | undefined {
  if (!language || language === "auto") return undefined;
  return language.split("-")[0];
}

// Dictation is English only, so "en" gets a firm rule instead of the generic
// "write in the detected language" one, which kept a misheard French transcript French.
const ENGLISH_ONLY_INSTRUCTION =
  "LANGUAGE CONTEXT: The user always speaks English, often as a non-native speaker. " +
  "You MUST write your entire output in English. If any part of the transcript came out " +
  "in another language (for example French, from a transcription mistake), write it in " +
  "English with the same meaning. Keep names, brand names and technical terms as spoken.";

export function getLanguageInstruction(language: string | undefined): string {
  if (!language) return "";
  if (language === "en") return ENGLISH_ONLY_INSTRUCTION;
  return LANGUAGE_INSTRUCTIONS[language] || buildGenericInstruction(language);
}

function buildGenericInstruction(langCode: string): string {
  const template = registry._genericTemplate || "";
  return template.replace("{{code}}", langCode);
}

