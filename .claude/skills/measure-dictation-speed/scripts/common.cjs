// Shared helpers for the speed scripts: repo paths, the app's stored keys, and a check
// that results are not written inside the repo.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "../../../..");
const fromRepo = (mod) => require(path.join(REPO, "node_modules", mod));

// Electron's userData folder for the app (productName "only-whispers").
const USER_DATA =
  process.platform === "win32"
    ? path.join(process.env.APPDATA, "only-whispers")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support/only-whispers")
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "only-whispers"
        );

// Results and converted audio go to the current folder, which must be outside the repo.
function checkWorkDir() {
  const rel = path.relative(REPO, process.cwd());
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    console.error(
      `Run this from a folder outside the repo (for example ${path.basename(REPO)}-+personal/+ai/<task>-<date>/).`
    );
    process.exit(1);
  }
}

// Reads a key the app saved (secretCrypto.js: AES-256-GCM, master key in the OS keyring).
// Read-only. Never print the values.
function readSecret(name) {
  const { Entry } = fromRepo("@napi-rs/keyring");
  const master = Buffer.from(
    new Entry("only-whispers", "secrets-master-key").getPassword(),
    "base64"
  );
  const blob = fs.readFileSync(path.join(USER_DATA, "secure-keys", `${name}.enc`));
  const d = crypto.createDecipheriv("aes-256-gcm", master, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
}

module.exports = {
  REPO,
  USER_DATA,
  fromRepo,
  checkWorkDir,
  mistralKey: () => readSecret("MISTRAL_API_KEY"),
  // Never refresh this token from a script: a refresh replaces the refresh token the
  // app keeps, and the app is then signed out. If it expired, dictate once in the app.
  chatgpt: () => JSON.parse(readSecret("CHATGPT_AUTH")),
};

if (require.main === module) {
  const c = module.exports.chatgpt();
  console.log({
    mistralKeyLength: module.exports.mistralKey().length,
    chatgptExpiresInMin: Math.round((c.expires - Date.now()) / 60000),
  });
}
