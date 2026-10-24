// Builds the Windows installer and publishes it as a GitHub release.
// The release is made as a draft first: electron-builder uploads the installer
// and its blockmap at the same time, and without an existing release each
// upload tries to create it, so one fails with a 422 and latest.yml is lost.
const { execFileSync } = require("child_process");
const { version } = require("../package.json");

const REPO = "raythurnvoid/only-whispers";
const tag = `v${version}`;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", shell: true });

process.env.GH_TOKEN ||= execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();

try {
  execFileSync("gh", ["release", "view", tag, "--repo", REPO], { stdio: "ignore" });
} catch {
  run("gh", ["release", "create", tag, "--repo", REPO, "--draft", "--title", version]);
}

run("pnpm", ["run", "build:win", "--publish", "always"]);
run("gh", ["release", "edit", tag, "--repo", REPO, "--draft=false", "--latest"]);
