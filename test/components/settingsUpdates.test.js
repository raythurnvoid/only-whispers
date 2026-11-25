const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { installInteractiveDom } = require("../lib/interactiveDom");

test("opening Settings checks for updates and offers retry or restart", async (t) => {
  let root;
  t.after(() => root && React.act(async () => root.unmount()));
  const checks = [];
  let downloaded;
  let restarts = 0;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        checkForUpdates: () => {
          const request = Promise.withResolvers();
          checks.push(request);
          return request.promise;
        },
        onUpdateDownloaded: (listener) => {
          downloaded = listener;
          return () => {
            downloaded = null;
          };
        },
        installUpdate: async () => ++restarts > 1,
      },
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-settings-updates-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation = () => ({ t: (key, args) => key + (args?.version ? " " + args.version : "") });`,
      "/ui/SidebarModal": "export default function Modal({ children }) { return children; }",
      "/SettingsPage": "export default function Page({ activeSection }) { return activeSection; }",
    },
  });
  const { default: SettingsModal } = await vite.ssrLoadModule("/components/SettingsModal.tsx");
  const container = installInteractiveDom(t);
  root = createRoot(container);
  const open = (key, initialSection) =>
    React.act(async () => {
      root.render(
        React.createElement(SettingsModal, { key, initialSection, open: true, onOpenChange() {} })
      );
    });
  const click = (label) =>
    React.act(async () => {
      const button = container
        .querySelectorAll("button")
        .find((item) => item.textContent === label);
      assert.ok(button, label);
      button.dispatchEvent({ type: "click", bubbles: true });
    });
  const settle = (status) =>
    React.act(async () => {
      checks.at(-1).resolve({ status, currentVersion: "1.0.0" });
    });

  await open("linked", "speechToText");
  assert.equal(checks.length, 1, "even a named Settings link starts a check");
  assert.equal(container.textContent, "llms");
  await open("normal");
  assert.equal(checks.length, 2);
  assert.match(container.textContent, /controlPanel.update.checking/);
  await settle("error");
  assert.match(container.textContent, /controlPanel.update.installed 1.0.0/);
  assert.match(container.textContent, /controlPanel.update.error/);
  await click("common.retry");
  assert.equal(checks.length, 3);
  await settle("current");
  assert.match(container.textContent, /controlPanel.update.current/);

  await click("controlPanel.update.check");
  await React.act(async () => downloaded({ version: "1.1.0" }));
  await settle("current"); // An older check must not hide the downloaded update.
  assert.match(container.textContent, /controlPanel.update.readyTitleVersion 1.1.0/);
  await click("controlPanel.update.restart");
  assert.match(container.textContent, /controlPanel.update.installError/);
  await click("controlPanel.update.restart");
  assert.match(container.textContent, /controlPanel.update.restarting/);
  assert.equal(restarts, 2);

  for (const status of ["dev", "unsupported"]) {
    await open(status);
    await settle(status);
    assert.ok(container.textContent.includes("controlPanel.update." + status));
    assert.equal(container.querySelectorAll("button").length, 0);
  }
});
