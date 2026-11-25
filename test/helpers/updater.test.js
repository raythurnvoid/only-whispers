const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const updaterModulePath = require.resolve("../../src/updater.js");
const originalLoad = Module._load;
const originalPlatform = process.platform;

function makeAutoUpdater() {
  const autoUpdater = Object.assign(new EventEmitter(), {
    checks: 0,
    installs: [],
    checkForUpdates() {
      autoUpdater.checks += 1;
      return Promise.resolve({ isUpdateAvailable: false });
    },
    quitAndInstall(...args) {
      autoUpdater.installs.push(args);
    },
  });
  return autoUpdater;
}

// updater.js requires electron lazily too, so the mocks stay until the test ends.
function createUpdateManager(t, { isPackaged = true, platform = "win32" } = {}) {
  const autoUpdater = makeAutoUpdater();
  const nativeUpdater = new EventEmitter();
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  delete require.cache[updaterModulePath];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron-updater") return { autoUpdater };
    if (request === "electron") {
      return {
        app: { isPackaged, getVersion: () => "0.1.0" },
        autoUpdater: nativeUpdater,
      };
    }
    if (request === "./helpers/debugLogger") return { info() {}, warn() {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    delete require.cache[updaterModulePath];
  });
  const UpdateManager = require(updaterModulePath);
  const sent = [];
  const manager = new UpdateManager();
  manager.setWindowManager({
    controlPanelWindow: {
      isDestroyed: () => false,
      webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
    },
  });
  return { manager, autoUpdater, nativeUpdater, sent };
}

test("a dev run never checks for updates", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater } = createUpdateManager(t, { isPackaged: false });
  manager.start();
  t.mock.timers.tick(5 * 60 * 60 * 1000);
  assert.deepEqual(await manager.checkForUpdates(), { status: "dev", currentVersion: "0.1.0" });
  assert.equal(autoUpdater.checks, 0);
  manager.cleanup();
});

test("an install without updater support never checks", async (t) => {
  const { manager, autoUpdater } = createUpdateManager(t, { platform: "freebsd" });
  manager.start();
  assert.deepEqual(await manager.checkForUpdates(), {
    status: "unsupported",
    currentVersion: "0.1.0",
  });
  assert.equal(autoUpdater.checks, 0);
  manager.cleanup();
});

test("an installed app checks at launch and every 4 hours", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater } = createUpdateManager(t);
  manager.start();
  t.mock.timers.tick(3000);
  assert.equal(autoUpdater.checks, 1);
  await new Promise(setImmediate);
  t.mock.timers.tick(4 * 60 * 60 * 1000);
  assert.equal(autoUpdater.checks, 2);
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  manager.cleanup();
});

test("Settings joins a background download and keeps the ready update for restart", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater } = createUpdateManager(t);
  const download = Promise.withResolvers();
  const check = t.mock.method(autoUpdater, "checkForUpdates", async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: "0.2.0" },
    downloadPromise: download.promise,
  }));
  manager.start();
  t.mock.timers.tick(3000);
  await new Promise(setImmediate);

  const fromSettings = manager.checkForUpdates();
  assert.equal(check.mock.callCount(), 1);
  download.resolve();
  const ready = { status: "ready", currentVersion: "0.1.0", updateVersion: "0.2.0" };
  assert.deepEqual(await fromSettings, ready);
  assert.deepEqual(await manager.checkForUpdates(), ready);
  assert.equal(check.mock.callCount(), 1);
  manager.cleanup();
});

test("macOS offers restart only after Squirrel verifies the downloaded update", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater, nativeUpdater, sent } = createUpdateManager(t, {
    platform: "darwin",
  });
  const info = { version: "0.2.0" };
  t.mock.method(autoUpdater, "checkForUpdates", async () => ({
    isUpdateAvailable: true,
    updateInfo: info,
    downloadPromise: Promise.resolve(),
  }));
  manager.start();
  const failed = manager.checkForUpdates();
  autoUpdater.emit("update-downloaded", info);
  await new Promise(setImmediate);
  assert.equal(manager.installUpdate(), false);
  assert.deepEqual(sent, []);
  nativeUpdater.emit("error", new Error("verification failed"));
  assert.deepEqual(await failed, { status: "error", currentVersion: "0.1.0" });

  const retry = manager.checkForUpdates();
  autoUpdater.emit("update-downloaded", info);
  nativeUpdater.emit("update-downloaded");
  assert.deepEqual(await retry, {
    status: "ready",
    currentVersion: "0.1.0",
    updateVersion: info.version,
  });
  assert.deepEqual(sent, [{ channel: "update-downloaded", payload: info }]);
  assert.equal(manager.installUpdate(), true);
  manager.cleanup();
});

test("Settings can retry a failed check and a failed download", async (t) => {
  const { manager, autoUpdater } = createUpdateManager(t);
  const check = t.mock.method(autoUpdater, "checkForUpdates", async () => {
    throw new Error("offline");
  });
  const error = { status: "error", currentVersion: "0.1.0" };
  assert.deepEqual(await manager.checkForUpdates(), error);
  check.mock.mockImplementation(async () => ({
    isUpdateAvailable: true,
    downloadPromise: Promise.reject(new Error("download failed")),
  }));
  assert.deepEqual(await manager.checkForUpdates(), error);
  check.mock.mockImplementation(async () => ({ isUpdateAvailable: false }));
  assert.deepEqual(await manager.checkForUpdates(), { status: "current", currentVersion: "0.1.0" });
  assert.equal(check.mock.callCount(), 3);
});

test("a downloaded update tells the control panel and can install now", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater, sent } = createUpdateManager(t);
  t.mock.method(autoUpdater, "checkForUpdates", async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: "0.2.0" },
    downloadPromise: Promise.resolve(),
  }));
  manager.start();
  assert.equal(manager.installUpdate(), false, "nothing to install yet");

  await manager.checkForUpdates();

  assert.deepEqual(sent, [{ channel: "update-downloaded", payload: { version: "0.2.0" } }]);
  assert.equal(manager.getDownloadedVersion(), "0.2.0");
  assert.equal(manager.installUpdate(), true);
  assert.deepEqual(autoUpdater.installs, [[true, true]]);
  manager.cleanup();
});
