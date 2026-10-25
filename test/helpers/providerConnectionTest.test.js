const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const providerTest = require("../../src/helpers/providerConnectionTest.js");

const { resolveProviderRequest, testProviderConnection } = providerTest;

test("builds provider tests without placing credentials in the URL", () => {
  const request = resolveProviderRequest({ provider: "openai", apiKey: "secret" });
  assert.equal(request.endpoint, "https://api.openai.com/v1/models");
  assert.equal(request.endpoint.includes("secret"), false);
  assert.equal(request.headers.Authorization, "Bearer secret");
});

test("honors OpenAI base URL overrides from the environment", () => {
  process.env.OPENAI_BASE_URL = "https://proxy.example.com/v1/";
  try {
    const request = resolveProviderRequest({ provider: "openai", apiKey: "secret" });
    assert.deepEqual(request.endpoints, ["https://proxy.example.com/v1/models"]);
    assert.equal(request.redirect, "follow");
  } finally {
    delete process.env.OPENAI_BASE_URL;
  }
});

test("normalizes custom compatible endpoints", () => {
  assert.equal(
    resolveProviderRequest({ provider: "custom", baseUrl: "localhost:11434/v1", apiKey: "" })
      .endpoint,
    "https://localhost:11434/v1/models"
  );
});

test("probes the /v1 sibling for bare custom origins", () => {
  assert.deepEqual(
    resolveProviderRequest({ provider: "custom", baseUrl: "http://localhost:1234", apiKey: "" })
      .endpoints,
    ["http://localhost:1234/models", "http://localhost:1234/v1/models"]
  );
  // LM Studio's native REST base maps to its OpenAI-compatible /v1 sibling.
  assert.deepEqual(
    resolveProviderRequest({ provider: "custom", baseUrl: "http://localhost:1234/api/v0" })
      .endpoints,
    ["http://localhost:1234/api/v0/models", "http://localhost:1234/v1/models"]
  );
});

// The runtime (isSecureHttpEndpoint in src/utils/urlUtils.ts) refuses plain
// HTTP on public hosts, so the test must refuse the same URLs — a passing test
// would otherwise commit a config every real request rejects.
test("rejects public HTTP endpoints but allows private hosts", async () => {
  assert.deepEqual(
    await testProviderConnection({ provider: "custom", baseUrl: "http://myserver.example.com/v1" }),
    {
      success: false,
      errorCode: "httpsRequired",
      error: "Public endpoints must use HTTPS. HTTP is only allowed on private addresses.",
    }
  );

  for (const baseUrl of [
    "http://localhost:1234",
    "http://192.168.1.10:8080/v1",
    "http://100.101.102.103/v1",
    "http://ollama.ts.net/v1",
  ]) {
    assert.equal(
      resolveProviderRequest({ provider: "custom", baseUrl }).endpoints.length > 0,
      true
    );
  }

  // A public DNS name that merely starts with a private prefix is still public.
  assert.equal(
    (await testProviderConnection({ provider: "custom", baseUrl: "http://10.example.com/v1" }))
      .errorCode,
    "httpsRequired"
  );
});

test("rejects invalid custom endpoints with error codes", async () => {
  assert.deepEqual(await testProviderConnection({ provider: "custom", baseUrl: "" }), {
    success: false,
    errorCode: "endpointRequired",
    error: "Enter an endpoint URL before testing.",
  });

  assert.deepEqual(await testProviderConnection({ provider: "custom", baseUrl: "ftp://x" }), {
    success: false,
    errorCode: "invalidUrl",
    error: "The endpoint must use HTTP or HTTPS.",
  });

  assert.deepEqual(await testProviderConnection({ provider: "unknown", apiKey: "k" }), {
    success: false,
    errorCode: "unsupportedProvider",
    error: "Connection testing is not available for this provider.",
  });

  assert.deepEqual(await testProviderConnection({ provider: "openai", apiKey: "" }), {
    success: false,
    errorCode: "apiKeyRequired",
    error: "Add an API key before testing.",
  });
});

