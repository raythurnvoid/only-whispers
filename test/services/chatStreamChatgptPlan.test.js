const test = require("node:test");
const assert = require("node:assert/strict");

const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// The assistant panel and chat stream on the ChatGPT plan when signed in: the plan
// token is the Bearer key, and the request leaves out what the plan route rejects.
test("the chat stream runs on the ChatGPT plan token when signed in", async (t) => {
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getChatGPTAccessToken: async () => "plan-token",
        getOpenAIKey: async () => "sk-unused",
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "only-whispers-chat-plan-test-" });
  const reasoningService = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoningService.destroy());

  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), headers: new Headers(init.headers), body: init.body });
    return new Response(JSON.stringify({ error: { message: "stop here" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(async () => {
    for await (const _chunk of reasoningService.processTextStreamingAI(
      [{ role: "user", content: "hi" }],
      "gpt-6-luna",
      "openai",
      { systemPrompt: "be brief" }
    )) {
      // drain
    }
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/v1\/responses$/);
  assert.equal(requests[0].headers.get("authorization"), "Bearer plan-token");
  const body = JSON.parse(requests[0].body);
  assert.equal(body.store, false);
  assert.equal("max_output_tokens" in body, false);
  assert.equal("temperature" in body, false);
});
