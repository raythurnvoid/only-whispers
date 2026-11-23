const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("a newer release replaces the update toast instead of adding a second one", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  let sendUpdate = null;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getDownloadedUpdate: async () => "1.2.0",
        onUpdateDownloaded: (callback) => {
          sendUpdate = callback;
          return () => {};
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "only-whispers-update-toast-" });
  const { useUpdateReadyToast } = await vite.ssrLoadModule("/hooks/useUpdateReadyToast.ts");

  // A small stand-in for the toast list: ids in, titles out.
  const open = new Map();
  let nextId = 0;
  const toast = (props) => {
    const id = `toast-${++nextId}`;
    open.set(id, props);
    return id;
  };
  const dismiss = (id) => {
    open.get(id)?.onClose?.();
    open.delete(id);
  };
  const tr = (key, params) => (params ? `${key} ${params.version}` : key);

  function Harness() {
    useUpdateReadyToast({ toast, dismiss, t: tr });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  // An update downloaded before the window opened shows at once.
  assert.deepEqual(
    [...open.values()].map((props) => props.title),
    ["controlPanel.update.readyTitleVersion 1.2.0"]
  );

  await React.act(async () => sendUpdate({ version: "1.3.0" }));
  await React.act(async () => sendUpdate({ version: "1.4.0" }));
  assert.deepEqual(
    [...open.values()].map((props) => props.title),
    ["controlPanel.update.readyTitleVersion 1.4.0"]
  );

  // After the user closes it, the next release shows a new toast.
  dismiss([...open.keys()][0]);
  await React.act(async () => sendUpdate({ version: "1.5.0" }));
  assert.deepEqual(
    [...open.values()].map((props) => props.title),
    ["controlPanel.update.readyTitleVersion 1.5.0"]
  );
});