test("maps authentication and transport failures to safe messages", async () => {
  assert.deepEqual(
    await testProviderConnection({ provider: "openai", apiKey: "bad" }, async () => ({
      ok: false,
      status: 401,
    })),
    {
      success: false,
      errorCode: "credentialsRejected",
      error: "The provider rejected these credentials.",
      status: 401,
    }
  );

  assert.deepEqual(
    await testProviderConnection({ provider: "openai", apiKey: "bad" }, async () => {
      throw new Error("secret upstream detail");
    }),
    {
      success: false,
      errorCode: "network",
      error: "The provider could not be reached.",
      unverified: true,
    }
  );

  assert.deepEqual(
    await testProviderConnection({ provider: "openai", apiKey: "k" }, async () => ({
      ok: false,
      status: 500,
    })),
    {
      success: false,
      errorCode: "providerStatus",
      error: "The provider returned status 500.",
      status: 500,
      unverified: true,
    }
  );
});

test("a provider that is slow, busy or down gives no verdict, so the failure is unverified", async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const result = await testProviderConnection({ provider: "openai", apiKey: "k" }, async () => ({
      ok: false,
      status,
    }));
    assert.equal(result.success, false, String(status));
    assert.equal(result.errorCode, "providerStatus", String(status));
    assert.equal(result.unverified, true, String(status));
  }
  const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  for (const [error, errorCode] of [
    [aborted, "timeout"],
    [new TypeError("fetch failed"), "network"],
  ]) {
    const result = await testProviderConnection({ provider: "openai", apiKey: "k" }, async () => {
      throw error;
    });
    assert.equal(result.errorCode, errorCode);
    assert.equal(result.unverified, true, errorCode);
  }
});

test("an answer that faults the key or the setup is never unverified", async () => {
  const cases = [
    [
      { provider: "openai", apiKey: "bad" },
      () => ({ ok: false, status: 401 }),
      "credentialsRejected",
    ],
    [
      { provider: "openai", apiKey: "bad" },
      () => ({ ok: false, status: 403 }),
      "credentialsRejected",
    ],
    [{ provider: "openai", apiKey: "k" }, () => ({ ok: false, status: 400 }), "providerStatus"],
    [{ provider: "openai", apiKey: "k" }, () => ({ ok: false, status: 402 }), "providerStatus"],
    [{ provider: "openai", apiKey: "k" }, () => ({ ok: false, status: 404 }), "providerStatus"],
    [
      { provider: "openai", apiKey: "k", model: "gone" },
      () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "other" }] }) }),
      "modelNotFound",
    ],
    [
      { provider: "custom", baseUrl: "http://localhost:1234" },
      () => ({ ok: false, status: 404 }),
      "endpointNotFound",
    ],
    [
      { provider: "gemini", apiKey: "made-up" },
      () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { details: [{ reason: "API_KEY_INVALID" }] } }),
      }),
      "credentialsRejected",
    ],
  ];
  for (const [config, answer, errorCode] of cases) {
    const result = await testProviderConnection(config, async () => answer());
    assert.equal(result.errorCode, errorCode, `${config.provider} ${errorCode}`);
    assert.equal(result.unverified, undefined, `${config.provider} ${errorCode}`);
  }
});

