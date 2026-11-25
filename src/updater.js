const { app } = require("electron");
const { once } = require("node:events");
const { autoUpdater } = require("electron-updater");
const debugLogger = require("./helpers/debugLogger");

// Updates come from this repo's GitHub releases: the "publish" block in
// electron-builder.json, which the build writes into app-update.yml.
// Only the NSIS installer, the macOS app and an AppImage can replace
// themselves. Other Linux packages are updated outside the app.
// macOS updates pass Squirrel.Mac's signature check because every build is
// signed with the same self-signed certificate (.github/workflows/release.yml).
const isUpdaterSupported =
  process.platform === "win32" ||
  process.platform === "darwin" ||
  (process.platform === "linux" && !!process.env.APPIMAGE);

const STARTUP_DELAY_MS = 3000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

class UpdateManager {
  constructor() {
    this.windowManager = null;
    this.downloadedVersion = null;
    this.checking = null;
    this.isQuittingForUpdate = false;
    this.updateCheckInterval = null;
    this.handleBeforeQuitForUpdate = null;
  }

  setWindowManager(windowManager) {
    this.windowManager = windowManager;
  }

  // Downloads in the background and installs on quit; the control panel
  // offers a restart to apply it sooner.
  start() {
    if (!app.isPackaged || !isUpdaterSupported) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", (error) => {
      debugLogger.warn("Update check failed", { error: error?.message }, "updater");
    });

    // Emitted on Electron's own autoUpdater before any window closes.
    this.handleBeforeQuitForUpdate = () => {
      this.isQuittingForUpdate = true;
      if (this.windowManager) {
        this.windowManager.isQuitting = true;
        this.windowManager.hotkeyManager?.unregisterAll();
      }
    };
    require("electron").autoUpdater.on("before-quit-for-update", this.handleBeforeQuitForUpdate);

    const check = () => this.checkForUpdates();
    setTimeout(check, STARTUP_DELAY_MS);
    this.updateCheckInterval = setInterval(check, CHECK_INTERVAL_MS);
  }

  getDownloadedVersion() {
    return this.downloadedVersion;
  }

  async checkForUpdates() {
    const currentVersion = app.getVersion();
    if (!app.isPackaged) return { status: "dev", currentVersion };
    if (!isUpdaterSupported) return { status: "unsupported", currentVersion };
    if (this.downloadedVersion) {
      return { status: "ready", currentVersion, updateVersion: this.downloadedVersion };
    }

    // Electron's check resolves when the download starts. Share the download too.
    if (!this.checking) {
      this.checking = this.checkAndDownload(currentVersion).finally(() => {
        this.checking = null;
      });
    }
    return this.checking;
  }

  async checkAndDownload(currentVersion) {
    // The Mac download promise ends when the ZIP is served to Squirrel.
    // Only its native update-downloaded event confirms it passed verification.
    const controller = new AbortController();
    const verified =
      process.platform === "darwin"
        ? once(require("electron").autoUpdater, "update-downloaded", {
            signal: controller.signal,
          }).then(
            () => true,
            () => false
          )
        : true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) return { status: "error", currentVersion };
      if (!result.isUpdateAvailable) return { status: "current", currentVersion };
      if (!result.downloadPromise) return { status: "error", currentVersion };
      await result.downloadPromise;
      if (!(await verified)) return { status: "error", currentVersion };

      const version = result.updateInfo.version;
      this.downloadedVersion = version;
      debugLogger.info("Update downloaded", { version }, "updater");
      const win = this.windowManager?.controlPanelWindow;
      if (win && !win.isDestroyed()) win.webContents.send("update-downloaded", { version });
      return { status: "ready", currentVersion, updateVersion: version };
    } catch {
      return { status: "error", currentVersion };
    } finally {
      // Remove both native listeners even on a failed check or an up-to-date install.
      controller.abort();
    }
  }

  installUpdate() {
    if (!this.downloadedVersion) return false;
    // Silent on Windows, so the NSIS installer shows no wizard; relaunch after.
    // macOS ignores both arguments: Squirrel.Mac swaps the app and relaunches it.
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  cleanup() {
    clearInterval(this.updateCheckInterval);
    this.updateCheckInterval = null;
    if (this.handleBeforeQuitForUpdate) {
      require("electron").autoUpdater.removeListener(
        "before-quit-for-update",
        this.handleBeforeQuitForUpdate
      );
      this.handleBeforeQuitForUpdate = null;
    }
  }
}

module.exports = UpdateManager;
