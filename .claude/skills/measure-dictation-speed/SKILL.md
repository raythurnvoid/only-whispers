---
name: measure-dictation-speed
description: Measure and improve how fast a dictation reaches the text field (Mistral speech-to-text, Luna cleanup, paste) and how accurate it is. Use when the user asks why dictation is slow, wants to speed it up, wants to test a speed or accuracy change (streaming delay, early send to Luna, prefill, paste), asks you to test dictation without them (replay their recordings through the app's code), or asks to read the timing in the app's logs. Holds the test scripts and FINDINGS.md, the results measured so far.
---

# Measure dictation speed

Read `FINDINGS.md` first. It has every result measured so far and the ideas already ruled out, so you do not test them again.

## Rules

- Measure before you change code, and measure again after. Report the median, the p90 and the number of runs.
- Judge a speed change with the replay (section 4), not only with a lab estimate.
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
- An update (auto-update on quit, or another session installing a release) restarts the app without `--log-level=debug`, and its dictations then leave no timing lines. Check the flags first: PowerShell `Get-CimInstance Win32_Process -Filter "Name='only-whispers.exe'" | Select-Object -First 1 -ExpandProperty CommandLine`.
- Other sessions may release from this repo too. Before a release, read `git log` and `gh release list`, and bump from the version in `package.json`, not from memory.
- The installed app runs the released code. Log lines added since the last release (for example `Paste steps timing`) appear only in dev mode.

| Column                          | Log line                                      | Meaning                                          |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `stopMs`                        | `Streaming stop timing` (`totalStopMs`)       | key release → Mistral's final text               |
| `lunaMs`, `warm`                | `CHATGPT_PLAN_SOCKET`                         | Luna on the socket, and whether it was warm      |
| `prefilled`, `early`            | `CHATGPT_PLAN_SOCKET`                         | prefill used; early cleanup `hit`/`miss`/`failed`/`none` |
| `earlySentMs`                   | `Early cleanup sent` (`afterReleaseMs`)       | key release → early cleanup sent                 |
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
- `luna-transport.cjs` checks the ways a second (early) request can go: `response.cancel`, a second socket while the first is busy, and HTTP. It also needs a fresh token.
- The app's socket code is `src/helpers/chatgptResponsesSocket.js`; the request body is built in `src/services/ai/chatgptPlan.ts`. Keep a test's body the same as the app's (`instructions`, `store: false`, `service_tier: "priority"`, `reasoning: { effort: "none" }`).

## 4. Replay through the app's own code (the main test for a speed change)

This is the closest test to a real dictation without a mic, and it needs no help from the user. Use it to judge any change to the path after key release, and use it when the user asks you to test without them. The lab numbers in sections 2 and 3 are estimates: the lab predicted the early cleanup would save about 190 ms, and this replay found no gain, because the delay change and the prefill had already moved the baseline. So check every idea here before you keep it, and again after an earlier change lands.

How it works (`scripts/cleanup-replay.cjs`; add a new idea as a new mode):

```bash
# from the scratch folder; modes run one after the other on every file
vp env exec node $S/cleanup-replay.cjs audio-real 30 base,rolling,rolling-skip,rolling-early > results.jsonl
vp env exec node $S/analyze-replay.cjs results.jsonl
```

- Modes: `base` (prefill at release only), `early` (+ early cleanup), `rolling` (+ a prefill while speaking every `ROLLING_STEP` words, env, default 15), `rolling-skip` (rolling, no prefill at release when a rolling one was sent), `rolling-early`.

- It loads the app's real module (`src/helpers/chatgptResponsesSocket.js`) with `Module._load` stubs: `./chatgptAuth` returns the token read from the app's store (never refreshed), `./debugLogger` does nothing. Deleting the module from `require.cache` gives a fresh copy.
- It streams a real recording to Mistral at real-time speed: a 50 ms chunk is sent once its audio has been heard (`t0 + (n + 1) * 50`), like the app's worklet. The file's end is the key release, and the real silence before it is kept.
- It calls the module in the app's order: `warmup()` at dictation start, `prefillTranscript()` at release, the mode's extra steps (`sendEarly()`, rolling `prefillTranscript()` calls), then `createResponse()` when Mistral's final text comes. It measures release → cleaned text.
- Code that lives in the renderer (the early-cleanup rule, the prefill text, the rolling rule) is copied into the script with the same constants. When you change those in `audioManager.js`, change them here too. A mode can try a rule before the app has it (the rolling prefill did).
- Each run reports `changed` (the mode did something different from base on that file), the prefill wait (`prefillWaitMs`, how long the cleanup waited for the prefill), `prefillMs` and `restChars` (how much text Luna still had to read).

Rules learned on 2026-11-01:

- Run each file once per mode, one run after the other, and turn the order of the modes on every file (the script does both). Never run the two at once: parallel requests slow Luna down (in the first try a miss came out 600 ms slower), which the app never does.
- Keep a control group: pairs where the mode did nothing (`changed: false`; `analyze-replay.cjs` prints them as "did nothing (noise)"). Their difference is the noise between two runs, about 100 ms. A gain smaller than that is not a gain.
- Do one cleanup before the first file, so later runs have a prompt to warm and prefill, like every dictation but the first after launch.
- The token lasts 60 minutes after the user's last dictation. Check `common.cjs` first; a pair of 15 s recordings takes about 35 s. 21 files of up to 30 s took about 12 minutes for 2 modes, so about 6 minutes per mode. If it is short, ask the user to dictate once.
- A network error (`ENOTFOUND api.mistral.ai`) must fail one file, not the run.
- Start it in the background and wait for it. Then run `analyze-replay.cjs <results.jsonl>`: it pairs every mode with base by file and prints the median difference, with the control group.
- Do not run it while the user dictates: both would send Luna requests at the same time and slow each other down.
- It leaves out the paste, the focus check, the dictionary and the mic warm-up. Check those in the app's logs (section 1).

## Testing app code changes

- Prove each test by breaking the code on purpose, watching the test fail, then restoring it. The early-cleanup tests (`test/helpers/audioManagerEarlyCleanup.test.js`, `test/helpers/chatgptResponsesSocket.test.js`) were checked this way: removing the trim, the timer clear or the exact-text check each failed a test.
- `_finalizeStreamingRecording` clears the live text right after `provider.stop()`, before Luna starts. A test of a timer that must not fire late has to make `stop` slow, not the cleanup.
- `chatgptResponsesSocket.test.js` leaves idle timers running, so run it with `--test-force-exit` (as `pnpm test` does) or it hangs.

## Where the code is

- Mistral live session: `src/helpers/mistralRealtimeStreaming.js` (`STREAMING_DELAY_MS`, `language: "en"`, `context_bias`).
- Stop path and timing logs: `src/helpers/audioManager.js` (`Streaming stop timing`, `_finalizeStreamingRecording`, `Streaming total processing`).
- Luna sockets: `src/helpers/chatgptResponsesSocket.js` (warmup, prefill, early cleanup on the spare socket, `createResponse`). The renderer calls them from `audioManager.js` (prefill and early cleanup in `_finalizeStreamingRecording`) and `chatgptPlan.ts` (the cleanup request).
- Paste: the `paste-text` handler in `src/helpers/ipcHandlers.js` (`Paste steps timing`) and `src/hooks/useAudioRecording.js` (`Paste timing`).
