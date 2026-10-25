const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const calls = [];
const originalLoad = Module._load;
Module._load = function loadTrayWithStubs(request, parent, isMain) {
  if (request === "electron") {
    return { Tray: class {}, Menu: {}, nativeImage: {}, app: { quit: () => calls.push("quit") } };
  }
  if (request === "./debugLogger") {
    return {
      info: () => undefined,
      debug: () => undefined,
      error: (message) => calls.push(message),
    };
  }
  if (request === "./dockManager") return {};
  if (request === "./i18nMain") return { i18nMain: { t: (key) => key } };
  return originalLoad.call(this, request, parent, isMain);
};
const TrayManager = require("../../src/helpers/tray");
Module._load = originalLoad;

function createTrayManager() {
  const trayManager = new TrayManager();
  const controlPanel = {
    isDestroyed: () => false,
    on: () => undefined,
    webContents: { isCrashed: () => false, send: (channel) => calls.push(channel) },
  };
  trayManager.windowManager = {
    controlPanelWindow: controlPanel,
    showControlPanel: () => calls.push("show-control-panel"),
  };
  return trayManager;
}

test("the tray menu has only Show Control Panel and Quit", () => {
  const items = createTrayManager().buildContextMenuTemplate();

  assert.deepEqual(
    items.map((item) => item.label),
    ["tray.showControlPanel", "tray.quit"]
  );
});

test("Show Control Panel opens the panel on Home", async () => {
  calls.length = 0;
  const [show] = createTrayManager().buildContextMenuTemplate();

  await show.click();
  assert.deepEqual(calls, ["show-control-panel", "show-home"]);
});

test("Quit quits the app", () => {
  calls.length = 0;
  const [, quit] = createTrayManager().buildContextMenuTemplate();

  quit.click();
  assert.deepEqual(calls, ["quit"]);
});
