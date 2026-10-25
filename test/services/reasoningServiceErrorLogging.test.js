const test = require("node:test");
const assert = require("node:assert/strict");

const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function loadReasoningService(t, cachePrefix, electronAPI = {}) {
  installBrowserGlobals(t, { window: { electronAPI } });
  const vite = await createRendererServer(t, { cachePrefix });
  const reasoningService = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  const { default: logger } = await vite.ssrLoadModule("/utils/logger.ts");
  t.after(() => reasoningService.destroy());
  return { reasoningService, logger };
}

const LEAKED_KEY = "sk-proj-leakedKey12345";
const keyEchoResponse = () =>
  new Response(
    JSON.stringify({ error: { message: `Incorrect API key provided: ${LEAKED_KEY}` } }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );

function mockFetch(t, respond) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => respond();
}

test("a BYOK AI SDK stream failure logs its status and a redacted body", async (t) => {
  const { reasoningService, logger } = await loadReasoningService(
    t,
    "only-whispers-error-logging-sdk-stream-test-",
    { getOpenAIKey: async () => "sk-test" }
  );
  const warnings = [];
  t.mock.method(logger, "warn", (message, meta) => warnings.push({ message, meta }));
  mockFetch(t, keyEchoResponse);

  const error = await (async () => {
    for await (const _chunk of reasoningService.processTextStreamingAI(
      [{ role: "user", content: "hi" }],
      "gpt-5-mini",
      "openai",
      { systemPrompt: "be brief" }
    )) {
      // drain
    }
  })().then(
    () => assert.fail("expected the stream to fail"),
    (err) => err
  );

  assert.equal(error.code, "PROVIDER_AUTH_FAILED");
  const failure = warnings.find(({ message }) => message === "BYOK chat stream failed");
  assert.ok(failure, "the failure must be logged");
  assert.equal(failure.meta.status, 401);
  assert.match(failure.meta.body, /Incorrect API key provided/);
  assert.equal(failure.meta.body.includes(LEAKED_KEY), false);
});
