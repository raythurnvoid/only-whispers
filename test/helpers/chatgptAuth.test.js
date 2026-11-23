const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const modulePath = require.resolve("../../src/helpers/chatgptAuth");
const originalLoad = Module._load;
const originalFetch = global.fetch;
test.afterEach(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
});

// Loads a fresh auth module whose saved sign-in has an expired access token.
// The stored file is plain JSON (secretCrypto is stubbed).
function loadAuth() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-auth-"));
  fs.mkdirSync(path.join(userData, "secure-keys"));
  fs.writeFileSync(
    path.join(userData, "secure-keys", "CHATGPT_AUTH.enc"),
    JSON.stringify({
      clientID: "client",
      hostID: "host",
      access: "old-access",
      refresh: "old-refresh",
      expires: Date.now() - 1000,
      email: "me@example.com",
    })
  );
  delete require.cache[modulePath];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (parent?.filename !== modulePath) return originalLoad.call(this, request, parent, isMain);
    if (request === "electron") return { app: { getPath: () => userData }, shell: {} };
    if (request === "./debugLogger") return { info() {}, warn() {} };
    if (request === "./secretCrypto") {
      return {
        encrypt: (text) => Buffer.from(text),
        decrypt: (buffer) => ({ value: buffer.toString() }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return require(modulePath);
}

test("a refresh token OpenAI refuses ends the sign-in and tells the windows once", async () => {
  const auth = loadAuth();
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  };
  let notified = 0;
  auth.onStatusChange(() => notified++);

  // Cleanup asks for a token from several places at once.
  const tokens = await Promise.all([
    auth.getAccessToken(),
    auth.getAccessToken(),
    auth.getAccessToken(),
  ]);

  assert.deepEqual(tokens, ["", "", ""]);
  assert.equal(notified, 1);
  assert.deepEqual(await auth.status(), {
    signedIn: false,
    email: "me@example.com",
    expired: true,
  });
  // The dead token is not sent again.
  assert.equal(await auth.getAccessToken(), "");
  assert.equal(calls, 1);
});

test("a refresh that fails offline keeps the sign-in for the next try", async () => {
  const auth = loadAuth();
  global.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  let notified = 0;
  auth.onStatusChange(() => notified++);

  assert.equal(await auth.getAccessToken(), "");
  assert.equal(notified, 0);
  assert.deepEqual(await auth.status(), {
    signedIn: true,
    email: "me@example.com",
    expired: false,
  });
});

test("a refresh that works returns the new token", async () => {
  const auth = loadAuth();
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
      { status: 200 }
    );

  assert.equal(await auth.getAccessToken(), "new-access");
  assert.equal((await auth.status()).expired, false);
});
