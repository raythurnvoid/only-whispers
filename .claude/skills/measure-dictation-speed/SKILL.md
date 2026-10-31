---
name: measure-dictation-speed
description: Measure and improve how fast a dictation reaches the text field (Mistral speech-to-text, Luna cleanup, paste) and how accurate it is. Use when the user asks why dictation is slow, wants to speed it up, wants to test a speed or accuracy change (streaming delay, early send to Luna, prefill, paste), or asks to read the timing in the app's logs. Holds the test scripts and FINDINGS.md, the results measured so far.
---

# Measure dictation speed

Read `FINDINGS.md` first. It has every result measured so far and the ideas already ruled out, so you do not test them again.

## Rules

- Measure before you change code, and measure again after. Report the median, the p90 and the number of runs.
- Prefer the user's real recordings to synthetic audio. Synthetic (TTS) audio has clean silence and gave hit rates that real speech did not reach.
- Run the scripts from the personal task folder (`only-whispers-+personal/+ai/<task>-<date>/`), never from the repo. They write results and converted audio to the current folder and refuse to run inside the repo.
- The recordings and their transcripts are the user's private speech. Never commit, paste or quote them in the repo, a commit, a PR or an issue. In chat, quote only the few words needed.
- Never print the API keys or the ChatGPT token. `scripts/common.cjs` reads them from the app's store.
- Never refresh the ChatGPT token from a script: the refresh replaces the refresh token the app keeps, and the app is signed out. If it expired, ask the user to dictate once in the app.
- Run Node through Vite Plus: `vp env exec node <script>`.
- When you learn something new, update `FINDINGS.md` (numbers, date, runs, setup) and this file (steps, gotchas) in the same task.

## 1. Timing of real dictations (the app's own logs)

The app logs each stage. Info lines reach the log file only in debug mode:

1. Check first that a dev server is not already running. Then start the app with the level set in the shell: Git Bash `ONLY_WHISPERS_LOG_LEVEL=debug vp env exec pnpm dev`, PowerShell `$env:ONLY_WHISPERS_LOG_LEVEL = "debug"; vp env exec pnpm dev`. `run-electron.js` passes the env to Electron. Do not rely on `pnpm dev -- --log-level=debug` (the args go to `concurrently`) or on a hand-added line in `userData/.env` (the app can rewrite that file and drop it). A packaged app takes `--log-level=debug` on its command line.
2. Ask the user to dictate a few times into a text field.
3. Run `vp env exec node .claude/skills/measure-dictation-speed/scripts/log-timings.cjs`. It reads the newest `userData/logs/debug-*.log` and prints one row per dictation. This script only reads, so it can run from the repo.

Gotchas:

- Agent shells (Claude Code) set `ELECTRON_RUN_AS_NODE=1`. The installed app then runs as plain Node and exits at once with code 9. Clear it first: PowerShell `Remove-Item Env:ELECTRON_RUN_AS_NODE`, then `Start-Process "$env:LOCALAPPDATA\Programs\only-whispers\only-whispers.exe" -ArgumentList "--log-level=debug"`. (`run-electron.js` clears it for `pnpm dev`.)
- Dev mode keeps its data in `only-whispers-development` (`main.js`, `configureChannelUserDataPath`): no keys, no ChatGPT login, no recordings, and its logs are there too (pass that log path to `log-timings.cjs`). Set `ONLY_WHISPERS_CHANNEL=production` in the shell to use the installed app's data instead. The scripts read the installed app's folder (`only-whispers`).
- The installed app runs the released code. Log lines added since the last release (for example `Paste steps timing`) appear only in dev mode.

| Column                          | Log line                                      | Meaning                                          |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `stopMs`                        | `Streaming stop timing` (`totalStopMs`)       | key release → Mistral's final text               |
| `lunaMs`, `warm`                | `CHATGPT_PLAN_SOCKET`                         | Luna on the socket, and whether it was warm      |
| `cleanupMs`                     | `CHATGPT_PLAN_SUCCESS`                        | whole cleanup call                               |
| `socketFailedMs`                | `ChatGPT socket failed, using HTTP` (warning) | the socket failed after this long, then HTTP ran |
| `toPasteMs`                     | `Streaming total processing`                  | key release → just before paste                  |
| `focusCheckMs`, `pasteHelperMs` | `Paste steps timing`                          | the writable-field check and the paste helper    |
| `pasteMs`                       | `Paste timing`                                | whole paste, seen from the renderer              |

The user's wait after release is about `toPasteMs + pasteMs`. Warnings, such as the socket fallback, also go to `userData/logs/errors.log` at any log level.

## 2. Offline lab with real recordings

The app keeps the user's recordings in `userData/audio/*.webm`. From the personal task folder (`S` is the scripts folder, `.claude/skills/measure-dictation-speed/scripts` in the repo):

```bash
vp env exec node $S/common.cjs                     # keys readable? token minutes left
vp env exec node $S/convert-recordings.cjs 30       # newest 30 recordings -> audio-real/*.wav
vp env exec node $S/reference-text.cjs              # batch transcription -> ref-real.json
vp env exec node $S/run-live.cjs results-1.jsonl 1200,800,480   # live runs, ~13 min for 30 files
vp env exec node $S/run-live.cjs results-2.jsonl 1200,800,480   # second pass, to see the noise
vp env exec node $S/analyze-live.cjs results-1.jsonl results-2.jsonl
```

- `run-live.cjs` runs in the background well: start it in the background and wait for it, do not poll.
- Mistral's text is almost the same on every run, but its speed changes during the day. To test a new delay, run it next to one baseline (1200) in the same pass, and reuse old results for accuracy. Each delay costs about 4 minutes for 30 files.
- `analyze-live.cjs` prints, per delay: release-to-done time, word errors against the batch text, first-3-words accuracy, the most an early send can save, and the lag rule's hit rate and saving. `--show-diffs` prints the first words where delays disagree (private, see Rules).
- `mistral-live.cjs <wav> <delay> asis` streams one file and prints every delta with its time. Use a number instead of `asis` to cut the file at speech end and add that much silence (synthetic tests).
- The live runs do not send the dictionary (`context_bias`) or a mic warm-up the way the app does. Say so when you compare with the app.
- To try a new early-send rule, add it to `analyze-live.cjs` and replay the saved results. It costs no API calls.

## 3. Luna

- `luna-prefill.cjs [rounds]` compares today's request with a prefill (first part sent with `generate: false`, then the rest). It needs a fresh ChatGPT token.
- The app's socket code is `src/helpers/chatgptResponsesSocket.js`; the request body is built in `src/services/ai/chatgptPlan.ts`. Keep a test's body the same as the app's (`instructions`, `store: false`, `service_tier: "priority"`, `reasoning: { effort: "none" }`).

## Where the code is

- Mistral live session: `src/helpers/mistralRealtimeStreaming.js` (`STREAMING_DELAY_MS`, `language: "en"`, `context_bias`).
- Stop path and timing logs: `src/helpers/audioManager.js` (`Streaming stop timing`, `_finalizeStreamingRecording`, `Streaming total processing`).
- Paste: the `paste-text` handler in `src/helpers/ipcHandlers.js` (`Paste steps timing`) and `src/hooks/useAudioRecording.js` (`Paste timing`).
