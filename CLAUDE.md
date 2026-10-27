# only-whispers Technical Reference for AI Assistants

This document provides comprehensive technical details about the only-whispers project architecture for AI assistants working on the codebase.

## Response Style

Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer. When asked to explain something, give a high-level summary unless an in-depth explanation is specifically requested.

## Development process

- Change the code, commit straight to `main`, and push (`git push origin main`). Never push to `upstream`.
- No feature branches and no pull requests, except a short-lived `ci/<topic>` PR to test a change on CI (below).
- No commit message format. Write a short, simple message.
- Tests on every system: the Test workflow (`.github/workflows/test.yml`) builds the native helpers and runs `pnpm test` on Linux, macOS and Windows, plus lint, type check and translations. It runs on every push to `main` and on every PR. Many tests run on one system only, and this PC can't run the Linux or macOS ones (WSL can't use the Windows `node_modules`).
  - To check a change before it reaches `main` (always for macOS or Linux code, or a native helper): push it to a `ci/<topic>` branch, `gh pr create`, wait with `gh pr checks --watch` (right after creating the PR it can say "no checks reported"; wait a few seconds and run it again), fix failures with more commits on the branch, then `gh pr merge --squash --delete-branch`. A run's failed logs: `gh run view <id> --log-failed`
  - After a direct push to `main`, check its run too: `gh run list --workflow test.yml --branch main --limit 1`, then `gh run watch <id> --exit-status`
  - In CI a native helper that doesn't compile fails the job (`CI` is set), instead of falling back to a downloaded binary. `windows-fast-paste` still downloads first; its own workflow (`build-windows-fast-paste.yml`) compiles it on PRs and on `main`
  - Locally, `pnpm test` skips the database tests, since better-sqlite3 is built for Electron. CI builds it for Node and sets `REQUIRE_DB_TESTS=1`, so a skip fails there (`test/helpers/harness/db.js`; database tests must use its `createDb`). To run a database test file here, use Electron's Node from Git Bash: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe --test <file>`
- Build or release only when the user asks. Local builds are unsigned: `pnpm run prebuild:win`, `pnpm run build:renderer`, then `pnpm exec electron-builder --win --config electron-builder.unsigned-win.json`. For day-to-day checks run the app in dev mode (`pnpm dev`) instead of building.
- Release: bump `version` in `package.json`, commit and push, then `gh workflow run release.yml` (`.github/workflows/release.yml`, manual; about 20 minutes) and check the release when it ends. Run it with `-f publish=false` to build and check without releasing. Releases are never made from this PC. It builds Windows and macOS (Apple Silicon) and publishes one GitHub release on `raythurnvoid/only-whispers` with both installers, `latest.yml` and `latest-mac.yml`, which installed apps read to auto-update (`src/updater.js`: checks 3 s after launch and every 4 hours, downloads in the background, installs on quit; the control panel shows a toast to restart now).
  - Windows: unsigned until SignPath is set up. SignPath Foundation signing is free but needs the project approved on signpath.org, the `SIGNPATH_API_TOKEN` secret and `SIGNPATH_ORGANIZATION_ID` variable, and the artifact configurations in `.signpath/`. With the secret, the job signs the app folder, builds the installer from it with `--prepackaged` and signs the installer. Either way `scripts/finish-signed-installer.js` puts the installer under `latest.yml`'s name (dashes; the built file has spaces) and remakes the blockmap and sha512, since signing changes the installer's bytes. The README's "Code signing policy" section is a SignPath requirement.
  - macOS: signed with a free self-signed certificate ("Only Whispers Code Signing", made 2026-10-25, valid 20 years), not notarized, so users click "Open Anyway" once. The `.p12` and its password are the `MACOS_CERT_P12_BASE64` and `MACOS_CERT_PASSWORD` secrets; the user keeps a copy in their password manager. The public certificate is `.github/macos-codesign-cert.pem`, which the runner trusts for code signing. Never change the certificate or the `appId`: Squirrel.Mac installs an update only when its designated requirement matches the running app, and macOS keeps the Microphone and Accessibility permissions only then. The job compares it to `.github/macos-designated-requirement.txt` and fails on any change. A local Mac build without the certificate: `-c.mac.identity=-` (ad-hoc, cannot update).
- Website: `website/` is the static landing page at `only-whispers.bonobo-senate.com`, a Cloudflare Worker with static assets (`website/wrangler.jsonc`). A push to `main` that changes `website/` deploys it (`.github/workflows/deploy-website.yml`, which needs a Cloudflare API token and the account id in the repo settings). The token expires every 7 days, so rotate it: the `setup-website-deploy` skill (`.claude/skills/`, committed with `git add -f`, since `.gitignore` keeps other agent skills local) sets the token, secret and variable up again. By hand: `vp env exec pnpm dlx wrangler deploy` from `website/`. SignPath asks for the "Code signing policy" link in its footer.
- Use pnpm only (never npm, npx or bun). Run Node tools through Vite Plus: `vp env exec pnpm ...`.

## Project Overview

only-whispers is an Electron desktop dictation app for Windows, macOS and Linux. Hold the hotkey (Ctrl+Win by default on Windows and Linux), speak, and the cleaned-up text is pasted into the focused app. Speech-to-text runs on Mistral (Voxtral). Cleanup runs only on OpenAI Luna through the user's ChatGPT plan ("Sign in with ChatGPT"); if it fails, the raw transcript is pasted. There are no other AI providers and no local models.

### Hidden in this release

These features are still in the code, but their UI is hidden in this release. They are kept so they can come back later. Do not describe them as live features.

- The voice assistant: the assistant panel and chat (`AssistantPanel.tsx`, `src/components/chat/`), its tools, the `voiceAgent` hotkey slot and the "Hey [AgentName]" wake word. `resolveReasoningRoute` in `audioManager.js` always passes `agentInvoked: false`, and `main.js` does not register a saved `voiceAgent` hotkey at startup (sections 6 and 15)
- Screen context (section 15), Tone & Style (section 16), media pause while dictating (`pauseMediaOnDictation`, no toggle), email drafts and the macOS permission guide
- Snippets (`SnippetsView.tsx` is not mounted), `ui/PromptStudio.tsx`, and `settings/DictationAgentSettings.tsx`, `settings/ChatAgentSettings.tsx` and `settings/ToneStyleSection.tsx` (nothing imports them)

## Architecture Overview

### Core Technologies

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite
- **Desktop Framework**: Electron 41 with context isolation
- **Database**: better-sqlite3 for local transcription history
- **UI Components**: shadcn/ui with Radix primitives
- **Speech Processing**: Mistral Voxtral API
- **Audio Processing**: FFmpeg (bundled via ffmpeg-static)
- **Node.js**: 24 (pinned in `.nvmrc`, run through Vite Plus)

### Key Architectural Decisions

1. **Dual Window Architecture**:
   - Main Window: Minimal overlay for dictation (draggable, always on top)
   - Control Panel: Full settings interface (normal window)
   - Both use same React codebase with URL-based routing

2. **Process Separation**:
   - Main Process: Electron main, IPC handlers, database operations
   - Renderer Process: React app with context isolation
   - Preload Script: Secure bridge between processes

3. **Audio Pipeline**:
   - MediaRecorder API → Blob → ArrayBuffer → IPC → Mistral speech-to-text → cleanup → paste
   - Automatic cleanup of temporary files after processing

## File Structure and Responsibilities

### Main Process Files

- **main.js**: Application entry point, initializes all managers
- **preload.js**: Exposes safe IPC methods to renderer via window.api

### Native Resources (resources/)

