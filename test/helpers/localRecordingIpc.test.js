const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

const handlers = new Map();
const ipcPath = require.resolve("../../src/helpers/ipcHandlers");
const model = {};
const electron = {
  app: { getPath: () => "/tmp", getVersion: () => "test", on() {} },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
};
const load = Module._load;
let IPCHandlers;
test.before(() => {
  Module._load = function (name, parent, main) {
    if (name === "electron") return electron;
    if (name === "./localModel" && parent.filename === ipcPath) return model;
    return load.call(this, name, parent, main);
  };
  IPCHandlers = require(ipcPath);
});
test.after(() => {
  Module._load = load;
});

function setup() {
  const sender = Object.assign(new EventEmitter(), { mainFrame: {} });
  const event = { sender, senderFrame: sender.mainFrame };
  const id = 1;
  const result = { text: "local words", model: "test", modelRevision: "v3" };
  const chunks = [];
  let startCount = 0;
  const session = {
    write: async (bytes) => {
      chunks.push([...bytes]);
    },
    finish: test.mock.fn(async () => result),
    cancel: test.mock.fn(),
  };
  model.startLocalRecording = () => {
    startCount++;
    return session;
  };
  IPCHandlers.prototype.setupHandlers.call({
    windowManager: { mainWindow: { webContents: sender } },
  });
  const write = (data, from = event, key = id) =>
    handlers.get("write-local-recording-chunk")(from, key, data);
  const finish = (from = event, key = id) => handlers.get("finish-local-recording")(from, key);
  const cancel = (from = event, key = id) => handlers.get("cancel-local-recording")(from, key);
  return {
    sender,
    event,
    id,
    result,
    chunks,
    session,
    starts: () => startCount,
    write,
    finish,
    cancel,
  };
}

test("the main dictation frame owns the chunks, result and cancellation", async () => {
  const { sender, event, result, chunks, session, starts, write, finish, cancel } = setup();
  const other = Object.assign(new EventEmitter(), { mainFrame: {} });
  const foreign = [
    { sender: other, senderFrame: other.mainFrame },
    { sender, senderFrame: {} },
  ];
  for (const caller of foreign) assert.equal(await write(Uint8Array.of(9), caller), false);
  for (const invalid of ["1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await write(Uint8Array.of(4), event, invalid), false);
  }
  assert.equal(starts(), 0);
  assert.equal(await write(Uint8Array.of(1, 2).buffer), true);
  const otherId = 2;
  for (const caller of foreign) {
    assert.equal(await finish(caller), null);
    await cancel(caller);
  }
  assert.equal(await write(Uint8Array.of(9), event, otherId), false);
  assert.equal(await finish(event, otherId), null);
  await cancel(event, otherId);
  assert.equal(
    session.cancel.mock.callCount(),
    0,
    "another frame or ID must not cancel this session"
  );
  assert.equal(await write(Uint8Array.of(3)), true);
  assert.deepEqual(chunks, [[1, 2], [3]]);
  assert.deepEqual(await finish(), { ...result, source: "parakeet" });
  assert.equal(await finish(), null);
  assert.equal(
    await write(Uint8Array.of(4)),
    false,
    "late tail bytes must not start a new recording"
  );
  assert.equal(starts(), 1);
});

test("finish waits for the last chunk, and a cancelled result stays discarded", async () => {
  const { session, write, finish, cancel, starts } = setup();
  const written = Promise.withResolvers();
  session.write = () => written.promise;
  const pendingWrite = write(Uint8Array.of(1));
  const pendingFinish = finish();
  assert.equal(session.finish.mock.callCount(), 0);
  written.resolve();
  assert.equal(await pendingWrite, true);
  assert.ok(await pendingFinish);

  const next = 2;
  const finished = Promise.withResolvers();
  session.finish = () => finished.promise;
  assert.equal(await write(Uint8Array.of(2), undefined, next), true);
  const lateResult = finish(undefined, next);
  await Promise.resolve();
  await cancel(undefined, next);
  assert.equal(session.cancel.mock.callCount(), 1);
  finished.resolve({ text: "discard me" });
  assert.equal(await lateResult, null);
  assert.equal(await write(Uint8Array.of(3), undefined, next), false);
  const neverStarted = 3;
  await cancel(undefined, neverStarted);
  assert.equal(await write(Uint8Array.of(3), undefined, neverStarted), false);
  assert.equal(starts(), 2);
});

test("a failed or overlapping write falls back without accepting a partial result", async () => {
  const { session, write, finish } = setup();
  session.write = async () => {
    throw new Error("worker failed");
  };
  assert.equal(await write(Uint8Array.of(1)), false);
  assert.equal(await finish(), null);
  const next = 2;
  const pending = Promise.withResolvers();
  session.write = () => pending.promise;
  const first = write(Uint8Array.of(2), undefined, next);
  assert.equal(await write(Uint8Array.of(3), undefined, next), false);
  assert.equal(session.cancel.mock.callCount(), 2);
  pending.resolve();
  assert.equal(await first, false);
  assert.equal(await finish(undefined, next), null);
});

test("a late first write cannot reopen an older recording", async () => {
  const { write, finish, cancel, starts } = setup();
  const chunk = Uint8Array.of(1);
  await cancel(undefined, 7);
  assert.equal(await write(chunk, undefined, 6), false, "cancel must also reject older IDs");
  assert.equal(await write(chunk, undefined, 8), true);
  assert.equal(await finish(undefined, 10), null);
  assert.equal(
    await write(chunk, undefined, 8),
    true,
    "the active recording can still accept chunks"
  );
  assert.ok(await finish(undefined, 8));
  assert.equal(await write(chunk, undefined, 9), false, "finish must also reject older IDs");
  assert.equal(await write(chunk, undefined, 11), true);
  assert.equal(starts(), 2);
});

test("closing, reloading or crashing the renderer releases its recording", async () => {
  for (const name of ["destroyed", "did-navigate", "render-process-gone"]) {
    const { sender, event, write, session, finish } = setup();
    assert.equal(await write(Uint8Array.of(1)), true);
    sender.emit(name);
    assert.equal(session.cancel.mock.callCount(), 1, name);
    assert.equal(sender.listenerCount("destroyed"), 0, name);
    sender.mainFrame = {};
    assert.equal(await finish(event), null);
    if (name !== "destroyed") {
      const newPage = { sender, senderFrame: sender.mainFrame };
      assert.equal(await write(Uint8Array.of(1), newPage), true, "IDs start over on a new page");
      assert.ok(await finish(newPage));
    }
  }
});