test("across a custom server's addresses, an answer outranks no answer", async () => {
  const base = "http://localhost:1234";
  const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const answer = (models, v1) => async (url) => {
    const reply = url.includes("/v1/models") ? v1 : models;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const check = (config, fetchImpl) =>
    testProviderConnection({ provider: "custom", baseUrl: base, ...config }, fetchImpl);
  const listWithout = {
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "other" }] }),
  };

  // A busy address never hides a refused key or a missing model on the other one.
  const missing = await check({ model: "m" }, answer({ ok: false, status: 503 }, listWithout));
  assert.equal(missing.errorCode, "modelNotFound");
  assert.equal(missing.unverified, undefined);
  const refused = await check({ apiKey: "bad" }, answer(aborted, { ok: false, status: 401 }));
  assert.equal(refused.errorCode, "credentialsRejected");

  // A real status wins whichever address answered it.
  for (const [first, second] of [
    [400, 503],
    [503, 400],
  ]) {
    const result = await check(
      {},
      answer({ ok: false, status: first }, { ok: false, status: second })
    );
    assert.equal(result.status, 400, `${first} then ${second}`);
    assert.equal(result.unverified, undefined, `${first} then ${second}`);
  }

  // No answer outranks an address without a model list, which the server may not use.
  const busy = await check({}, answer({ ok: false, status: 404 }, { ok: false, status: 503 }));
  assert.equal(busy.status, 503);
  assert.equal(busy.unverified, true);
  const slow = await check({}, answer({ ok: false, status: 404 }, aborted));
  assert.equal(slow.errorCode, "timeout");
  assert.equal(slow.unverified, true);
});

test("succeeds when only the /v1 candidate responds", async () => {
  const attempted = [];
  const result = await testProviderConnection(
    { provider: "custom", baseUrl: "http://localhost:1234" },
    async (url) => {
      attempted.push(url);
      return url.includes("/v1/models") ? { ok: true, status: 200 } : { ok: false, status: 404 };
    }
  );
  assert.deepEqual(result, { success: true });
  assert.deepEqual(attempted, ["http://localhost:1234/models", "http://localhost:1234/v1/models"]);
});

test("rejects a successful model list that omits the selected model", async () => {
  assert.deepEqual(
    await testProviderConnection(
      { provider: "custom", baseUrl: "http://localhost:1234/v1", model: "typo-model" },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "real-model" }] }),
      })
    ),
    {
      success: false,
      errorCode: "modelNotFound",
      error: "The selected model is not available from this provider.",
    }
  );
});

test("accepts selected models from OpenAI and Gemini model-list shapes", async () => {
  for (const payload of [
    { data: [{ id: "selected-model" }] },
    { models: [{ name: "models/selected-model" }] },
  ]) {
    assert.deepEqual(
      await testProviderConnection(
        { provider: "custom", baseUrl: "http://localhost:1234/v1", model: "selected-model" },
        async () => ({ ok: true, status: 200, json: async () => payload })
      ),
      { success: true }
    );
  }
});

// Anthropic's model list carries only dated snapshots of the aliases the registry uses.
test("accepts an Anthropic alias by its dated snapshot, but not a prefix", async () => {
  const check = (config, id) =>
    testProviderConnection({ apiKey: "k", ...config }, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id }] }),
    }));
  const snapshot = "claude-opus-4-5-20251101";
  assert.deepEqual(await check({ provider: "anthropic", model: "claude-opus-4-5" }, snapshot), {
    success: true,
  });
  assert.equal(
    (await check({ provider: "anthropic", model: "claude-opus-4" }, snapshot)).errorCode,
    "modelNotFound"
  );
  // A custom server matches ids exactly, so it would reject the undated id.
  const custom = { provider: "custom", baseUrl: "http://localhost:1234/v1", model: "foo" };
  assert.equal((await check(custom, "foo-20251001")).errorCode, "modelNotFound");
});

test("continues to a compatible candidate when an earlier model list omits the selection", async () => {
  const attempted = [];
  const result = await testProviderConnection(
    { provider: "custom", baseUrl: "http://localhost:1234", model: "selected-model" },
    async (url) => {
      attempted.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: url.includes("/v1/models") ? "selected-model" : "native-model" }],
        }),
      };
    }
  );

  assert.deepEqual(result, { success: true });
  assert.deepEqual(attempted, ["http://localhost:1234/models", "http://localhost:1234/v1/models"]);
});

