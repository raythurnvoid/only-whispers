const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Linux can composite on the CPU, where a backdrop blur is redrawn on every repaint above it
// (#2298). The harness renders i18n keys verbatim; the assertions only read classes.
async function loadModule(t, file, platform) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: `only-whispers-backdrop-blur-${platform}-test-`,
    mockModules: { "/utils/platform": `export const getCachedPlatform = () => "${platform}";` },
  });
  return vite.ssrLoadModule(file);
}

test("a settings panel draws no backdrop blur on any platform", async (t) => {
  // It sits on a solid pane, so the blur showed nothing, and scrolling Settings redrew it
  // under every card on each frame.
  const mod = await loadModule(t, "/components/ui/SettingsSection.tsx", "darwin");
  const html = renderToStaticMarkup(createElement(mod.SettingsPanel, null, "row"));

  assert.doesNotMatch(html, /backdrop-blur/);
});
