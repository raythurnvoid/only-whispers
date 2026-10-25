# Troubleshooting

## Quick Diagnostics

| Check               | Command                  |
| ------------------- | ------------------------ |
| Host architecture   | `uname -m`               |
| Node architecture   | `node -p "process.arch"` |
| FFmpeg availability | `ffmpeg -version`        |

## Common Issues

### Architecture Mismatch (Apple Silicon)

**Symptoms:** Crashes on launch, "wrong architecture" errors

**Fix:**

1. Check if Node is x86_64 on arm64: `node -p "process.arch"` vs `uname -m`
2. Uninstall mismatched Node and reinstall native build
3. Run `rm -rf node_modules package-lock.json && npm ci`
4. Rebuild the app

### Microphone Permission Issues

**Symptoms:** "Permission denied", microphone prompt doesn't appear, or "No microphones detected"

**Platform-specific fixes:**

**macOS:**

1. Open System Settings → Privacy & Security → Microphone
2. Ensure only-whispers is listed and enabled
3. If not listed, click "Grant Access" in the app to trigger the permission prompt
4. You can also click "Open Microphone Privacy" button in the app

**Windows:**

1. Open Settings → Privacy → Microphone
2. Ensure "Allow apps to access your microphone" is ON
3. Ensure only-whispers is listed and enabled
4. You can also click "Open Privacy Settings" button in the app

**Linux:**

1. Check your audio settings (e.g., `pavucontrol`)
2. Ensure the correct input device is selected
3. Linux doesn't have app-level microphone permissions like macOS/Windows

### Empty Transcriptions

**Symptoms:** History shows "you" or empty entries

**Causes:**

- Microphone permission revoked mid-session
- Hotkey triggering without audio input
- Wrong audio input device selected

**Fix:**

1. Check microphone permissions (see above)
2. Open sound settings and verify the correct input device is selected
3. Try a different hotkey
4. Re-run onboarding

### FFmpeg Not Found

**Symptoms:** "FFmpeg not found" error, transcription fails immediately

**Fix:**

1. Reinstall dependencies: `rm -rf node_modules && npm ci`
2. If using packaged app, try reinstalling
3. **Windows:** check that antivirus / Windows Defender hasn't quarantined the bundled FFmpeg binary

### Electron Failed to Install Correctly

**Symptoms:** Running `npm run dev` fails with "Electron failed to install correctly".

**Fix:**

1. Use Node.js 24: `node -v`
2. Ensure npm install scripts are enabled: `npm config set ignore-scripts false`
3. Rebuild Electron's platform binary: `npm rebuild electron`
4. If `ELECTRON_SKIP_BINARY_DOWNLOAD` is set, unset it and run `npm install` again

### Wayland Clipboard Issues (Linux)

**Symptoms:** Paste simulation succeeds but target app shows "clipboard is empty", "no image on clipboard", or "contents not available in the requested format"

**Cause:** Electron's main-process clipboard API uses X11 selections (via XWayland), which native Wayland apps cannot read.

**Fix:**

1. Install `wl-clipboard` for the most reliable Wayland clipboard support:
   - Debian/Ubuntu: `sudo apt install wl-clipboard`
   - Fedora/RHEL: `sudo dnf install wl-clipboard`
   - Arch: `sudo pacman -S wl-clipboard`
2. only-whispers chooses a compositor-specific paste method:
   - Hyprland: `wtype`, then `hyprctl dispatch sendshortcut`
   - Sway and other wlroots compositors: `wtype`
   - GNOME and KDE Plasma: the RemoteDesktop keyboard portal
   - `ydotool` is a fallback and requires the `ydotoold` daemon
3. Restart only-whispers after installing

only-whispers tries clipboard methods in order: `wl-copy` (most reliable) → renderer `navigator.clipboard` → X11 fallback.

On GNOME and KDE, the first automatic paste can show a remote-interaction permission dialog. Approval is remembered in `~/.cache/only-whispers/portal-paste-token`; revoking permission or invalidating that token makes the prompt return. If automatic paste fails, the transcription remains in the clipboard for manual paste.

### Linux Window Flicker

**Symptoms:** The dictation pill or other transparent windows flicker

**Cause:** only-whispers composites on the GPU, except whenever an NVIDIA driver is loaded, where it already composites on the CPU. Some other drivers can flicker transparent windows too.

**Fix:**