test("reports endpointNotFound only after every candidate 404s", async () => {
  assert.deepEqual(
    await testProviderConnection(
      { provider: "custom", baseUrl: "http://localhost:1234" },
      async () => ({
        ok: false,
        status: 404,
      })
    ),
    {
      success: false,
      errorCode: "endpointNotFound",
      error: "The endpoint does not expose an OpenAI-compatible model list.",
      status: 404,
    }
  );

  // A credentials failure on any candidate outranks a 404 on another.
  assert.deepEqual(
    await testProviderConnection(
      { provider: "custom", baseUrl: "http://localhost:1234", apiKey: "bad" },
      async (url) => ({ ok: false, status: url.includes("/v1/models") ? 401 : 404 })
    ),
    {
      success: false,
      errorCode: "credentialsRejected",
      error: "The provider rejected these credentials.",
      status: 401,
    }
  );
});

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  // undefined is an empty body; a string is raw text (JSON.parse throws on non-JSON).
  json: async () => {
    if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
    return typeof body === "string" ? JSON.parse(body) : body;
  },
});

function recordingFetch(answer) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { calls, fetchImpl };
}

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const GEMINI_INVALID_KEY = {
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "API_KEY_INVALID",
        domain: "googleapis.com",
      },
    ],
  },
};
const GEMINI_OTHER_REASON = {
  error: { code: 400, details: [{ reason: "API_KEY_SERVICE_BLOCKED" }] },
};
const XAI_BAD_KEY = { code: "invalid-argument", error: "Incorrect API key provided: xa***00." };
const CORTI_MALFORMED_HEADER = { message: "Missing or malformed Authorization header" };

test("Anthropic and Gemini are asked for their largest page of models", () => {
  assert.equal(
    resolveProviderRequest({ provider: "anthropic", apiKey: "k" }).endpoint,
    "https://api.anthropic.com/v1/models?limit=1000"
  );
  assert.equal(
    resolveProviderRequest({ provider: "gemini", apiKey: "k" }).endpoint,
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
  );
});

test("Gemini, xAI and Corti rejections are read from the provider's error body", async () => {
  const cases = [
    ["gemini", 400, GEMINI_INVALID_KEY, "credentialsRejected"],
    ["gemini", 400, { error: { status: "FAILED_PRECONDITION" } }, "providerStatus"],
    ["gemini", 400, GEMINI_OTHER_REASON, "providerStatus"],
    ["gemini", 400, undefined, "providerStatus"],
    ["xai", 400, XAI_BAD_KEY, "credentialsRejected"],
    ["xai", 400, { error: "incorrect api KEY provided." }, "credentialsRejected"],
    ["xai", 400, { error: "Model grok-x does not exist" }, "providerStatus"],
    ["xai", 400, "Bad Request", "providerStatus"],
    ["xai", 500, XAI_BAD_KEY, "providerStatus"],
    ["corti", 400, undefined, "credentialsRejected"],
    ["corti", 400, "Bad Request", "credentialsRejected"],
    ["corti", 400, { message: "Unsupported model" }, "providerStatus"],
    ["corti", 401, CORTI_MALFORMED_HEADER, "credentialsRejected"],
    ["corti", 500, undefined, "providerStatus"],
  ];
  for (const [provider, status, body, errorCode] of cases) {
    const fetchImpl = async () => jsonResponse(status, body);
    const result = await testProviderConnection({ provider, apiKey: "made-up" }, fetchImpl);
    assert.equal(result.errorCode, errorCode, `${provider} ${status} ${JSON.stringify(body)}`);
    assert.equal(result.status, status);
  }
});

test("an error body that never arrives is a timeout or a network failure", async () => {
  const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  for (const [error, errorCode] of [
    [aborted, "timeout"],
    [new TypeError("terminated"), "network"],
  ]) {
    for (const provider of ["gemini", "xai", "corti"]) {
      const fetchImpl = async () => ({
        ok: false,
        status: 400,
        json: async () => {
          throw error;
        },
      });
      const result = await testProviderConnection({ provider, apiKey: "made-up" }, fetchImpl);
      assert.equal(result.errorCode, errorCode, `${provider} ${error.name}`);
    }
  }
});

