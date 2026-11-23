const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { installInteractiveDom, findElement } = require("../lib/interactiveDom");

test("the sidebar shows an expired ChatGPT sign-in until the user signs in again", async (t) => {
  let root = null;
  t.after(() => root && React.act(async () => root.unmount())); // first: before globals go
  let sendStatus = null;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        chatgptStatus: async () => ({ signedIn: false, email: "", expired: true }),
        onChatGPTStatusChanged: (callback) => {
          sendStatus = callback;
          return () => {};
        },
      },
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "only-whispers-sidebar-chatgpt-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        const t = (key) => key;
        export function useTranslation() { return { t }; }
      `,
    },
  });
  const { default: ControlPanelSidebar } = await vite.ssrLoadModule(
    "/components/ControlPanelSidebar.tsx"
  );

  const container = installInteractiveDom(t);
  const opened = [];
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(ControlPanelSidebar, {
        activeView: "home",
        onViewChange() {},
        onOpenSettings: (section) => opened.push(section),
      })
    )
  );

  const text = () => container.textContent;
  assert.match(text(), /app\.toasts\.chatgptSignInExpired\.title/);

  // The link opens Settings at AI Models.
  const link = findElement(
    container,
    (element) =>
      element.tagName === "BUTTON" && element.textContent === "providerErrors.openSettings"
  );
  await React.act(async () => link.dispatchEvent({ type: "click", bubbles: true }));
  assert.deepEqual(opened, ["llms"]);

  // The plain Settings row still opens Settings where it was.
  const settings = findElement(
    container,
    (element) => element.tagName === "BUTTON" && element.textContent === "sidebar.settings"
  );
  await React.act(async () => settings.dispatchEvent({ type: "click", bubbles: true }));
  assert.deepEqual(opened, ["llms", undefined]);

  await React.act(async () => sendStatus({ signedIn: true, email: "me@example.com" }));
  assert.doesNotMatch(text(), /chatgptSignInExpired/);
});
