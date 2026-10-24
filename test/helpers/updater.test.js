const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const updaterModulePath = require.resolve("../../src/updater.js");
const originalLoad = Module._load;
const originalPlatform = process.platform;

function makeAutoUpdater() {
  const autoUpdater = {
    checks: 0,
    installs: [],
    listeners: {},
    on(event, handler) {
      autoUpdater.listeners[event] = handler;
    },
    checkForUpdates() {
      autoUpdater.checks += 1;
      return Promise.resolve();
    },
    quitAndInstall(...args) {
      autoUpdater.installs.push(args);
    },
  };
  return autoUpdater;
}

// updater.js requires electron lazily too, so the mocks stay until the test ends.
function createUpdateManager(t, { isPackaged = true, platform = "win32" } = {}) {
  const autoUpdater = makeAutoUpdater();
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  delete require.cache[updaterModulePath];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron-updater") return { autoUpdater };
    if (request === "electron") {
      return { app: { isPackaged }, autoUpdater: { on() {}, removeListener() {} } };
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
  return { manager, autoUpdater, sent };
}

test("a dev run never checks for updates", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater } = createUpdateManager(t, { isPackaged: false });
  manager.start();
  t.mock.timers.tick(5 * 60 * 60 * 1000);
  assert.equal(autoUpdater.checks, 0);
  manager.cleanup();
});

test("an installed app checks at launch and every 4 hours", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater } = createUpdateManager(t);
  manager.start();
  t.mock.timers.tick(3000);
  assert.equal(autoUpdater.checks, 1);
  t.mock.timers.tick(4 * 60 * 60 * 1000);
  assert.equal(autoUpdater.checks, 2);
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  manager.cleanup();
});

test("a downloaded update tells the control panel and can install now", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { manager, autoUpdater, sent } = createUpdateManager(t);
  manager.start();
  assert.equal(manager.installUpdate(), false, "nothing to install yet");

  autoUpdater.listeners["update-downloaded"]({ version: "0.2.0" });

  assert.deepEqual(sent, [{ channel: "update-downloaded", payload: { version: "0.2.0" } }]);
  assert.equal(manager.getDownloadedVersion(), "0.2.0");
  assert.equal(manager.installUpdate(), true);
  assert.deepEqual(autoUpdater.installs, [[true, true]]);
  manager.cleanup();
});
