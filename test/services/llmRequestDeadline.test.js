const test = require("node:test");
const assert = require("node:assert/strict");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");

const CTX = { getSystemPrompt: () => "Clean the transcript" };

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
  installBrowserGlobals(t, {
    window: { electronAPI: { getChatGPTAccessToken: async () => "plan-token" } },
  });
  const { openaiProvider } = await import("../../src/services/ai/inferenceProviders/openai.ts");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const posts = installHangingFetch(t);

  let outcome = null;
  const request = openaiProvider
    .call({
      text: "clean this up",
      model: "gpt-6-luna",
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

  assert.equal(outcome?.error?.code, "LLM_REQUEST_TIMEOUT");
  assert.match(outcome?.error?.message ?? "", /Request timed out after 30s/);
});
