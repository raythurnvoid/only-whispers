const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { LocalSpeechModel } = require("../../src/helpers/localModel");

test("a failed model update keeps the old files and can be retried", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "only-whispers-model-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const files = ["encoder", "tokens"].map((file) => [
    file,
    file.length,
    createHash("sha256").update(file).digest("hex"),
  ]);
  const old = new LocalSpeechModel(dir, { model: "old", files, revision: "a".repeat(40) });
  const next = new LocalSpeechModel(dir, { model: "new", files, revision: "b".repeat(40) });
  let corrupt = false;
  const downloads = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const file = url.split("/").pop();
    downloads.push(file);
    return new Response(corrupt && file === "tokens" ? "broken" : file);
  });

  assert.equal((await old.getStatus()).state, "missing");
  await Promise.all([old.install(), old.install()]);
  assert.deepEqual(downloads, ["encoder", "tokens"]);
  await old.install();
  assert.equal(downloads.length, 2);

  corrupt = true;
  const update = next.install();
  assert.equal((await next.getStatus()).state, "downloading");
  await assert.rejects(update, /checksum/);
  assert.equal((await next.getStatus()).state, "error");
  assert.equal((await old.getStatus()).state, "ready");
  assert.equal(await next.isInstalled(), false);
  assert.deepEqual(await next.installedModel(), { model: "old", directory: old.directory });

  corrupt = false;
  downloads.length = 0;
  const installed = await next.install();
  assert.deepEqual(downloads, ["tokens"]);
  assert.equal(installed.state, "ready");
  assert.equal(installed.downloadedBytes, installed.totalBytes);
  assert.deepEqual(await next.installedModel(), { model: "new", directory: next.directory });
  assert.deepEqual(await fs.readdir(next.root), [path.basename(next.directory)]);
  assert.equal(await fs.readFile(path.join(next.directory, "tokens"), "utf8"), "tokens");
});
