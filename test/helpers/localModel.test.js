const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { LocalSpeechModel } = require("../../src/helpers/localModel");

test("warm starts the installed recognizer before the first clip and skips a missing model", async (t) => {
  const model = new LocalSpeechModel(os.tmpdir());
  const installed = { model: "local", directory: model.directory };
  const available = t.mock.method(model, "installedModel", async () => null);
  const worker = t.mock.method(model, "getWorker", () => ({}));
  assert.equal(await model.warm(), false);
  assert.equal(worker.mock.callCount(), 0);

  available.mock.mockImplementation(async () => installed);
  assert.equal(await model.warm(), true);
  assert.deepEqual(
    worker.mock.calls.map(({ arguments: args }) => args),
    [[model.directory]]
  );
});

test("live recordings deliver every byte in order and keep file jobs in the same queue", async (t) => {
  const model = new LocalSpeechModel(os.tmpdir());
  const calls = [];
  t.mock.method(model, "run", async (audio) => {
    if (typeof audio === "string") {
      calls.push(audio);
      return { text: "file" };
    }
    const chunks = [];
    for await (const chunk of audio) chunks.push(chunk);
    calls.push(Buffer.concat(chunks).toString());
    return { text: "live" };
  });
  const live = model.startRecording();
  const file = model.transcribe("next file");
  await live.write(Buffer.from("one"));
  await live.write(Buffer.from("two"));
  assert.deepEqual(await live.finish(), { text: "live" });
  assert.deepEqual(await file, { text: "file" });
  assert.deepEqual(calls, ["onetwo", "next file"]);
});

test("cancelling a queued recording settles its blocked write and finish before the worker is free", async () => {
  const model = new LocalSpeechModel(os.tmpdir());
  let release;
  model.queue = new Promise((resolve) => {
    release = resolve;
  });
  const live = model.startRecording();
  const write = live.write(Buffer.alloc(128 * 1024));
  const result = live.finish();
  live.cancel();
  try {
    await Promise.all([
      assert.rejects(write, { name: "AbortError" }),
      assert.rejects(result, { name: "AbortError" }),
    ]);
  } finally {
    release();
  }
  await model.queue;
});

test("live input overflow abandons the recording and allows another queued job", async () => {
  const model = new LocalSpeechModel(os.tmpdir());
  const live = model.startRecording();
  await assert.rejects(live.write(Buffer.alloc(1024 * 1024 + 1)), /input is full/);
  await assert.rejects(live.finish(), /input is full/);
  await model.queue;
});

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
