const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("an ended ChatGPT sign-in shows a card that hides by itself", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  let sendStatus = null;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onChatGPTStatusChanged: (callback) => {
          sendStatus = callback;
          return () => {};
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "only-whispers-chatgpt-toast-" });
  const { useMainProcessNotifications } = await vite.ssrLoadModule(
    "/hooks/useMainProcessNotifications.tsx"
  );

  const toasts = [];
  const toast = (props) => {
    toasts.push(props);
    return `toast-${toasts.length}`;
  };
  function Harness() {
    useMainProcessNotifications({ toast, dismiss() {}, t: (key) => key });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));

  // A sign-in or sign-out shows nothing.
  await React.act(async () => sendStatus({ signedIn: true, email: "me@example.com" }));
  assert.equal(toasts.length, 0);

  await React.act(async () => sendStatus({ signedIn: false, email: "", expired: true }));
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, "app.toasts.chatgptSignInExpired.title");
  assert.ok(toasts[0].duration > 0, "the card must not stay until closed");
});