test("a 401 or 403 is a rejection whatever its body does", async () => {
  let reads = 0;
  for (const provider of ["gemini", "xai", "corti"]) {
    for (const status of [401, 403]) {
      const fetchImpl = async () => ({
        ok: false,
        status,
        json: async () => {
          reads += 1;
          throw new TypeError("terminated");
        },
      });
      const result = await testProviderConnection({ provider, apiKey: "made-up" }, fetchImpl);
      assert.equal(result.errorCode, "credentialsRejected", `${provider} ${status}`);
    }
  }
  assert.equal(reads, 0, "the status alone decides");
});

test("the 12 s cap covers the whole answer, body included", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  // Like fetch's own promises, these settle only when the probe's signal aborts.
  const whenAborted = (signal) =>
    new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(aborted)));
  const stalls = {
    headers: (url, init) => whenAborted(init.signal),
    body: async (url, init) => ({ ok: false, status: 400, json: () => whenAborted(init.signal) }),
  };
  for (const [stage, fetchImpl] of Object.entries(stalls)) {
    const pending = testProviderConnection({ provider: "gemini", apiKey: "made-up" }, fetchImpl);
    await new Promise(setImmediate);
    t.mock.timers.tick(12000);
    const settled = await Promise.race([
      pending,
      new Promise((resolve) => setImmediate(resolve, { errorCode: "still pending" })),
    ]);
    assert.equal(settled.errorCode, "timeout", stage);
  }
});

test("other providers' error bodies are never read", async () => {
  let reads = 0;
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => {
      reads += 1;
      return { error: { message: "Incorrect API key provided: sk-ma****" } };
    },
  });
  for (const provider of ["openai", "groq", "mistral", "anthropic"]) {
    const result = await testProviderConnection({ provider, apiKey: "k" }, fetchImpl);
    assert.equal(result.errorCode, "providerStatus", provider);
  }
  assert.equal(reads, 0);
});

test("a Corti key of only spaces is never sent", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
  };
  const result = await testProviderConnection({ provider: "corti", apiKey: "   " }, fetchImpl);
  assert.equal(result.errorCode, "apiKeyRequired");
  assert.equal(calls, 0);
});

test("hosted providers refuse redirects; custom servers keep following them", async () => {
  const hosted = [
    "openai",
    "groq",
    "xai",
    "mistral",
    "anthropic",
    "gemini",
    "openrouter",
    "corti",
    "tinfoil",
  ];
  for (const provider of hosted) {
    assert.equal(resolveProviderRequest({ provider, apiKey: "k" }).redirect, "error", provider);
  }
  const custom = resolveProviderRequest({ provider: "custom", baseUrl: "http://localhost:1234" });
  assert.equal(custom.redirect, "follow");

  const { calls, fetchImpl } = recordingFetch(() => jsonResponse(200, { data: [{ id: "m" }] }));
  await testProviderConnection({ provider: "openai", apiKey: "k", model: "m" }, fetchImpl);
  assert.equal(calls[0].init.redirect, "error");
});

test("a hosted provider's redirect fails before the key reaches another host", async (t) => {
  const received = [];
  const target = await listen(t, (request, response) => {
    received.push(request.headers["x-api-key"]);
    response.end("{}");
  });
  const origin = await listen(t, (request, response) => {
    response.writeHead(302, { location: `${target}/v1/models` }).end();
  });
  const inits = [];
  // Only the host changes: the real request, headers and redirect mode go to the local origin.
  const viaOrigin = (url, init) => {
    inits.push(init);
    return fetch(`${origin}${new URL(url).pathname}`, init);
  };
  const config = { provider: "anthropic", apiKey: "sk-ant-test", model: "claude-test" };
  assert.equal((await testProviderConnection(config, viaOrigin)).errorCode, "network");
  assert.deepEqual(received, []);
  // The same request allowed to follow would hand the key over, so this test can fail.
  await fetch(`${origin}/v1/models`, { ...inits[0], redirect: "follow", signal: undefined });
  assert.deepEqual(received, ["sk-ant-test"]);
});

