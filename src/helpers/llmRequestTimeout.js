const LLM_REQUEST_TIMEOUT_SECONDS = 30;
const LLM_STREAMING_TIMEOUT_SECONDS = 60;

export const LLM_REQUEST_TIMEOUT_CODE = "LLM_REQUEST_TIMEOUT";

/**
 * Client-side deadline for a non-streaming LLM request, or idle timeout for a stream.
 * @param {{ streaming?: boolean }} [options]
 */
export function getLlmRequestTimeoutSeconds({ streaming = false } = {}) {
  return streaming ? LLM_STREAMING_TIMEOUT_SECONDS : LLM_REQUEST_TIMEOUT_SECONDS;
}

/** The coded error a request raises when its client-side deadline expires; createApiRetryStrategy never retries it. */
export function llmRequestTimeoutError(timeoutSeconds) {
  return Object.assign(new Error(`Request timed out after ${timeoutSeconds}s`), {
    code: LLM_REQUEST_TIMEOUT_CODE,
  });
}
