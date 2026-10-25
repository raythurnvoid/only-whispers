const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const CTX = {
  getApiKey: async () => "test-key",
  getSystemPrompt: () => "Clean the transcript",
  getCustomDictionary: () => [],
  getPreferredLanguage: () => "en",
  getUiLanguage: () => "en",
  callChatCompletionsApi: async () => {
    throw new Error("Unexpected chat completions delegation");
  },
  calculateMaxTokens: () => 4096,
};

// A fetch whose POSTs never answer on their own but honor the abort signal,
// the way a real request does while the model is still generating.
function installHangingFetch(t) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const posts = [];
  globalThis.fetch = (input, init = {}) => {
    const method = init.method || "GET";
    if (method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "not found" } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    posts.push(String(input));
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
      });
    });
  };
  return posts;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("dictation cleanup keeps its 30-second deadline", async (t) => {
  const { openaiProvider } = await import("../../src/services/ai/inferenceProviders/openai.ts");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const posts = installHangingFetch(t);

  let outcome = null;
  const request = openaiProvider
    .call({
      text: "clean this up",
      model: "gpt-4.1-mini",
      agentName: null,
      config: { provider: "openai" },
      ctx: CTX,
    })
    .then(
      (value) => {
        outcome = { value };
      },
      (error) => {
        outcome = { error };
      }
    );
  await settle();
  assert.equal(posts.length, 1);

  t.mock.timers.tick(30_000);
  await settle();
  await request;

  assert.equal(outcome?.error?.code, "PROVIDER_TIMEOUT");
  assert.match(outcome?.error?.cause?.message ?? "", /Request timed out after 30s/);
});

// Enterprise requests run in the main process, whose handler applies its own
// 60-second default unless the renderer sends the deadline along.
test("enterprise requests send their deadline to the main process", async (t) => {
  const ipcConfigs = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        processEnterpriseReasoning: async (_text, _model, _agentName, config) => {
          ipcConfigs.push(config);
          return { success: true, text: "# Notes" };
        },
      },
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-enterprise-deadline-test-",
    mockModules: {
      "/models/ModelRegistry": `
        export const getOpenAiApiConfig = () => ({ supportsTemperature: true });
        export const isEnterpriseProvider = (provider) => provider === "bedrock";
      `,
      "/stores/settingsStore": "export const getSettings = () => ({ cleanupProvider: 'bedrock' });",
      "/services/ai/enterpriseSettings": "export const getEnterpriseCallSettings = () => ({});",
      "/utils/logger": "export default { logReasoning() {} };",
    },
  });
  const { enterpriseProvider } = await vite.ssrLoadModule(
    "/services/ai/inferenceProviders/enterprise.ts"
  );
  const call = (config) =>
    enterpriseProvider.call({
      text: "Alice: we agreed to ship on Friday.",
      model: "anthropic.claude-sonnet",
      agentName: null,
      config: { provider: "bedrock", ...config },
      ctx: CTX,
    });

  await call({});

  assert.equal(ipcConfigs[0].timeoutMs, 30_000);
});

// Tinfoil goes through the OpenAI SDK, which reports an expired deadline as a
// connection error; without the mapping, withRetry would re-send it.
test("Tinfoil passes its deadline to the SDK and does not retry its timeout", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-tinfoil-deadline-test-",
    mockModules: {
      "/tinfoilClient": `
        export const getTinfoilChatClient = async () => ({
          chat: {
            completions: {
              create: async (_body, options) => {
                globalThis.__tinfoilCreateCalls.push(options);
                throw Object.assign(new Error("Request timed out."), {
                  name: "APIConnectionTimeoutError",
                });
              },
            },
          },
        });
      `,
    },
  });
  globalThis.__tinfoilCreateCalls = [];
  t.after(() => {
    delete globalThis.__tinfoilCreateCalls;
  });
  const { tinfoilProvider } = await vite.ssrLoadModule(
    "/services/ai/inferenceProviders/tinfoil.ts"
  );

  await assert.rejects(
    tinfoilProvider.call({
      text: "Alice: we agreed to ship on Friday.",
      model: "glm-5-3",
      agentName: null,
      config: {},
      ctx: CTX,
    }),
    /Request timed out after 30s/
  );

  assert.equal(
    globalThis.__tinfoilCreateCalls.length,
    1,
    "an expired deadline must not be re-sent"
  );
  assert.equal(globalThis.__tinfoilCreateCalls[0].timeout, 30_000);
  assert.equal(globalThis.__tinfoilCreateCalls[0].maxRetries, 0);
});