test("a custom server can still redirect within itself", async (t) => {
  const base = await listen(t, (request, response) => {
    if (request.url === "/v1/models") {
      response.writeHead(308, { location: "/v1/models/" }).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "local-model" }] }));
  });
  const config = { provider: "custom", baseUrl: `${base}/v1`, model: "local-model" };
  assert.deepEqual(await testProviderConnection(config), { success: true });
});

test("OpenRouter is checked at its key route, which a made-up key cannot pass", async () => {
  const request = resolveProviderRequest({ provider: "openrouter", apiKey: "sk-or-made-up" });
  assert.equal(request.endpoint, "https://openrouter.ai/api/v1/key");
  assert.equal(request.headers.Authorization, "Bearer sk-or-made-up");
  assert.equal(request.redirect, "error");
  for (const status of [401, 403]) {
    const fetchImpl = async () => jsonResponse(status, { error: { message: "User not found." } });
    const config = { provider: "openrouter", apiKey: "sk-or-made-up" };
    const result = await testProviderConnection(config, fetchImpl);
    assert.equal(result.errorCode, "credentialsRejected", String(status));
  }
});

test("an OpenRouter management key is refused, since it cannot run requests", async () => {
  for (const flag of ["is_management_key", "is_provisioning_key"]) {
    const fetchImpl = async () => jsonResponse(200, { data: { label: "admin", [flag]: true } });
    const config = { provider: "openrouter", apiKey: "k" };
    const result = await testProviderConnection(config, fetchImpl);
    assert.equal(result.errorCode, "credentialsRejected", flag);
  }
});

const ORDINARY_KEY = { data: { label: "laptop", is_free_tier: true, limit_remaining: null } };

test("any other OpenRouter key passes, with no model check", async () => {
  const { calls, fetchImpl } = recordingFetch(() => jsonResponse(200, ORDINARY_KEY));
  const config = { provider: "openrouter", apiKey: "sk-or-key", model: "anthropic/claude-test" };
  assert.deepEqual(await testProviderConnection(config, fetchImpl), { success: true });
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://openrouter.ai/api/v1/key"]
  );
  const unreadable = async () => jsonResponse(200, "not json");
  assert.deepEqual(await testProviderConnection(config, unreadable), { success: true });
  const outage = await testProviderConnection(config, async () => jsonResponse(503));
  assert.equal(outage.errorCode, "providerStatus");
});

// The key route answers 200 with the key's description. Any other 2xx carries no key to
// read, so an empty 204 must not pass as an ordinary key.
test("only a 200 from the OpenRouter key route can pass", async () => {
  const config = { provider: "openrouter", apiKey: "sk-or-key" };
  for (const status of [204, 202]) {
    const result = await testProviderConnection(config, async () => jsonResponse(status));
    assert.deepEqual(
      result,
      {
        success: false,
        errorCode: "providerStatus",
        error: `The provider returned status ${status}.`,
        status,
      },
      String(status)
    );
  }
});

const TINFOIL_MODELS = { data: [{ id: "voxtral-small-24b" }, { id: "gpt-oss-120b" }] };
const TINFOIL_KEY_ROUTE = "https://inference.tinfoil.sh/v1/embeddings";

function tinfoilFetch(keyAnswer, models = jsonResponse(200, TINFOIL_MODELS)) {
  return recordingFetch((url) => (url === TINFOIL_KEY_ROUTE ? keyAnswer() : models));
}

