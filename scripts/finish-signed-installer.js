#!/usr/bin/env node
// Run by .github/workflows/release.yml after the Windows installer is built,
// and signed when SignPath is set up. Signing changes the installer's bytes,
// so the blockmap and the sha512/size in latest.yml, which the auto-updater
// checks, are made again here. The files to upload land in dist/release under
// the names latest.yml points to.
const fs = require("fs");
const path = require("path");

const [signedInstaller] = process.argv.slice(2);
if (!signedInstaller) {
  console.error("Usage: node scripts/finish-signed-installer.js <signed installer .exe>");
  process.exit(1);
}

const DIST = path.join(__dirname, "..", "dist");
const RELEASE = path.join(DIST, "release");

// electron-builder's own blockmap code, so the output matches a normal build.
const appBuilderLib = path.dirname(
  require.resolve("app-builder-lib/package.json", { paths: [require.resolve("electron-builder")] })
);
const { buildBlockMap } = require(path.join(appBuilderLib, "out/targets/blockmap/blockmap.js"));

(async () => {
  let latest = fs.readFileSync(path.join(DIST, "latest.yml"), "utf8");
  const name = latest.match(/^path: (.+)$/m)[1].trim();
  const oldSha = latest.match(/^sha512: (.+)$/m)[1].trim();

  fs.mkdirSync(RELEASE, { recursive: true });
  const installer = path.join(RELEASE, name);
  fs.copyFileSync(signedInstaller, installer);
  const { sha512, size } = await buildBlockMap(installer, "gzip", `${installer}.blockmap`);

  latest = latest.replaceAll(oldSha, sha512).replace(/^(\s+size:) \d+$/m, `$1 ${size}`);
  fs.writeFileSync(path.join(RELEASE, "latest.yml"), latest);
  console.log(`Signed installer ready: ${name} (${size} bytes)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
