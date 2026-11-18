// Mistral settings for optional cloud transcription. Shared by dictation, retry and
// upload, and loaded by the renderer and the main process alike (main uses
// dynamic import), so it uses erasable TypeScript syntax only.

// Mistral's upload limit.
export const MISTRAL_FILE_SIZE_LIMIT = 25 * 1024 * 1024;

export function hasMistralKey(key?: string): boolean {
  const trimmed = key?.trim();
  return Boolean(trimmed && trimmed !== "your_mistral_api_key_here");
}

// Prefix-matched rather than registry-checked on purpose: this module loads in
// the packaged main process without the registry.
export function resolveMistralModel(configuredModel?: string): string {
  const trimmed = (configuredModel || "").trim();
  return trimmed.startsWith("voxtral-") ? trimmed : "voxtral-mini-transcribe-3-0";
}
