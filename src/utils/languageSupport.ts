import registry from "../config/languageRegistry.json";

function buildLanguageSet(key: "whisper" | "assemblyai"): Set<string> {
  const set = new Set<string>();
  for (const lang of registry.languages) {
    if (lang[key]) {
      set.add(lang.code);
      const base = lang.code.split("-")[0];
      if (base !== lang.code) set.add(base);
    }
  }
  return set;
}

const WHISPER_LANGUAGES = buildLanguageSet("whisper");
const ASSEMBLYAI_UNIVERSAL3_PRO_LANGUAGES = buildLanguageSet("assemblyai");

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

export function getLanguageLabel(code: string | null | undefined): string {
  if (!code) return "";
  const entry = registry.languages.find((l) => l.code === code);
  return entry?.label ?? code;
}

export { WHISPER_LANGUAGES, ASSEMBLYAI_UNIVERSAL3_PRO_LANGUAGES };