- **windows-key-listener.c**: Windows low-level keyboard hook (Push-to-Talk)
- **windows-fast-paste.c**: Windows paste helper; `--detect-only` also reports the target window (used by Tone & Style)
- **windows-text-monitor.c**: Windows text-field monitor
- **linux-key-listener.c**, **linux-fast-paste.c**, **linux-text-monitor.c**: Linux key listener, paste helper and text-field monitor
- **macos-globe-listener.swift**, **macos-fast-paste.swift**, **macos-text-monitor.swift**, **macos-mic-listener.swift**, **macos-media-remote.swift**: macOS Globe/Fn key listener, paste helper, text monitor, mic listener and media control
- **macos-window-bounds.swift**: Swift source for the System Settings window reporter used by the macOS permission guide (hidden). Prints the dialog's bounds, whether a sheet or authorization prompt is in front, which app owns the front window (`settings` / `self` / `other`, attributed by process because window owner names are localized) and whether System Settings is running. CoreGraphics window list only, so it needs neither Accessibility nor Screen Recording
- **mediaremote-adapter/**: vendored macOS media control adapter, used by `mediaPlayer.js`
- **bin/**: compiled or downloaded native binaries (nircmd, key listeners, paste helpers, text monitors)

### Helper Modules (src/helpers/)

- **audioManager.js**: Handles audio device management
- **clipboard.js**: Cross-platform clipboard operations
  - macOS: AppleScript-based paste with accessibility permission check
  - Windows: native windows-fast-paste, then PowerShell SendKeys (nircmd.exe is used only if present; builds no longer ship it, since it is closed source)
  - All platforms: a dictation pastes into what has focus at paste time, never the window or app from record start (macOS no longer re-activates it). Before pasting, `selectionManager.isFocusWritable()` asks the text monitor (`--probe-editable`/`--editable-target` with `--allow-selection`, since a selection in the field is fine) whether the focus is a writable text field, and checks whether it is a terminal. Neither → no paste (`reason: "no-text-field"`): the text stays in the history and goes to the clipboard, unless Settings → General → Pasting turns that off (`copyUnpastedToClipboard`, default on)
    - The optional paste-last hotkey (`pasteLast` slot, Settings → Hotkeys, no default) pastes the newest completed history item into the focus through the same `paste-text` check: main sends `paste-last-transcript` to the pill window, and `useAudioRecording` reads the history and calls `safePaste`. It is ignored while a dictation runs
    - Windows (`--detect-only` for the terminal check) refuses a focus it can't confirm
    - macOS (frontmost app) and Linux (`_getLinuxTarget()` and its pid) refuse only a confirmed `NOT_EDITABLE`: an `UNKNOWN` or `NO_ELEMENT` answer (a dormant Chromium tree, an app without AT-SPI) or one slower than 800 ms still pastes. Not yet tested on a real Mac or Linux desktop
  - Linux: compositor-aware Wayland paste (Hyprland sendshortcut, wlroots wtype, GNOME/KDE portal keysyms) with native uinput/XTest and system-tool fallbacks. KDE's portal paste sends Shift+Insert to every window but Warp, which binds paste to Ctrl+Shift+V only: KWin resolves keysyms in the active layout only, so a Ctrl+V on a non-Latin layout arrives as Ctrl alone (#2055). The app runs on XWayland, which the compositor won't let read a native Wayland app's clipboard while a Wayland window is focused, so `_saveClipboard` falls back to `wl-paste --type text` when Electron reads nothing; otherwise the restore would wipe the user's clipboard. On KDE it also takes wl-paste's UTF-8 plain text whenever it differs from Electron's, since KWin can leave a stale X11 owner in place after a Wayland app copies, so a rich or image restore first writes the original's text (empty for an image) to Wayland, or the app's own transcript or selection sentinel left there would read as newer. A Wayland-only copy with no plain text (a screenshot copied in Spectacle) isn't saved, so a dictation replaces it with X11's older text
  - Linux: wlroots, Hyprland and niri (xwayland-satellite) hand XWayland's clipboard to a native Wayland app only while an X11 window has focus; Mutter, COSMIC and KWin 6.0.3+ do it themselves (KDE also writes the transcript and primary selection with `wl-copy`, and Settings asks for wl-clipboard there too, since `_saveClipboard` reads the Wayland clipboard there with `wl-paste`). There (`requiresWlCopy` in `linuxSession.js`; a leftover `SWAYSOCK` or Hyprland signature under another desktop doesn't count) the transcript reaches Wayland apps only through `wl-copy`, so `_pasteText` pastes only when wl-copy wrote both the Wayland clipboard (`_writeClipboardWayland`) and the primary selection that terminals paste on Shift+Insert (`_writePrimarySelection`). `wl-copy --primary` goes through data-control, which still takes a primary selection under niri `disable-primary` (checked on niri 26.04) and Hyprland `middle_click_paste = false` (its data-control code never reads that option). Otherwise it injects nothing and returns `reason: "wl-copy-missing"` (not installed) or `"wl-copy-failed"` (e.g. killed by its 200 ms timeout): the renderer shows the dictation-error pill (Retry writes and pastes the kept text again, never records), a selection edit reports `code: "wl_copy_missing"`/`"wl_copy_failed"`, and the paste-tools card and Settings → Wayland Paste Setup ask for wl-clipboard (#2621). There, a missing `wl-copy` is probed again rather than read from the 30 s command cache, so one installed after a held-back paste counts at once
  - Linux COSMIC: paste reads the focused app from cosmic-comp's `zcosmic_toplevel_info_v1` (`cosmicToplevel.js`, a minimal Wayland wire client, bound at version 1, which still sends app_id and state), never from xdotool, whose XWayland answer goes stale while a native Wayland window has focus. A known terminal is pasted through wtype (Ctrl+Shift+V; Shift+Insert for Konsole); everything else keeps uinput Shift+Insert, since COSMIC gives no PID to spot Electron apps hosting TUIs. Short terminal names (`st`) match whole words only, or every `com.system76.*` app id would read as a terminal
  - Linux: before any paste or selection-copy chord, `linux-fast-paste --capabilities --await-modifier-release <ms>` waits for physically held modifiers to be released (XKB state on X11, `EVIOCGKEY` on Wayland; `unknown` without `/dev/input` access pastes as before). A chord injected into held keys arrives as a different shortcut, and a virtual device cannot release another device's key (#2113). Still held after 1.5 s → not pasted, `reason: "modifiers-held"`, and the renderer shows the dictation-error pill with the transcript on the clipboard; a selection edit blocked the same way reports `code: "modifiers_held"` and gets the same pill (the assistant caret paste reports the same code, for logs only). `ydotoold`'s virtual keyboard is ignored, since an interrupted chord can leave its modifier down, and an unreadable key state is logged once per session. The wait runs before `pasteLinux` detects the target window, and a selection copy that had to wait looks the target up again, since focus can move while a key is held: a fresh capture then runs the command on its own (`focus_moved`), and a revalidated session declines as `target_changed`. Retry on a modifiers-held pill pastes the kept transcript again rather than recording again (the macOS/Windows push force-stop pill keeps its record-again Retry, since neither platform waits for held keys), ignores clicks while its paste is pending, and never dismisses a newer pill. `useAudioRecording` keeps the pill in processing until the paste attempt settles (the audio manager settles before the paste starts), but never reports that to main, which drops dictation hotkeys while processing; a paste held back after the next dictation started leaves the transcript on the clipboard without a pill. The helper measures its wait on `CLOCK_MONOTONIC`, since the JS watchdog kills it at timeout + 1 s
- **database.js**: SQLite operations for transcription history
- **transcriptionRoute.ts**: Mistral is the only speech-to-text provider. Picks the Voxtral model (default `voxtral-mini-transcribe-3-0`) and holds Mistral's 25 MB upload limit. Shared by dictation, Retry and Upload
- **mistralRealtimeStreaming.js**: Mistral realtime transcription session; sends the custom dictionary as `context_bias`
- **chatgptAuth.js**: "Sign in with ChatGPT" (OAuth token sharing). The login is stored encrypted at `userData/secure-keys/CHATGPT_AUTH.enc`
- **debugLogger.js**: Debug logging system with file output
- **providerHttpErrors.js**: Pure ESM classifier for BYOK provider failures (transcription and AI models), shared by main (require(esm)) and renderer. `providerHttpError({ provider, status, body, headers, model, surface, selfHosted })` builds an Error carrying `code` (`PROVIDER_AUTH_FAILED`, `PROVIDER_QUOTA_EXHAUSTED`, …), `messageKey` (`providerErrors.*`), `messageParams`, `settingsTarget` (`speechToText`/`llms`, fixable errors only) and redacted `technicalDetails`; `asProviderError` classifies AI SDK, timeout and network errors and leaves already-keyed errors alone. Raw provider bodies never reach UI text. Rendered by `src/utils/describeProviderError.ts`
- **devServerManager.js**: Vite dev server integration
- **dockManager.js**: Single owner of the macOS Dock icon
  - The icon follows the control panel: it appears when the panel opens and goes away when the panel closes to the tray, so no other caller (in particular the dictation panel's hide path) can resurrect it
  - Every path that surfaces or hides the control panel reports that state explicitly: openers (tray, app menu, deep links, `activate`, second instance, first show) go through `windowManager.showControlPanel()`, hiding through `hideControlPanelToTray()`
  - `showControlPanel()` reports the Dock before restoring, showing and focusing the window: on an active app `dock.show()` activates the Dock and then re-activates the app, which macOS does not honour, so a window surfaced first is left behind the previously frontmost app
  - `showControlPanel()` calls `show()` even on an open panel, since on macOS that activates the app and `focus()` does not. A hidden panel is still shown
  - `app.dock.show()`/`hide()` run only when the requested state differs from `app.dock.isVisible()`, so reopening an already open panel never triggers that Dock hand-off
  - Never derive that state from the window's `show`/`hide` events: on macOS those are occlusion events, so they also fire when the panel is merely covered by another window, minimized, or on another Space, and the icon flickers as the user switches windows
  - Decision logic lives in `dockPolicy.js` (pure)
- **dragManager.js**: Window dragging functionality
- **environment.js**: Environment variable and OpenAI API management
- **hotkeyManager.js**: Global hotkey registration and management
  - Named hotkey slots: `dictation`, `pasteLast` (paste the newest transcript; `PASTE_LAST_KEY`, GNOME/Hyprland D-Bus method `PasteLast`) and `voiceAgent` (voice assistant, hidden: not registered at startup)
  - Handles platform-specific defaults (GLOBE on macOS, Control+Super on Windows/Linux)
  - Auto-fallback to F8/F9 if default hotkey is unavailable
  - Notifies renderer via IPC when hotkey registration fails
  - Integrates with GnomeShortcutManager for GNOME Wayland support
  - Integrates with HyprlandShortcutManager for Hyprland Wayland support
  - Integrates with KDEShortcutManager for KDE Wayland support
- **gnomeShortcut.js**: GNOME Wayland global shortcut integration
  - Uses D-Bus service to receive hotkey toggle commands
  - Registers shortcuts via gsettings (visible in GNOME Settings → Keyboard → Shortcuts)
  - Converts Electron hotkey format to GNOME keysym format
  - Only active on Linux + Wayland + GNOME desktop
  - D-Bus transport: `@homebridge/dbus-native` (pure JavaScript, no native addons)
- **hyprlandShortcut.js**: Hyprland Wayland global shortcut integration
  - Uses D-Bus service to receive hotkey toggle commands (same `com.raythurnvoid.OnlyWhispers` service)
  - Registers shortcuts via `hyprctl keyword bind` (runtime keybinding)
  - Converts Electron hotkey format to Hyprland bind format (`MODS, key`)
  - Only active on Linux + Wayland + Hyprland (detected via `HYPRLAND_INSTANCE_SIGNATURE`)
  - D-Bus transport: `@homebridge/dbus-native` (pure JavaScript, no native addons)
- **kdeShortcut.js**: KDE Wayland global shortcut integration
  - Uses D-Bus to communicate with KGlobalAccel for global hotkey registration
  - Registers hotkeys via `setShortcut`/`doRegister` D-Bus calls on the KGlobalAccel interface
  - Listens for `globalShortcutPressed` signals to trigger callbacks
  - Converts Electron hotkey format to Qt key codes
  - Only active on Linux + KDE desktop (detected via `XDG_CURRENT_DESKTOP`)
  - D-Bus transport: `@homebridge/dbus-native` (pure JavaScript, no native addons)
- **autoStart.js**: Single entry point for launch at login, used by `main.js`
  - There is no launch-at-login toggle in the UI today: `getAutoStartState()` and `setAutoStartEnabled()` have no caller. `main.js` still calls `wasLaunchedAtLoginHidden()` and `syncAutoStartEntry()`
  - Dispatches to `setLoginItemSettings()` on macOS/Windows and to `linuxAutostart.js` on Linux
  - `getAutoStartState()` returns `{ enabled, requiresApproval }`; `requiresApproval` is macOS-only and means SMAppService registered the item but the user has not allowed it under System Settings → General → Login Items yet
  - `wasLaunchedAtLoginHidden()` decides whether this launch should go straight to the tray
  - `syncAutoStartEntry()` runs from `initializeCoreManagers()` and repairs entries written by older builds
  - Decision logic lives in `autoStartPolicy.js` (pure)
- **autoStartPolicy.js**: Electron-free launch-at-login decisions
  - `HIDDEN_LAUNCH_FLAG` (`--hidden`) is how a login launch tells the app to start in the tray. Windows has no native equivalent (`openAsHidden` is macOS-only and a no-op on macOS 13+), so the flag rides on the login item's `args`; Linux puts it on the autostart entry's `Exec`; macOS uses `wasOpenedAtLogin` instead
  - On Windows, read the state from `executableWillLaunchAtLogin`, never from `openAtLogin`: `openAtLogin` only compares the `Run` value against the current executable and args and ignores the `StartupApproved` key that Task Manager and Settings write when a user disables a startup app
  - Reads and writes must pass identical `args`, or `openAtLogin` always reports false
- **linuxAutostart.js**: Launch-at-login on Linux via an XDG autostart entry
  - `app.setLoginItemSettings()` is a no-op on Linux, so the entry is written directly to `$XDG_CONFIG_HOME/autostart/only-whispers.desktop`, matching the executable name electron-builder packages under
  - `Exec` resolves from `$APPIMAGE` first: `process.execPath` is the ephemeral AppImage FUSE mount
  - `isAutostartEnabled()` honors `X-GNOME-Autostart-enabled=false` and `Hidden=true`, which GNOME Tweaks and KDE's autostart editor write in place instead of deleting the file
  - `Exec` carries `--hidden` (see `autoStartPolicy.js`), and `syncAutostartEntry()` compares against the full value including that flag — comparing against the bare path would make every launch look stale
  - `syncAutostartEntry()` runs from `autoStart.syncAutoStartEntry()` in `initializeCoreManagers()` and re-points a stale `Exec` after the executable moves (renamed or auto-updated AppImage); it never re-enables an entry the user disabled, and no-ops in development
- **ipcHandlers.js**: Centralized IPC handler registration
- **windowsKeyManager.js**: Windows Push-to-Talk support with native key listener
  - Spawns native `windows-key-listener.exe` binary for low-level keyboard hooks
  - Supports compound hotkeys (e.g., `Ctrl+Shift+F11`, `CommandOrControl+Space`)
  - Emits `key-down` and `key-up` events for push-to-talk functionality
  - Graceful fallback if binary unavailable
- **menuManager.js**: Application menu management
- **toneAppCategories.js**: Tone & Style's app classifier (hidden feature) (pure, `test/helpers/toneAppCategories.test.js`): an app identity, window title and page host map to `personal`, `work`, `email` or `other` (see Tone & Style)
- **tray.js**: System tray icon and menu (Show Control Panel, Quit). Windows uses the Night icon (`src/assets/icon-night.ico`) for the tray and the app
- **windowConfig.js**: Centralized window configuration
- **plasmaWorkAreas.js**: Per-monitor work areas on KDE Plasma. On X11 and XWayland, Chromium clips only the primary display with the single root `_NET_WORKAREA`, which KWin builds from every monitor's panels at once (#1110). This asks plasmashell over D-Bus (`evaluateScript`) for each screen's always-visible panels and rebuilds each display's `workArea` for the dictation pill, its companion windows and dragging. On X11, Qt reports a screen's origin in device pixels and only its size scaled, so those origins are divided by the display scale before matching. It refreshes on display events and each time a dictation shows the pill, retrying after 1, 5 and 15 s when plasmashell isn't ready; a display event starts those retries over. An auto-placed pill re-anchors when the result changes; a dragged one stays put. With a single display, or outside Linux + KDE, Chromium's work area is used as is
- **windowManager.js**: Window creation and lifecycle management
- **connectors/emailCompose.js**: Builds Gmail, Outlook and mailto compose links (shared ESM, used by the email draft target; hidden feature)
- **permissionGuideManager.js**: macOS permission overlay (hidden feature) — a frameless always-on-top window anchored to the bottom of the System Settings window (placement in `permissionGuidePlacement.js`, pure), polled one read at a time via `settingsWindowState.js` (exec of `macos-window-bounds`). Steps aside for authorization prompts, other apps and a dialog on another Space; closes when the dialog closes; never subscribes to the control panel's `hide` (occlusion fires it), so `hideControlPanelToTray()` closes it explicitly

### React Components (src/components/)

- **App.jsx**: Dictation pill window with recording states
- **ControlPanel.tsx**: Main window: Home (history with Retry and Upload), Dictionary, Logs and Settings
- **AppSetup.tsx**: First-run setup: the Mistral API key and ChatGPT sign-in
- **SettingsPage.tsx**: Settings interface, with three sections: `general`, `hotkeys` and `llms` ("AI Models": the Mistral key and cleanup)
- **HistoryView.tsx**, **DictionaryView.tsx**, **LogsView.tsx**: Control panel views (**SnippetsView.tsx** is hidden)
- **ChatGPTSignIn.tsx**: ChatGPT sign-in button and state
- **dictation/**: The pill (`VoicePill.tsx`), the assistant panel (hidden) and the live transcript panel
- **ui/**: Reusable UI components (buttons, cards, inputs, etc.)

### React Hooks (src/hooks/)

- **useAudioRecording.js**: MediaRecorder API wrapper with error handling
- **useAssistantPanel.js**: Assistant panel lifecycle (hidden feature) (open/close choreography, thinking flourish, footer phases, pending voice commands, conversation session boundaries)
- **useLiveTranscriptPanel.js**: Live transcript panel lifecycle (entrance choreography, buffered text scheduler, measure-then-reveal resize pipeline, preview IPC wiring)
- **useMainWindowSizeOwner.js**: Single owner of the main window size ladder (panel > menu > toast > pill > base) and the dictation-error pill handoff
- **useWindowResizeCompensation.js**: Masks split native setBounds frames via CSS-variable counter-translation
- **useMainProcessNotifications.tsx**: Main-process notifications (hotkey fallback, hotkey failure, learned corrections) as toasts
- **useClipboard.ts**: Clipboard operations hook
- **useDialogs.ts**: Electron dialog integration
- **useHotkey.js**: Hotkey state management
- **useLocalStorage.ts**: Type-safe localStorage wrapper
- **usePermissions.ts**: Accessibility permission (macOS) and Linux paste tools. The microphone is not here (see the microphone screen in section 9)
- **useMicrophoneCheck.ts**: Whether the app can use a mic, for the microphone screen (section 9)
- **useSettings.ts**: Application settings management

### Services

- **ReasoningService.ts**: AI processing for cleanup (`processText`) and the hidden assistant's chat stream (`processTextStreamingAI`)
  - The provider registry in `src/services/ai/inferenceProviders/index.ts` has only `openai`, which implements the `InferenceProvider` interface from `types.ts`
  - The chat stream uses the ChatGPT plan token as its key when the user is signed in; an OpenAI API key is the fallback
  - Per-scope LLM config: scopes are defined in `src/config/inferenceScopes.ts` (`dictationCleanup`, `dictationAgent`, `dictationAgentVision`, `chatIntelligence`)
  - `selectResolvedLLMConfig(state, scope)` in `settingsStore.ts` resolves provider/model per scope with fallback chains
- **ai/chatgptPlan.ts**: Cleanup on the user's ChatGPT plan (Responses API, WebSocket first, then HTTP). There is no fallback model: on a failure the raw transcript is pasted with the cleanup-failed toast

### Speech-to-Text (Mistral)

- Mistral Voxtral is the only speech-to-text provider (`transcriptionRoute.ts`). Any `voxtral-*` model can be set; the default is `voxtral-mini-transcribe-3-0`
- The key is `MISTRAL_API_KEY`, entered on the setup screen or in Settings, and stored encrypted like the other secrets
- Upload refuses files over 25 MB (Mistral's limit)

### Build Scripts (scripts/)

- **download-nircmd.js**: Downloads nircmd.exe (closed source, not shipped in builds; kept so it can be brought back)
- **download-windows-key-listener.js**: Downloads prebuilt Windows key listener binary
- **download-windows-fast-paste.js**, **download-text-monitor.js**: Download the prebuilt Windows paste helper and the text monitors. All prebuilt helpers come from the `raythurnvoid/only-whispers` GitHub releases
- **sync-nucleo-icons.js**: Regenerates `src/components/icons/` from `nucleo-map.json` using the local Nucleo install (`~/.nucleo/skills`); only the icons the app uses are vendored
- **build-globe-listener.js**: Compiles macOS Globe key listener from Swift source
- **build-macos-mic-listener.js**: Compiles macOS mic listener from Swift source
- **build-macos-window-bounds.js**: Compiles the System Settings window reporter from Swift source
- **build-windows-key-listener.js**: Compiles the Windows key listener (MSVC, MinGW or clang) whenever `compile:native` runs on a Windows host, downloading the prebuilt binary when no compiler works; skips a binary newer than its source
- **run-electron.js**: Development script to launch Electron with proper environment
- **lib/download-utils.js**: Shared utilities for downloading and extracting files
  - `fetchLatestRelease(repo, options)`: Fetches latest release from GitHub API
  - `downloadFile(url, dest)`: Downloads file with progress and retry logic
  - `extractZip(zipPath, destDir)`: Cross-platform zip extraction
  - Supports `GITHUB_TOKEN` for authenticated requests (higher rate limits)

## Key Implementation Details

### 1. FFmpeg Integration

FFmpeg is bundled with the app and doesn't require system installation:

```javascript
// FFmpeg is unpacked from ASAR to app.asar.unpacked/node_modules/ffmpeg-static/
```

### 2. Audio Recording Flow

1. User presses hotkey → MediaRecorder starts
2. Audio chunks collected in array
3. User presses hotkey again → Recording stops
4. Blob created from chunks → Converted to ArrayBuffer
5. The audio goes to Mistral for speech-to-text
6. The text is cleaned up by the cleanup model (see Services), then pasted into the focused app

### 3. Database Schema

```sql
CREATE TABLE transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  original_text TEXT NOT NULL,
  processed_text TEXT,
  is_processed BOOLEAN DEFAULT 0,
  processing_method TEXT DEFAULT 'none',
  agent_name TEXT,
  error TEXT
);
```

### 4. Settings Storage

Settings stored in localStorage with these keys:

- `preferredLanguage`: Selected language code
- `agentName`: User's custom agent name (hidden assistant)
- `cleanupModel`, `cleanupProvider`: The cleanup model and provider (only `gpt-6-luna` on `openai` exists). Older `reasoningModel`/`reasoningProvider` keys are migrated to these once
- `dictationKey`: Custom dictation hotkey
- `pasteLastKey`: The paste-last hotkey (empty when unset; main holds the registered one in `PASTE_LAST_KEY`)
- `copyUnpastedToClipboard`: Put a dictation on the clipboard when no text field has focus (default on)
- `onboardingCompleted`: First-run setup completion flag
- `customDictionary`: JSON array of words/phrases for improved transcription accuracy
- `toneStyleEnabled`, `toneStyles`: whether Tone & Style is on and the tone picked per kind of app (JSON, normalized by `normalizeToneStyles`). Hidden: there is no UI to change them in this release
- `emailDraftTarget`: Where email drafts open (hidden feature) (`auto`, `gmail`, `gmailSend`, `outlookWork`, `outlookPersonal`, `mailto`); an unknown value reads as `auto`

Secret keys (the BYOK API keys in `src/config/secretKeys.js`, see `SECRET_KEYS` in `environment.js`) are encrypted at rest via Electron `safeStorage` (`secretCrypto.js`) and stored as per-key files under `userData/secure-keys/`. They are loaded into `process.env` at startup by `EnvironmentManager.init()`. Renderer reads them via IPC (`get-*-key`) and writes via debounced IPC (`save-*-key`). On Linux without a keyring, secrets fall back to plaintext.

### 5. Language Support

60 languages supported, defined in `src/config/languageRegistry.json` and read through
`src/utils/languageSupport.ts`:

- Each entry has a two-letter code, label and flag
- "auto" is a 61st entry for automatic detection

### 6. Agent Naming System (hidden)

The assistant is hidden in this release, so "Hey [AgentName]" never routes a dictation to it (`agentInvoked: false` in `audioManager.js`). The code is kept:

- The agent name is stored in localStorage (`src/utils/agentName.ts`); its settings UI (`DictationAgentSettings.tsx`) is not mounted
- Standalone wake-word commands stream into the assistant panel (the address is stripped first, `stripAgentAddress`); a highlighted selection is edited in place by the dictation agent

### 7. Model Registry Architecture

`src/models/modelRegistryData.json` lists the only model: `gpt-6-luna` under the `openai` cloud provider. It has `supportsTemperature: false` (GPT-5 and newer reject `temperature`) and `supportsVision: true`.

**Key files:**

- `src/models/modelRegistryData.json` - Single source of truth for the model
- `src/models/ModelRegistry.ts` - TypeScript wrapper with helper methods
- `src/models/providerDefaultModel.ts` - `pickProviderDefaultModel()`; with no
  `defaultModel` on the provider, the first model in the array is the default

### 8. API Integrations and Updates

**OpenAI Responses API**:

- Cleanup and the chat stream use the Responses API on the ChatGPT plan (`chatgptPlan.ts`, `ReasoningService.ts`)
- Request format with an `input` array instead of `messages`; the system prompt goes in `instructions`
- No temperature parameter for newer models (GPT-5 and newer)

### 9. System Settings Integration

The app can open OS-level settings for microphone permissions, sound input selection, and accessibility:

**IPC Handlers** (in `ipcHandlers.js`):

- `open-microphone-settings`: Opens microphone privacy settings
- `open-sound-input-settings`: Opens sound/audio input device settings
- `open-accessibility-settings`: Opens accessibility privacy settings (macOS only)
- The Login Items URLs below are still in the URL map, but no IPC opens them today

**Platform-specific URLs**:

| Platform | Microphone Privacy                                                           | Sound Input                                                  | Accessibility                                                                   | Login Items                                                         |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| macOS    | `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone` | `x-apple.systempreferences:com.apple.preference.sound?input` | `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` | `x-apple.systempreferences:com.apple.LoginItems-Settings.extension` |
| Windows  | `ms-settings:privacy-microphone`                                             | `ms-settings:sound`                                          | N/A                                                                             | `ms-settings:startupapps`                                           |
| Linux    | Manual (no URL scheme)                                                       | Manual (e.g., pavucontrol)                                   | N/A                                                                             | N/A (XDG autostart entry, see `linuxAutostart.js`)                  |

**Microphone screen** (`MicrophoneRequired.tsx`, `useMicrophoneCheck.ts`):

- The app can't work without a mic, so there is no mic card in Settings. After setup, AppRouter shows this screen in place of the control panel while the mic can't be used, and keeps global hotkeys and the pill off (`setOnboardingActive(true)`)
- `checkMicrophone()` reads `check-microphone-access` (macOS and Windows `getMediaAccessStatus`; on Windows that is "Let desktop apps access your microphone"; Linux has no OS permission) and the device list. It never opens the mic. States: `ask` (macOS, not asked yet), `denied`, `restart`, `missing` (no input device)
- `restart` is macOS only: a mic denied at launch and allowed later in System Settings works only after a relaunch (`relaunch-app`)
- The screen checks again on window focus, on `devicechange` and every 2 s while shown, and goes away on its own
- Setup's "Start dictating" asks for the mic on macOS (the system prompt shows only once)
- A start in the tray creates no control panel, so the dictation window checks the mic at launch and calls `show-microphone-required`. A recording that fails with `NotAllowedError` or `NotFoundError` (`audioManager.js`) calls it too

### 10. Debug Mode

Enable with `--log-level=debug` or `ONLY_WHISPERS_LOG_LEVEL=debug` (can be set in `.env`):

- Logs saved to platform-specific app data directory
- Comprehensive logging of audio pipeline
- FFmpeg path resolution details
- Audio level analysis
- Complete reasoning pipeline debugging with stage-by-stage logging

Packaged Windows builds keep logger output off stdout/stderr by default. Launch with
`--console-logs` to opt into terminal output independently of the configured log level.
Default INFO entries are not persisted in this mode; enabling debug logging retains them
in the existing log file without enabling terminal output.

### 11. Windows Push-to-Talk

Native Windows support for true push-to-talk functionality using low-level keyboard hooks:

**Architecture**:

- `resources/windows-key-listener.c`: Native C program using Windows `SetWindowsHookEx` for keyboard hooks
- `src/helpers/windowsKeyManager.js`: Node.js wrapper that spawns and manages the native binary
- Binary outputs `KEY_DOWN` and `KEY_UP` to stdout when target key is pressed/released

**Compound Hotkey Support**:

- Parses hotkey strings like `CommandOrControl+Shift+F11`
- Maps modifiers: `CommandOrControl`/`Ctrl` → VK_CONTROL, `Alt`/`Option` → VK_MENU, `Shift` → VK_SHIFT
- Verifies all required modifiers are held before emitting key events

**Binary Distribution**:

- Compiled from source by `scripts/build-windows-key-listener.js`, part of `compile:native`, so every `prebuild*`, `predev:main` and `prestart` chain on a Windows host builds it; neither script runs on other hosts
- Fallback: prebuilt binary from GitHub releases (`windows-key-listener-v*` tags) via `scripts/download-windows-key-listener.js`
- CI workflow: `.github/workflows/build-windows-key-listener.yml` rebuilds the prebuilt binary when `resources/windows-key-listener.c` changes on main
- `afterPack.js` fails a Windows package without the binary. A dev run without it starts with Hold unavailable (a saved Hold is reset to Tap at startup), modifier-only hotkeys refused, and `F8` as the default hotkey (`hotkeyManager.js`)

**IPC Events**:

- `windows-key-listener:key-down`: Fired when hotkey pressed (start recording)
- `windows-key-listener:key-up`: Fired when hotkey released (stop recording)

**Double-tap lock** (Hold mode, Windows and Linux, `startWindowsPushToTalk` / `handleWindowsPushKeyUp`):

- A press released within 250 ms is a tap. The recording keeps running for 350 ms; a second press in that time locks it, so releases are ignored and the next press stops it. A lone tap is cancelled, not transcribed
- A locked recording the pill already stopped is dropped on the next press, which then starts a new push. A locked stop never reports `dictation-force-stopped`, since no keys are held
- Main sends `dictation-push-locked` (true at the lock, false when it ends), and the pill draws a thin ring while a recording runs hands-free (locked, or Tap mode); a held recording keeps the plain pill (`handsFree` on `VoicePill`, styles in `dictation-panel.css`)

### 12. Custom Dictionary

- User adds words in the Dictionary view; they are stored as a JSON array in localStorage (`customDictionary`)
- Sent to Mistral as `context_bias` (`mistralRealtimeStreaming.js`) and added to the cleanup prompt (the dictionary suffix)
- The hidden voice assistant can change it with the `update_dictionary` tool

### 13. GNOME Wayland Global Hotkeys

On GNOME Wayland, Electron's `globalShortcut` API doesn't work due to Wayland's security model. only-whispers uses native GNOME shortcuts:

**Architecture**:

1. `main.js` enables `GlobalShortcutsPortal` feature flag for Wayland
2. `hotkeyManager.js` detects GNOME + Wayland and initializes `GnomeShortcutManager`
3. `gnomeShortcut.js` creates D-Bus service at `com.raythurnvoid.OnlyWhispers`
4. Shortcuts registered via `gsettings` as custom GNOME keybindings
5. GNOME triggers `dbus-send` command which calls the D-Bus `Toggle()` method

**Key Constants**:

- D-Bus service: `com.raythurnvoid.OnlyWhispers`
- D-Bus path: `/com/raythurnvoid/OnlyWhispers`
- gsettings path: `/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/only-whispers/`

**IPC Integration**:

- `get-hotkey-mode-info`: Returns `{ isUsingGnome, isUsingHyprland, isUsingNativeShortcut }` to renderer
- UI hides activation mode selector when `isUsingNativeShortcut` is true
- Forces tap-to-talk mode (push-to-talk not supported)

**Hotkey Format Conversion**:

- Electron format: `F8`, `CommandOrControl+Shift+Space`
- GNOME format: `F8`, `<Control><Shift>space`
- Backtick (`) → `grave` in GNOME keysym format
- F13-F24 bind the keysym the active keymap gives that key (`xkbcomp -xkb $DISPLAY -`, xkb keys `<FK13>`-`<FK24>`), for gsettings and the Hold portal alike: stock xkeyboard-config sends `XF86Launch7` for F16 and has no `F16` keysym, so GNOME can't grab `F16` (#1716). A key with no keysym (`keysym_missing`, e.g. stock F19/F24) or one gsd-media-keys already binds (`keysym_reserved`, e.g. F13 → `XF86Tools` opens Settings) is refused with a message. An unreadable keymap keeps the F-key name

### 14. Hyprland Wayland Global Hotkeys

On Hyprland (wlroots Wayland compositor), Electron's `globalShortcut` API and the `GlobalShortcutsPortal` feature don't work reliably. only-whispers uses native Hyprland keybindings:

**Architecture**:

1. `main.js` enables `GlobalShortcutsPortal` feature flag for Wayland (fallback)
2. `hotkeyManager.js` detects Hyprland + Wayland and initializes `HyprlandShortcutManager`
3. `hyprlandShortcut.js` creates D-Bus service at `com.raythurnvoid.OnlyWhispers` (same as GNOME)
4. Shortcuts registered via `hyprctl keyword bind` (runtime keybinding)
5. Hyprland triggers `dbus-send` command which calls the D-Bus `Toggle()` method

**Detection**:

- Primary: `HYPRLAND_INSTANCE_SIGNATURE` environment variable (set by Hyprland)
- Fallback: `XDG_CURRENT_DESKTOP` contains "hyprland"

**Hotkey Format Conversion**:

- Electron format: `Control+Super`, `CommandOrControl+Shift+Space`
- Hyprland format: `CTRL, Super_L`, `CTRL SHIFT, space`
- Modifier-only combos (e.g., `Control+Super`) → `CTRL, Super_L`

**Bind/Unbind Commands**:

- Register: `hyprctl keyword bind "ALT, R, exec, dbus-send --session ..."`
- Unregister: `hyprctl keyword unbind "ALT, R"`
- Bindings are ephemeral (don't survive Hyprland restart) but re-registered on app startup

**Limitations**:

- Push-to-talk not supported (Hyprland `bind` fires a single exec, not key-down/key-up)
- Requires `hyprctl` on PATH (ships with Hyprland)

### 15. Voice Assistant Hotkey (hidden)

Hidden in this release and kept to restore later. `main.js` does not register a saved `voiceAgent` hotkey at startup, and the Settings UI below is not mounted. This section describes the kept code.

A dedicated global hotkey that starts a dictation whose transcript is sent straight to the voice assistant as a command — no wake word ("Hey [AgentName]") needed — and that always bypasses the cleanup model. With auto-paste enabled, a caret verified as writable at capture time (an opaque `caret` session in `selectionManager.js`, revalidated before pasting) receives the completed answer and the pill returns to idle. A dormant macOS accessibility tree reports "unknown": synthetic copy can still recover selected text, but cannot establish a safe caret destination. Unknown targets therefore stay on the panel route, since they can also be integrated terminals, pages without inputs, or fields with selections hidden by clipboard capture. A verified caret whose accessibility becomes unknown before delivery falls back the same way. Terminal and secure-field checks still apply to verified targets. On Linux the caret is verified by `linux-text-monitor --probe-editable <pid>`, which answers only for the focused field in that process's active window; the pid comes from the target (its AT-SPI pid, `xdotool`/`kdotool getwindowpid`, or `hyprctl activewindow`), and a target whose pid can't be read stays on the panel route. Otherwise the answer streams into a floating assistant panel attached to the dictation pill (there is no separate assistant window) and, with auto-paste enabled, is also copied to the clipboard for manual paste (the Copy button confirms for six seconds). The pill window is content-protected while the panel is open (the panel never appears in screen shares).

**Flow**:

1. Hotkey pressed → `voiceAgent` slot callback in `main.js` → `windowManager.sendToggleVoiceAgent()` → `toggle-voice-agent` IPC to the main window → recording capsule appears
2. `useAudioRecording.js` starts a recording with `audioManager.setVoiceAgentRequested(true)` (any other start resets it to `false`)
3. On transcription, `resolveReasoningRoute` consults `resolveDictationRouteKind()` (`src/helpers/dictationRouting.js`): a voice assistant recording always takes the agent route and never falls back to cleanup. The dictation agent's reachability only gates selection edits — a selection with the dictation agent unconfigured routes to the panel with the selected text quoted instead of editing in place
4. Standalone commands (no text selected) run through the chat pipeline (`src/components/dictation/AssistantPanel.tsx`) with the tools in `src/services/tools/`: `copy_to_clipboard`, `get_snippet` (triggers listed in the tool description, body fetched on demand), `update_dictionary` and `update_snippets` (these write through the settings store, like a UI edit). The custom dictionary and snippet triggers are added to the system prompt. Conversations persist in the `agent_conversations` table
5. Response delivery: a capture with `status: "editable"` (a focused writable non-terminal field with no selection) plus auto-paste banks a `deliverySessionId`; the completed answer is pasted via `paste-at-captured-target`, which revalidates the target and fails closed to the panel + clipboard on any change (`assistantResponseDelivery.ts`, `pasteAtCapturedTarget` in `selectionManager.js`). A follow-up spoken while the panel is already open stays panel-first. Cancelled or empty responses never paste and never touch the clipboard
6. Selection edits: highlighted text goes through the `dictationAgent` scope and is safely replaced in place. When the editor judges the command a question about the selection ("explain this") rather than a change, it answers `SELECTION_QUESTION_MARKER` (`selectionEditing.js`) and the command goes to the panel with the selection quoted, leaving the selection untouched

**Storage & IPC**:

- Env var: `VOICE_AGENT_KEY` (persisted via `environment.js`), store key: `voiceAgentKey` (no default — user opt-in)
- IPC handlers: `update-voice-agent-hotkey`, `get-voice-agent-key`
- Hotkey slot: `voiceAgent` (tap-to-toggle; GNOME-native slot via `ToggleVoiceAgent` D-Bus method, KDE via KGlobalAccel, otherwise `globalShortcut`)

**Panel**:

- Esc collapses the panel; a Copy button copies the answer; a follow-up input takes typed questions. Esc while the command is still thinking cancels it; a command whose stream ends without content settles as `agentMode.chat.emptyResponse`
- Pressing the hotkey again while the panel is open records a follow-up into the same conversation

**UI**:

- Settings → Hotkeys → "Voice Assistant Hotkey" (with cross-slot conflict validation)
- Panel conversations and in-place selection edits both run on the Voice Assistant scope (Settings → AI Models → Voice Assistant; `dictationAgent`/`dictationAgentVision`), resolved by `resolveChatStreamingInference`; the panel falls back to the `chatIntelligence` scope while the Voice Assistant scope is unreachable

**Screen Context (opt-in)**:

When "Share screen context" is enabled (Settings → AI Models → Voice Assistant → Screen Context, store key `voiceAgentScreenContext`, default off), each voice-assistant recording start captures the display the cursor is on and attaches it to the request as a base64 JPEG (long edge ≤ 1568 px).

- Capture: `src/helpers/screenContextCapture.js` (main process; `screen.getCursorScreenPoint` + `desktopCapturer`). macOS requires the Screen Recording TCC permission (`useScreenRecordingPermission` hook + `PermissionCard` in `DictationAgentSettings`); Windows/Linux X11 need no permission; Linux Wayland is unsupported (capture silently skipped)
- Encoding: `encodeWithinBudget()` walks a JPEG quality ladder (82 → 70 → 55), then falls back to a 1024 px resize, keeping the payload under `MAX_ENCODED_BYTES` (1.5 MB ≈ 2.05M base64 chars, inside the API's 2.8M cap). Each rung re-encodes the original bitmap, so quality drops never compound. A screen that still won't fit is dropped
- Trigger: `useAudioRecording.js` calls `audioManager.beginScreenContextCapture()` at recording start (fire-and-forget); `consumeScreenContext()` (3s guard) is awaited when the request is built. The dictation overlay gets `setContentProtection` while the setting is on so the pill never appears in captures
- Routing: the press-time screenshot is re-decided against the model that will actually answer. It attaches only when the chat model's provider client is image-wired (`supportsImages` on the `InferenceProvider`) and the model has `supportsVision` in `modelRegistryData.json`. Dropping the image never fails the command
- Privacy: screenshots live only in renderer memory for one request — never written to disk, stored in history, or logged (loggers emit `hasScreenContext` booleans only)
- IPC: `capture-screen-context`, `check-screen-recording-access`, `request-screen-recording-access`, `screen-context-set-enabled`

**Tests**: `test/helpers/dictationRouting.test.js`, `test/helpers/screenContextCapture.test.js` (run with `node --test`)

### 16. Tone & Style (hidden)

Hidden in this release and kept to restore later. `useAudioRecording` never starts the app capture, and `ToneStyleSection.tsx` is not mounted. This section describes the kept code.

Dictation cleanup writes in the tone the user picked for the kind of app they are dictating into: personal messages (formal, casual, very casual), work messages, email and everything else (formal, casual, excited). Off by default (cleanup keeps the speaker's own tone); turned on by the Tones & voices switch in Settings > Tone & Style. The assistant also writes drafts in the tone of the kind of text the request is for. Translation keeps its source's tone.

- **Detection** (main, at dictation start): `capture-dictation-app-category` reads the captured target through `selectionManager.getTargetAppContext()` and classifies it with `toneAppCategories.js`. macOS: `macos-text-monitor --app-context <pid>` prints the app name, bundle id, focused window title (accessibility, no Screen Recording needed) and, for a browser page, the URL host. Windows: `windows-fast-paste --detect-only` also prints `WINDOW_TITLE` (an older helper without it classifies by exe only). Linux: the window title is read on demand (`xdotool`/`kdotool getwindowname`) or taken from Hyprland's active window; an AT-SPI target's comes from `linux-fast-paste --atspi-target` (`WINDOW_TITLE_B64`, the active window's accessible name; an older helper prints none). Titles are kept beside the captured target (`_targetTitles`), never on it, since capture results reach the renderer. A browser (and a Windows UWP frame) is judged by its page or app title (its host, else the site name the title ends with; on a host not listed, only a site name the host carries, so a Notion page titled "Hey" stays `other`); native apps by whole-token app identity. Titles and hosts never leave the main process or reach the logs; only the category does
- **Cleanup**: `audioManager.beginToneStyleCapture()` starts the app capture (no caller in this release; `useAudioRecording` called it at recording start); the cleanup route's `consumeToneStyle()` (1.5 s guard, unknown app reads as `other`) puts `toneStyle` on the reasoning config, and the cleanup prompt gets `appendToneStyleSuffix` (`src/config/prompts/toneStyle.ts`) after the dictionary suffix (English in every locale)
- **Assistant and chat**: `getAgentSystemPrompt`'s `writingStyle` option adds a WRITING STYLE block (`buildWritingStyleBlock`) to every chat surface's prompt while Tone & Style is on: the model works out from the request, the recipient and the tool (an `email_draft` body is an email) which kind of text it writes, and uses the user's tone for it; its own answers keep its voice, a tone the user asks for wins, and code is never restyled. A voice-assistant answer pasted at a verified caret writes its reply for that app (text written through a tool, such as an `email_draft` body, still takes its own kind's style): `processAgentCommand` consumes the capture and banks `deliveryAppCategory`, which reaches the send as `destinationAppCategory` through the paste delivery. Before pasting, `deliverAssistantResponse` replaces the answer's em dashes, except in ranges (which take an en dash), code, links and non-Latin scripts. Selection edits get one sentence (`selectionEditToneSentence`) that applies the selection's app style only to a prose rewrite asked for without a tone. The desktop builds every agent prompt itself, so the API needs nothing here
- **UI**: Settings > Tone & Style (`settings/ToneStyleSection.tsx`) has a Tones & voices switch (`toneStyleEnabled`); while it's off, the picks and Save Changes are grayed out. App badges live in `src/assets/icons/apps/`

## Development Guidelines

### Internationalization (i18n) — REQUIRED

All user-facing strings **must** use the i18n system. Never hardcode UI text in components.

**Setup**: react-i18next (v15) with i18next (v25). Translation files in `src/locales/{lang}/translation.json`.

**Supported languages**: en, es, fr, de, pt, it, ru, ja, ar, zh-CN, zh-TW

**How to use**:

```tsx
import { useTranslation } from "react-i18next";

const { t } = useTranslation();
// Simple: t("sidebar.home")
// With interpolation: t("some.key", { model: "Voxtral" })
```

**Rules**:

1. Every new UI string must have a translation key in `en/translation.json` and all other language files
2. Use `useTranslation()` hook in components and hooks
3. Keep `{{variable}}` interpolation syntax for dynamic values
4. Do NOT translate: brand names (only-whispers), technical terms (Markdown, Signal ID), format names (MP3, WAV), or the shared assistant `fullPrompt` in `prompts.json`. The other prompt keys (`cleanupPrompt`, `translatePrompt`, `dictionarySuffix`, `screenContextSuffix`) are translated per locale, and any change to a default prompt must update `CURRENT_DEFAULT_PROMPT_HASHES` in `src/config/retiredPrompts.js`
5. Group keys by feature area (e.g., `settingsPage.*`, `sidebar.*`)

### Image and Icon Assets — REQUIRED

Raster UI assets live in `src/assets/`. Vector provider/brand marks live in `src/assets/icons/`.

UI icons come from `src/components/icons/` (vendored Nucleo core outline components behind lucide-style names, e.g. `import { Check, Loader2 } from "../icons"`). To add one, map a name to a Nucleo label in `src/components/icons/nucleo-map.json` and run `node scripts/sync-nucleo-icons.js`; never import from `lucide-react` or a machine-local Nucleo path. Icons outside that set are drawn by hand in `src/components/icons/primitives.tsx`, which the generated `index.ts` re-exports.

**Typography**: `--font-family-sans` is the bundled Noto Sans; `--font-family-display` uses the same stack.

**Rules**:

1. **Always `import` the asset**; never write a literal path like `/assets/foo.webp`. Packaged builds load the renderer from a `file://` origin, so root-relative paths resolve to nothing. Importing lets Vite fingerprint the file and rewrite the URL:

   ```tsx
   import appIcon from "@/assets/icon.png";
   <img src={appIcon} ... />;
   ```

2. **WebP, lossless** for UI art with hard edges or alpha — `cwebp -lossless -z 9 -alpha_q 100 in.png -o out.webp` (roughly 40–55% smaller than PNG). Reserve lossy for photographic art.
3. **Author at 2x the CSS slot** and no larger (a 44px slot gets an 88px asset). Retina-sharp without paying for pixels that get downscaled away.
4. **Bake rounded corners into the artwork as transparency** rather than adding a CSS `rounded-*` on the `<img>` — CSS rounding on top of already-rounded art clips the corners twice.
5. **Decorative images take `alt=""` plus `aria-hidden="true"`.** Most icons sit beside a visible label that already names them (e.g. the permission rows), so a descriptive `alt` makes screen readers announce the same thing twice. Only write real `alt` text when the image is the _only_ source of that information.
6. **Always set explicit `width`/`height`** matching the CSS size, to reserve layout space before decode. Add `decoding="async"` and `draggable={false}` (in Electron a draggable image can be dragged out of the window).
7. **Assets under 4 KB are inlined** by Vite as base64 data URIs, so they will not appear in `dist/assets/`. Grep the JS chunks for `data:image/webp;base64,` before concluding an asset went missing.

### Adding New Features

1. **New IPC Channel**: Add to both ipcHandlers.js and preload.js
2. **New Setting**: Update useSettings.ts and SettingsPage.tsx
3. **New UI Component**: Follow shadcn/ui patterns in src/components/ui
4. **New Manager**: Create in src/helpers/, initialize in main.js
5. **New UI Strings**: Add translation keys to all 11 language files (see i18n section above)
6. **New Sidecar Binary**: Add download script in `scripts/`, add to `prebuild*` scripts in package.json, add manager in `src/helpers/`, initialize in `main.js`. Spawn the child with `detached: process.platform !== "win32"` so it has its own process group on Unix. Right after spawn call `sidecarPidFile.write(name, child.pid)` and on `close` call `sidecarPidFile.clear(name)`. Add the binary fragment to `EXPECTED_BINARY_FRAGMENTS` in `sidecarReaper.js`. Register a stop function via `sidecarRegistry.register(name, () => manager.stop())` at startup in `main.js` — that single registration replaces the old `will-quit` line. No sidecar is registered today; `EXPECTED_BINARY_FRAGMENTS` keeps `llama-server` only so one left running by an older build is still stopped.

### Testing Checklist

- [ ] Ctrl+Win dictation pastes into the focused app (hold, and the double-tap lock)
- [ ] The pill shows the right states, and its cancel X works
- [ ] With mic access off or no mic, the microphone screen shows and dictation stays off
- [ ] Retry and Upload work from Home
- [ ] Custom dictionary words are recognized
- [ ] Cleanup runs on the ChatGPT plan, and the raw transcript is pasted when it fails or you are signed out
- [ ] Test GNOME / Hyprland / KDE Wayland hotkeys (Linux)
- [ ] No errors in the Logs view

Hidden features (the voice assistant, Tone & Style) are not in this list. Test them when they come back.

### Common Issues and Solutions

1. **No Audio Detected**:
   - Check FFmpeg path resolution
   - Verify microphone permissions
   - Check audio levels in debug logs

2. **Transcription Fails**:
   - Check the Mistral API key (setup screen or Settings)
   - Check the network, and the Logs view for the provider error
   - Upload refuses files over 25 MB

3. **Clipboard Not Working**:
   - macOS: Check accessibility permissions (required for AppleScript paste)
   - Linux: Native `linux-fast-paste` binary (XTest) is tried first, works for X11 and XWayland apps
     - X11: xdotool fallback if native binary unavailable
     - Hyprland Wayland: wtype → sendshortcut → uinput/ydotool
     - Sway/wlroots Wayland: wtype → uinput/ydotool
     - COSMIC Wayland: wtype for a detected terminal → uinput/ydotool
     - GNOME/KDE Wayland: portal keysyms (Shift+Insert on KDE, except Warp) → uinput/ydotool
     - Physical Wayland fallbacks use Shift+Insert to avoid layout-sensitive KEY_V
   - Windows: native windows-fast-paste, then PowerShell SendKeys (built-in)

4. **Build Issues**:
   - Local Windows builds must use `electron-builder.unsigned-win.json` (see Development process)
   - ASAR unpacking needed for FFmpeg

5. **Windows Push-to-Talk Binary**:
   - Compiled from `resources/windows-key-listener.c` whenever `compile:native` runs on a Windows host (`prebuild:win`, `predev:main`, …); the prebuilt binary download from GitHub releases is the fallback
   - If neither compiling nor the download produces it, `afterPack.js` fails the Windows build; an unpackaged dev run starts without it, with Hold and modifier-only hotkeys unavailable and `F8` as the default hotkey
   - To compile locally: install Visual Studio Build Tools or MinGW-w64
   - CI workflow (`.github/workflows/build-windows-key-listener.yml`) rebuilds the prebuilt binary when `resources/windows-key-listener.c` changes on main

### Platform-Specific Notes

**macOS**:

- Requires accessibility permissions for clipboard (auto-paste)
- Requires microphone permission (prompted by system)
- Uses AppleScript for reliable pasting
- Notarization needed for distribution
- Shows in dock with indicator dot when running (LSUIElement: false)
- System settings accessible via `x-apple.systempreferences:` URL scheme
- **Launch at login**: `setLoginItemSettings()`, which routes through `SMAppService` on macOS 13+. `openAsHidden` is deprecated and does nothing, so `wasOpenedAtLogin` is what sends a login launch to the tray. An item can register and still report `status: "requires-approval"` until the user allows it under System Settings → General → Login Items

**Windows**:

- No special accessibility permissions needed
- Microphone privacy settings at `ms-settings:privacy-microphone`
- Sound settings at `ms-settings:sound`
- NSIS installer for distribution
- **Installed name**: the Start menu and desktop shortcuts and the Apps list say "Only Whispers" (`nsis.shortcutName`, `nsis.uninstallDisplayName`). Keep `productName` as `only-whispers`: Electron names the user data folder after it, so changing it would lose every user's keys, settings and history. An update renames the old `only-whispers` shortcuts
- **Launch at login**: `HKCU\...\Run` entry written by Electron, named after the AppUserModelId, carrying `--hidden` so a login launch goes to the tray
  - Read the state from `executableWillLaunchAtLogin`; `openAtLogin` misses a startup app disabled from Task Manager or Settings
  - `resources/nsis/installer.nsh` removes the `Run` and `StartupApproved\Run` values on uninstall (but not on update), which Electron itself never cleans up
- **Tray identity**: signed production builds pass a permanent GUID to `new Tray()` (`tray.js`) so Windows keeps the user's tray placement across updates. Never change the GUID
  - Windows binds an unsigned executable's GUID to its path, so the GUID is gated on the `windowsTrayIdentity` marker in `extraMetadata`
  - Today both `electron-builder.json` and `electron-builder.unsigned-win.json` set the marker to `false`, so no build uses the GUID yet. Set it to `true` in `electron-builder.json` only once every Windows build is signed. Unsigned Windows builds use `electron-builder.unsigned-win.json`, which keeps it `false` and turns off forced signing
- **Push-to-Talk**: Native key listener binary (`windows-key-listener.exe`) enables true push-to-talk
  - Uses Windows Low-Level Keyboard Hook (`WH_KEYBOARD_LL`)
  - Supports compound hotkeys (e.g., `Ctrl+Shift+F11`)
  - Compiled from source during the build, with the prebuilt GitHub release binary as fallback (see section 12, Binary Distribution)
  - `afterPack.js` fails a Windows package without it

**Linux**:

- Multiple package manager support
- Standard XDG directories
- AppImage for distribution
- No standardized URL scheme for system settings (user must open manually)
- Privacy settings button hidden in UI (not applicable on Linux)
- Recommend `pavucontrol` for audio device management
- **GPU compositing**: on, as on Windows, except whenever an NVIDIA kernel module (proprietary or open, any version) is loaded (`linuxGpuCompositing.js`, `/proc/driver/nvidia/version`): it flickered transparent windows in #203, Chromium's blocklist doesn't catch it, and explicit sync (driver 555+, Xwayland 24.1+, compositor support) can't be checked before app ready. Anyone else can turn it off with `--disable-gpu-compositing` in `only-whispers-flags.conf`, read by the packaged launcher (`scripts/lib/linux-launcher.js`). The mode is logged at startup, which only reaches the log file at `--log-level=debug`
- **Backdrop blurs**: Linux can still composite on the CPU, where a large blur is redrawn on every repaint above it (#2298):
  - On Linux (`ui/overlayBlur.ts`), the full-window dialog overlays (shared `Dialog`, Settings) skip their default backdrop blur; a blur passed through `overlayClassName` still applies
  - Settings cards (`SettingsPanel`), the Settings selects and the `LanguageSelector` trigger sit on an opaque pane, so they carry no blur on any platform
- **Launch at login**: XDG autostart entry at `~/.config/autostart/only-whispers.desktop` (see `linuxAutostart.js`), since Electron's `setLoginItemSettings()` does nothing on Linux
  - `isAutostartEnabled()` sees an entry disabled from GNOME Tweaks or KDE's autostart editor (there is no Settings toggle today)
  - "Start minimized" is handled app-side by the `startMinimized` setting, not by the desktop entry
- **Clipboard paste tools** (at least one required for auto-paste):
  - **X11**: `xdotool` (recommended)
  - **Hyprland Wayland**: `wtype`, then `hyprctl` sendshortcut (avoids the sendshortcut stuck-modifier bug when wtype is installed)
  - **Sway/wlroots Wayland**: `wtype` (requires the virtual keyboard protocol)
  - **COSMIC Wayland**: `wtype` for terminals (Warp has no Shift+Insert paste); other windows paste with uinput Shift+Insert. Settings asks for `wtype` there once something else pastes (`needsWtype` in `src/utils/linuxPasteTools.ts`), but `checkPasteTools` never reports it as the method
  - **GNOME/KDE Wayland**: RemoteDesktop portal keysyms (Shift+Insert on KDE, except Warp), then uinput/ydotool
  - **Wayland physical fallback**: Shift+Insert avoids layout-sensitive KEY_V; `ydotool` requires the `ydotoold` daemon
  - Terminal detection: Auto-detects terminal emulators and uses Ctrl+Shift+V
  - Fallback: Text copied to clipboard with manual paste instructions
- **GNOME Wayland global hotkeys**:
  - Uses native GNOME shortcuts via D-Bus and gsettings (no special permissions needed)
  - Hotkeys visible in GNOME Settings → Keyboard → Shortcuts → Custom
  - Default fallback: `F8` when `Control+Super` cannot be registered
  - Push-to-talk unavailable (GNOME shortcuts only fire single toggle event)
  - Falls back to X11/globalShortcut if GNOME integration fails
  - D-Bus transport: `@homebridge/dbus-native` (pure JavaScript, no native addons)

## Code Style and Conventions

- Use TypeScript for new React components
- Follow existing patterns in helpers/
- Descriptive error messages for users
- Comprehensive debug logging
- Clean up resources (files, listeners)
- Handle edge cases gracefully

## Performance Considerations

- Audio blob size limits for IPC (10MB)
- Temporary file cleanup
- Process timeout protection (5 minutes)

## Security Considerations

- API keys and the ChatGPT login are encrypted at rest via Electron `safeStorage` → OS keychain (Keychain / DPAPI / libsecret), stored as per-key files in `userData/secure-keys/`. Linux without a keyring falls back to plaintext (Electron default).
- Context isolation enabled
- No remote code execution
- Sanitized file paths
- Limited IPC surface area