1. With the official AppImage, deb, rpm or tar.gz build, add this line to `~/.config/only-whispers-flags.conf` (`$XDG_CONFIG_HOME/only-whispers-flags.conf` if you set `XDG_CONFIG_HOME`; create the file if it doesn't exist, and save it with Unix (LF) line endings):

   ```text
   --disable-gpu-compositing
   ```

2. Quit only-whispers and start it again. Closing the window only hides it, so quit from the tray icon, or, if your desktop shows no tray icon (GNOME without the AppIndicator extension), run `pkill -x only-whispers-app`.

The interface then composites on the CPU, so hover effects and scrolling can feel slower. Delete the line to undo it.

When you report the flicker, add `--log-level=debug` on its own line in the same file, restart, and attach the newest `~/.config/only-whispers/logs/debug-*.log`. Its "Linux GPU compositing" line shows which mode only-whispers started in.

### Linux System Audio PipeWire Issues

**Symptoms:** Meeting transcription captures the microphone but not other participants, browser audio, or other system audio.

**Fix:**

1. Install PipeWire runtime libraries if they are not already present:
   - Debian/Ubuntu: `sudo apt install pipewire libpipewire-0.3-0`
   - Fedora/RHEL: `sudo dnf install pipewire pipewire-libs`
   - Arch: `sudo pacman -S pipewire`
2. Make sure the PipeWire user service is running for the current session
3. Sign out and back in after installing or updating PipeWire packages
4. Restart only-whispers and start meeting transcription again
5. No screen-share chooser is expected for Linux system audio; only-whispers captures the default sink monitor directly through PipeWire

### Meeting Transcription Issues

**Symptoms:** Meeting detection not working, no transcription, audio not captured

**macOS:**

1. Grant Screen Recording permission: System Settings → Privacy & Security → Screen Recording → enable only-whispers
2. Restart the app after granting permission
3. Ensure Google Calendar is connected in Integrations

**Windows:**

1. System audio is captured by `windows-system-audio-helper.exe` (WASAPI process loopback), which hears every app on every output device — no permission prompt is needed
2. If the helper is missing or fails (requires Windows 10 2004+), only-whispers automatically falls back to Chromium loopback, which only hears the _default_ output device — make sure your meeting app plays through the default device in that case
3. On some machines the helper starts successfully but captures only digital silence — and Microsoft Teams call audio appears to be hidden from it regardless of configuration. only-whispers detects this a few seconds in (its capture is silent while an output device is still metering audio), starts Chromium loopback alongside, and switches the recording to it once it hears audio the helper is missing; the debug log shows `Windows system audio helper captured only silence, starting renderer loopback beside it`, then `Renderer loopback took over system audio capture`. The check runs for the whole meeting, so a call that goes missing after some other sound was captured still switches over — though audio playing continuously alongside the meeting (music in a browser tab, say) can mask it, since our capture never falls silent
4. If transcription shows "Continuing with microphone only", system audio capture failed entirely; check debug logs for `windows-system-audio-helper` entries

**All Platforms:**

1. Check that meeting detection is enabled in settings
2. Verify your OpenAI API key is valid (required for Realtime API transcription)
3. Ensure your meeting app (Zoom, Teams, FaceTime) is running — process detection looks for known meeting applications
4. If auto-detection fails, you can manually start recording from the in-app meeting prompt (an always-on-top overlay card — it works even with Focus/Do Not Disturb on and never appears in screen shares)

### Voice Assistant Issues

**Symptoms:** Assistant panel not appearing, no AI responses, streaming errors

**Fix:**

1. Check your chat model under Settings → AI Models → Chat (the panel runs on the chat scope); the Voice Assistant toggle only gates in-place selection edits
2. Check that you have a valid API key for your selected provider
3. Verify the Voice Assistant hotkey doesn't conflict with other global shortcuts
4. Remember there is no separate assistant window. Press the Voice Assistant hotkey (or use the pill) and speak: highlighted text is edited in place; with auto-paste enabled, an answer pastes at a focused writable cursor. Without a writable cursor—or if the target changes while the answer is generated—only-whispers leaves the field untouched, opens the floating panel attached to the dictation pill, and copies the completed answer to the clipboard for manual paste
5. For local models: ensure the model is downloaded and llama-server is running
6. For Metal OOM on macOS: try a smaller local model

### Windows-Specific Issues

**No window appears (process running in Task Manager but invisible):**

1. Check the system tray (click the `^` caret) for the only-whispers icon
2. Run with debug logging: `only-whispers.exe --log-level=debug`
3. Try disabling GPU acceleration: `only-whispers.exe --disable-gpu`

**Antivirus / Windows Defender blocking binaries:**

FFmpeg and the bundled helper binaries may be quarantined silently. Add only-whispers to exclusions: Settings → Virus & threat protection → Exclusions.

**Permission errors:**

Right-click only-whispers → Run as administrator (or set permanently in Properties → Compatibility).

**Firewall blocking cloud mode:**

Allow only-whispers through Windows Firewall when using cloud transcription providers.

**Complete reset (after uninstalling):**

```batch
rd /s /q "%APPDATA%\only-whispers"
rd /s /q "%LOCALAPPDATA%\only-whispers"
```

Then reinstall.

**Logs location:** `%APPDATA%\only-whispers\logs\`

## Enable Debug Mode

For detailed diagnostics, see [DEBUG.md](DEBUG.md).

## Getting Help

1. Enable debug mode and reproduce the issue
2. Collect diagnostic output from commands above
3. Open an issue at https://github.com/raythurnvoid/only-whispers/issues with:
   - OS version
   - only-whispers version
   - Relevant log sections
   - Steps to reproduce
