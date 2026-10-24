const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const popups = [];

const originalLoad = Module._load;
Module._load = function loadWindowManagerWithStubs(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: { on: () => undefined },
      Menu: {
        buildFromTemplate: (template) => ({
          popup: (options) => popups.push({ template, options }),
        }),
      },
    };
  }
  if (request === "./debugLogger") return {};
  if (request === "./hotkeyManager") return class {};
  if (request === "./dragManager") return class {};
  if (request === "./menuManager") return {};
  if (request === "./devServerManager") return {};
  if (request === "./dockManager") return {};
  if (request === "./i18nMain") return { i18nMain: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const WindowManager = require("../../src/helpers/windowManager");
Module._load = originalLoad;

function rightClick(params) {
  popups.length = 0;
  let handler = null;
  const window = {
    webContents: {
      on: (event, callback) => {
        if (event === "context-menu") handler = callback;
      },
    },
  };
  new WindowManager().registerEditContextMenu(window);
  handler({}, params);
  return { window, popups: [...popups] };
}

const ALL_EDIT_FLAGS = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

test("right-click in a text field shows cut, copy, paste and select all", () => {
  const { window, popups } = rightClick({
    isEditable: true,
    selectionText: "",
    editFlags: { ...ALL_EDIT_FLAGS, canCut: false, canCopy: false },
  });

  assert.equal(popups.length, 1);
  assert.equal(popups[0].options.window, window);
  assert.deepEqual(
    popups[0].template.map((item) => [item.role ?? item.type, item.enabled]),
    [
      ["cut", false],
      ["copy", false],
      ["paste", true],
      ["separator", undefined],
      ["selectAll", true],
    ]
  );
});

test("right-click on selected page text offers copy only", () => {
  const { popups } = rightClick({
    isEditable: false,
    selectionText: "hello",
    editFlags: ALL_EDIT_FLAGS,
  });

  assert.deepEqual(
    popups.map((popup) => popup.template),
    [[{ role: "copy" }]]
  );
});

test("right-click on plain page content shows no menu", () => {
  const { popups } = rightClick({
    isEditable: false,
    selectionText: " ",
    editFlags: ALL_EDIT_FLAGS,
  });

  assert.deepEqual(popups, []);
});