test("a made-up Tinfoil key is refused, though Tinfoil's model list is public", async () => {
  const { calls, fetchImpl } = tinfoilFetch(() => jsonResponse(401));
  const result = await testProviderConnection(
    { provider: "tinfoil", apiKey: " made-up ", model: "voxtral-small-24b" },
    fetchImpl
  );
  assert.equal(result.errorCode, "credentialsRejected");
  assert.deepEqual(
    calls.map((call) => [call.url, call.init.method]),
    [
      ["https://inference.tinfoil.sh/v1/models", "GET"],
      [TINFOIL_KEY_ROUTE, "POST"],
    ]
  );
  const keyCheck = calls[1].init;
  assert.equal(keyCheck.headers.Authorization, "Bearer made-up");
  assert.equal(keyCheck.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(keyCheck.body), { model: "nomic-embed-text", input: "." });
  assert.equal(keyCheck.redirect, "error");
});

test("Tinfoil's key check spends a token, so it runs through runPaidCheck", async () => {
  const paid = [];
  const runPaidCheck = async (key, check) => {
    paid.push(key);
    return check();
  };
  const { fetchImpl } = tinfoilFetch(() => jsonResponse(200, { data: [] }));
  assert.deepEqual(
    await testProviderConnection(
      { provider: "tinfoil", apiKey: " tf-key ", model: "gpt-oss-120b" },
      fetchImpl,
      runPaidCheck
    ),
    { success: true }
  );
  assert.deepEqual(paid, ["tf-key"], "keyed by the trimmed key");

  // A key the caller already paid for is not checked again.
  const { calls, fetchImpl: remembered } = tinfoilFetch(() => assert.fail("paid twice"));
  assert.deepEqual(
    await testProviderConnection(
      { provider: "tinfoil", apiKey: "tf-key", model: "gpt-oss-120b" },
      remembered,
      async () => ({ success: true })
    ),
    { success: true }
  );
  assert.equal(calls.length, 1, "the free model list still runs");
});

test("Tinfoil's model is checked on its public list before anything is paid for", async () => {
  for (const [models, errorCode] of [
    [jsonResponse(200, TINFOIL_MODELS), "modelNotFound"],
    [jsonResponse(503), "providerStatus"],
  ]) {
    const { calls, fetchImpl } = tinfoilFetch(() => assert.fail("paid"), models);
    const result = await testProviderConnection(
      { provider: "tinfoil", apiKey: "tf-key", model: "retired-model" },
      fetchImpl,
      () => assert.fail("paid")
    );
    assert.equal(result.errorCode, errorCode);
    assert.equal(calls.length, 1);
  }
});

test("a busy Tinfoil, or a retired check model, gives no verdict on the key", async () => {
  for (const status of [404, 429, 503]) {
    const { fetchImpl } = tinfoilFetch(() => jsonResponse(status));
    const result = await testProviderConnection(
      { provider: "tinfoil", apiKey: "tf-key", model: "gpt-oss-120b" },
      fetchImpl
    );
    assert.equal(result.errorCode, "providerStatus", String(status));
    assert.equal(result.unverified, true, String(status));
  }
  const { fetchImpl } = tinfoilFetch(() => jsonResponse(402));
  const unpaid = await testProviderConnection(
    { provider: "tinfoil", apiKey: "tf-key", model: "gpt-oss-120b" },
    fetchImpl
  );
  assert.equal(unpaid.status, 402);
  assert.equal(unpaid.unverified, undefined, "an account Tinfoil refuses is an answer");
});

test("a model list whose body never arrives is no verdict, not a missing model", async () => {
  const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  for (const [error, errorCode] of [
    [aborted, "timeout"],
    [new TypeError("terminated"), "network"],
  ]) {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw error;
      },
    });
    const result = await testProviderConnection(
      { provider: "openai", apiKey: "k", model: "gpt-test" },
      fetchImpl
    );
    assert.equal(result.errorCode, errorCode);
    assert.equal(result.unverified, true);
  }
  const unreadable = await testProviderConnection(
    { provider: "openai", apiKey: "k", model: "gpt-test" },
    async () => jsonResponse(200, "not json")
  );
  assert.equal(unreadable.errorCode, "modelNotFound", "a list that can't be read offers nothing");
});
