const { app } = require("electron");
const { autoUpdater } = require("electron-updater");
const debugLogger = require("./helpers/debugLogger");

// Updates come from this repo's GitHub releases: the "publish" block in
// electron-builder.json, which the build writes into app-update.yml.
// Only the NSIS installer and an AppImage can replace themselves. macOS needs
// a signed app, and deb/rpm/tar.gz installs update through the package manager.
const isUpdaterSupported =
  process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE);

const STARTUP_DELAY_MS = 3000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

class UpdateManager {
  constructor() {
    this.windowManager = null;
    this.downloadedVersion = null;
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
    autoUpdater.on("update-downloaded", (info) => {
      this.downloadedVersion = info?.version || null;
      debugLogger.info("Update downloaded", { version: this.downloadedVersion }, "updater");
      const win = this.windowManager?.controlPanelWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send("update-downloaded", { version: this.downloadedVersion });
      }
    });
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

    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(check, STARTUP_DELAY_MS);
    this.updateCheckInterval = setInterval(check, CHECK_INTERVAL_MS);
  }

  getDownloadedVersion() {
    return this.downloadedVersion;
  }

  installUpdate() {
    if (!this.downloadedVersion) return false;
    // Silent on Windows, so the NSIS installer shows no wizard; relaunch after.
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
