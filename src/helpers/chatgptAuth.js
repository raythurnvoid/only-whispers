// Sign in with ChatGPT, so dictation cleanup runs on the user's ChatGPT plan
// ("token sharing" for open-source apps). Ported from OpenCode's
// packages/core/src/plugin/provider/chatgpt.ts. Docs:
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in
const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { app, shell } = require("electron");
const debugLogger = require("./debugLogger");
const secretCrypto = require("./secretCrypto");

const ISSUER = "https://auth.openai.com";
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = "https://api.openai.com/v1";
const SHARING_SCOPE = "chatgpt.tokens.use.direct";
// First sign-in registers a client owned by this user; OpenAI returns its ID on the callback.
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const AGENT_NAME = "only-whispers";
// OpenAI's docs ask for this port on the first (registration) sign-in.
const REGISTRATION_PORT = 1455;
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// { clientID, hostID, access?, refresh?, expires?, email? }; null once read and absent.
let saved;
let refreshing = null;

function authFile() {
  return path.join(app.getPath("userData"), "secure-keys", "CHATGPT_AUTH.enc");
}

async function load() {
  if (saved !== undefined) return saved;
  try {
    saved = JSON.parse(secretCrypto.decrypt(await fs.readFile(authFile())).value);
  } catch {
    saved = null;
  }
  return saved;
}

async function save(value) {
  saved = value;
  await fs.mkdir(path.dirname(authFile()), { recursive: true });
  await fs.writeFile(authFile(), secretCrypto.encrypt(JSON.stringify(value)));
}

async function status() {
  const current = await load();
  return { signedIn: !!current?.refresh, email: current?.email || "" };
}

async function signOut() {
  const current = await load();
  // Keep the registered client and host IDs so the next sign-in reuses them.
  if (current) await save({ clientID: current.clientID, hostID: current.hostID });
  return { signedIn: false };
}

async function signIn() {
  const current = (await load()) || {};
  const hostID = current.hostID || `urn:uuid:${crypto.randomUUID()}`;
  const savedID = current.clientID;
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");

  const server = http.createServer();
  const port = await listen(server, savedID ? 0 : REGISTRATION_PORT);
  const redirect = `http://127.0.0.1:${port}/auth/callback`;
  try {
    const callback = waitForCallback(server, state);
    await shell.openExternal(authorizeURL({ redirect, challenge, state, nonce, savedID, hostID }));
    const { code, clientID: returnedID, response } = await callback;
    try {
      if (savedID && returnedID && returnedID !== savedID) {
        throw new Error("ChatGPT returned a different client than this connection. Sign in again.");
      }
      const clientID = savedID || returnedID;
      if (!clientID) throw new Error("ChatGPT sign-in did not return a client ID. Sign in again.");
      const tokens = await tokenRequest({
        grant_type: "authorization_code",
        client_id: clientID,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        resource: RESOURCE,
      });
      if (!tokens.scope?.split(" ").includes(SHARING_SCOPE)) {
        throw new Error(
          "ChatGPT sign-in finished without plan sharing. Sign in again and allow it."
        );
      }
      if (!tokens.id_token) throw new Error("ChatGPT sign-in did not return an ID token.");
      const claims = await verifyIDToken(tokens.id_token, clientID, nonce);
      await save({ ...credential(tokens), clientID, hostID, email: claims.email || "" });
      response
        .writeHead(200, { "Content-Type": "text/html" })
        .end(page("You are signed in. You can close this tab."));
      debugLogger.info("ChatGPT sign-in done", { clientID }, "chatgpt");
      return status();
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/html" }).end(page(error.message));
      throw error;
    }
  } finally {
    server.close();
  }
}

// Returns a valid access token, refreshing it when it expires within a minute, or "" when signed out.
async function getAccessToken() {
  const current = await load();
  if (!current?.refresh) return "";
  if (current.expires > Date.now() + 60_000) return current.access;
  // One refresh at a time: the refresh token rotates, so a second refresh would use a spent token.
  refreshing ??= tokenRequest({
    grant_type: "refresh_token",
    client_id: current.clientID,
    refresh_token: current.refresh,
    resource: RESOURCE,
  })
    .then((tokens) => save({ ...current, ...credential(tokens) }))
    .finally(() => {
      refreshing = null;
    });
  try {
    await refreshing;
    return saved.access;
  } catch (error) {
    debugLogger.warn("ChatGPT token refresh failed", { error: error.message }, "chatgpt");
    return "";
  }
}

function credential(tokens) {
  return {
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function waitForCallback(server, state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("ChatGPT sign-in timed out.")),
      SIGN_IN_TIMEOUT_MS
    );
    server.on("request", (request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/auth/callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      clearTimeout(timer);
      const error = url.searchParams.get("error_description") || url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const message =
        error ||
        (!code
          ? "Missing authorization code"
          : url.searchParams.get("state") !== state
            ? "Invalid OAuth state"
            : "");
      if (message) {
        response.writeHead(400, { "Content-Type": "text/html" }).end(page(message));
        reject(new Error(message));
        return;
      }
      resolve({ code, clientID: url.searchParams.get("client_id") || undefined, response });
    });
  });
}

async function tokenRequest(body) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) throw new Error(`ChatGPT token request failed: ${response.status}`);
  return response.json();
}

async function verifyIDToken(token, clientID, nonce) {
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(
    token,
    createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`)),
    {
      issuer: ISSUER,
      audience: clientID,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "nonce", "sub"],
    }
  );
  if (payload.nonce !== nonce)
    throw new Error("ID token nonce does not match this sign-in attempt");
  return payload;
}

function authorizeURL({ redirect, challenge, state, nonce, savedID, hostID }) {
  const params = new URLSearchParams({
    client_id: savedID || REGISTRATION_CLIENT_ID,
    ...(savedID ? {} : { agent_name_hint: AGENT_NAME }),
    ext_agent_host_id: hostID,
    response_type: "code",
    redirect_uri: redirect,
    scope: `openid profile email offline_access resource.invoke ${SHARING_SCOPE}`,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return `${ISSUER}/api/accounts/authorize?${params}`;
}

function page(message) {
  const text = String(message).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>only-whispers</title><p style="font-family:sans-serif">${text}</p>`;
}

module.exports = { signIn, signOut, status, getAccessToken };
