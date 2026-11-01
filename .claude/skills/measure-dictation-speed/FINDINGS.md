# Dictation speed: what we measured

Keep this file current. After each measurement, add or fix the numbers here, with the date, the number of runs and the setup. Mark old results that a newer test replaced. Never put the user's dictated text here.

## Where the time goes (after the key is released)

1. Mistral: the app sends `input_audio.end` and waits for `transcription.done` (`stopMs` in the app log).
2. Luna cleanup on the ChatGPT plan socket (`lunaMs`).
3. Focus check and paste (`focusCheckMs`, `pasteHelperMs`).

Today the user waits about 1.0 s for Mistral, then Luna, then the paste.

## Mistral (2026-10-31)

### Delay, real mic (30 of the user's recordings, each run twice, real silence before release kept)

| `STREAMING_DELAY_MS` | Release to done (median) | p90     | Word errors vs batch | First 3 words right |
| -------------------- | ------------------------ | ------- | -------------------- | ------------------- |
| 1200 (old default)   | 982 ms                   | 1336 ms | 5.8%                 | 50/60               |
| 800                  | 850 ms                   | 1199 ms | 6.2%                 | 44/60               |
| 480                  | 734 ms                   | 1000 ms | 6.1%                 | 48/60               |

- Mistral is almost deterministic: the same file gave the same final 27–30 times out of 30 across the two passes. So small accuracy differences are real, not noise.
- 480 is about 250 ms faster than 1200 and costs about 0.3 points of word error. 800 is slower than 480 and has the most first-word errors, so it is the worst choice.
- Not tested yet: the app sends the dictionary as `context_bias`; these runs did not. It may help the lower delays.
- Server speed changes during the day: the second pass was about 100 ms slower at 1200.

### Delay sweep, real mic (2026-10-31, same 30 recordings, one pass, all delays in the same session)

| `STREAMING_DELAY_MS` | Release to done (median) | p90     | Word errors vs batch | First 3 words right |
| -------------------- | ------------------------ | ------- | -------------------- | ------------------- |
| 1200 (old default)   | 874 ms                   | 1100 ms | 5.8%                 | 25/30               |
| 480                  | 612 ms                   | 935 ms  | 6.1%                 | 24/30               |
| 400                  | 562 ms                   | 770 ms  | 6.3%                 | 24/30               |
| 320                  | 627 ms                   | 1149 ms | 6.9%                 | 22/30               |
| 240                  | 494 ms                   | 783 ms  | 8.3%                 | 21/30               |
| 160                  | 496 ms                   | 704 ms  | 9.2%                 | 19/30               |
| 80                   | 497 ms                   | 661 ms  | 10.8%                | 18/30               |

- Mistral rejects a delay of 0; 80 is accepted.
- Speed stops improving below about 240: Mistral needs about 0.5 s to finish after release whatever the delay.
- Errors rise fast below 400 (6.3% → 6.9% → 8.3% → 10.8%).
- Sweet spot: 400–480. Chosen: 480, set in `mistralRealtimeStreaming.js` on 2026-10-31. 480 vs 400 speed (50 ms) is inside the day-to-day noise of about 100 ms; the accuracy gap (91 vs 94 wrong words) is real, since Mistral is deterministic.
- 320 had one 3.4 s outlier, so its median is noise.
- The 1200 and 480 accuracy matched the morning runs (28/30 and 30/30 same finals). Next time, run only 1200 as the speed baseline next to the new delays, and reuse old results for accuracy.

### Facts about the live text

- The live deltas, joined, always equal the final text (180/180 real runs, 96/96 synthetic). The final never re-decodes words.
- At the moment of release the text is complete only 8/60 times. It becomes complete a median of 310–350 ms before `transcription.done`. That is the most an early send to Luna can save.
- The text trails the voice: the last delta arrives a median of 1.1 s (delay 1200), 1.0 s (800) and 0.8 s (480) after speech ends.

### Ruled out

- `input_audio.flush` at release instead of `input_audio.end`: no clear gain (72 synthetic runs, medians 635–716 ms vs 649–870 ms). A flush in the middle of speech duplicated a word in the next part.
- Mistral `turn_detection` (`turn.end`): it lags like the text; at `turn.end` the text was still missing a word.
- "No new text for X ms" as the early-send trigger: on real speech only 21–56% of sends had the full text (the user's rule needs at least 50%). New text keeps coming in bursts with long gaps.

## Early send to Luna (the user's rule: at least 50% of early sends must have the full text)

Lag rule: after release, send once the time is at least local speech end + delay + M, and no new text came for 150 ms. Speech end comes from mic level (mean abs sample > 300 on 16-bit PCM). On a miss (final differs from the sent text), drop the early answer and send the final as today.

| Delay | M   | Sent early | Full text when sent | Mean saving per dictation |
| ----- | --- | ---------- | ------------------- | ------------------------- |
| 1200  | 200 | 39/60      | 74%                 | 188 ms                    |
| 1200  | 400 | 27/60      | 85%                 | 154 ms                    |
| 480   | 400 | 51/60      | 67%                 | 194 ms                    |

- The hit rate depends on server speed: at 1200 with M=0 it fell from 83% to 52% between two passes. Use M=400 to stay safely above 50%.
- Transport (2026-11-01, `luna-transport.cjs`): the early request needs a second socket, see Luna below. HTTP and `response.cancel` are ruled out. The user is fine with Luna running twice on a miss (it is cheap).
- Built (2026-11-01, not yet live-checked), with delay 480, M=400, Q=150:
  - `audioManager.js` keeps the end of the last 25 ms of mic audio above level 300, and the time of the last new words. After release it sends the live text once, through `chatgptSocketEarly`.
  - `chatgptResponsesSocket.js` cleans it on a second ("spare") socket, warmed up at dictation start like the main one. The cleanup request uses that answer only when its user message is exactly the same; otherwise it runs on the main socket as before (with the prefill).
  - Log: "Early cleanup sent" (`afterReleaseMs`), and `early` in `CHATGPT_PLAN_SOCKET`: `hit`, `miss`, `failed` (the early request failed, so the main socket ran) or `none`. `log-timings.cjs` shows both.
  - Not sent on the first dictation after launch (no prompt to reuse yet), or when the final text comes first.
- Replay test (2026-11-01, `early-cleanup-replay.cjs`, now `cleanup-replay.cjs` mode `early`, the app's own socket code, 13 recordings ≤ 30 s, each run once with and once without early cleanup, one run at a time): **no gain**.
  - Early answer used (6): median +43 ms (slower). Wrong text (1): −554 ms. Not sent, so both runs did the same (6): −117 ms, which is the noise between two runs.
  - Why: Mistral now ends only 410–470 ms after release (delay 480), and the early cleanup went out at a median 371 ms, so it is only 40–100 ms ahead. And Luna on the spare socket gets the whole text with no prefill (1306 ms after sending), while the main socket only gets the rest after its prefill.
  - The lab estimate (about 190 ms saved) assumed Mistral ends 600–700 ms after release and did not count the prefill, which came later.
  - Running two copies at once (the first try) made both slower: parallel requests slow Luna down. Run the copies one after the other.
  - Real dictations agree (dev mode with the early cleanup, debug log, 2026-11-01, 10 dictations of 4–35 s): sent in 4, used in 2 (`hit`), wrong text in 1, and in the first it did nothing (no prompt yet, though "Early cleanup sent" was still logged). In the other 6 Mistral's final text came first (`stopMs` 401–509). Release → paste with a hit: 1693 and 1776 ms; with the prefill only: 1701–1928 ms on similar lengths. Mistral was slow once (`stopMs` 1364), and that one was a miss.
  - The run stopped on a network error (`ENOTFOUND api.mistral.ai`) after 13 of 21 files; the script now skips such a file instead.

## Luna (ChatGPT plan, Responses API)

- Luna is now the biggest part of the wait. For a 60-word transcript on a warm socket (16 runs, 2026-10-31): first token after a median of 978 ms, whole answer after 1933 ms.
- The socket runs one request at a time. A wrong early request on it would block the real one.
- Ways to send a second request (`luna-transport.cjs`, 2026-11-01, one run, about 3 tries each):
  - `response.cancel` does nothing on the Responses socket: the response ran to the end (52 deltas, `response.completed`). So a wrong early request on the main socket would block the real one.
  - A second socket works in parallel: with both busy at once, first token 566–946 ms and whole answer 1342–1835 ms on each, about the same as one warm socket alone (616–845 ms / 1356–1385 ms).
  - HTTP is much slower: first token 1558–2575 ms (new connection or reused), whole answer 2718–4407 ms.
  - A new socket's first request is slower (first token 1083 ms), so a second socket must be warmed up too.
- Prefill works (`luna-prefill.cjs`, 16 rounds, 2026-10-31). Send the first ~35 words as a user message with `generate: false`, then the rest as a second user message with `previous_response_id`:
  - Luna kept the first part every time (16/16), and the cleaned text was the same as with one request.
  - First token: median 826 ms vs 978 ms (about 150 ms sooner, sooner in 13/16 rounds). Whole answer: 1770 ms vs 1933 ms.
  - The `generate: false` call itself took 240–640 ms. It must end before the final request is sent, since the socket runs one at a time, so send it while the user speaks or while Mistral catches up.
  - Not tested: a larger prefix (most of the text, as in a real dictation), or several prefill calls as the text grows.
- Built (2026-10-31, live-checked in 0.1.7 on 2026-11-01): at key release `stopStreamingRecording` sends the words Mistral has so far, minus the last word (it may be cut in half), through `chatgptSocketPrefill`. `chatgptResponsesSocket.js` sends it with the last cleanup prompt and `generate: false`. If the final user message starts with that text, the cleanup sends only the rest, continuing the prefill. Otherwise it sends the whole message. The log line `CHATGPT_PLAN_SOCKET` has `prefilled: true` when it was used.
- The plan has a usage limit (error `subscription_sharing_usage_limit_exceeded`). On 2026-10-31 all 5 real dictations hit it: the socket failed after about 0.6 s, the app then tried HTTP for another 1.3–2 s, which fails the same way, and pasted the raw text. Release to paste took 3.0–4.0 s. Don't run Luna tests while the limit is reached; they fail and may use quota.

## Real dictations (installed app 0.1.6, debug log, 2026-10-31, 5 dictations, cleanup failing on the usage limit)

- Release → Mistral final (`stopMs`): 0.7–1.8 s (old delay 1200).
- Release → paste (`toPasteMs`): 3.0–4.0 s, mostly the failed socket + HTTP tries.
- Paste (`pasteMs`): 174–201 ms. The split (`Paste steps timing`) is not in 0.1.6.

## Real dictations (installed app 0.1.7, delay 480, prefill, debug log, 2026-11-01)

- 4 dictations (2, 1.4, 82 and 10 s long). The first after launch has no warm socket and no prefill (both need an earlier cleanup in the same app session).
- Mistral `stopMs`: 581–736 ms (was 0.7–1.8 s at delay 1200).
- Prefill works live: used on the 82 s and 10 s dictations (`prefilled: true`), not on the 1.4 s one. No socket failure.
- `lunaMs`: 1341 (cold), 1006 (warm), 2771 (82 s, prefilled), 1466 (10 s, prefilled). Release → paste: 1949, 1589, 3510, 2095 ms.
- Paste 181–466 ms: focus check 98–341 ms (the first dictation is the slowest), paste helper 82–123 ms.

## Real dictations (installed app 0.1.10, prefill + early cleanup, debug log, 2026-11-01, 25 dictations of 2–41 s)

- Mistral `stopMs`: median about 620 ms (431–1906; one batch fallback after a realtime timeout).
- Prefill (12 cleanups used it): `prefillWaitMs` was 0 in 11 of 12. The prefill (median about 290 ms) had ended before Mistral did. Once it was 927 ms: a 2.5 s dictation whose prefill took 1415 ms. `restChars` 64–85, and 51 of them are the closing `</transcript>` text, so Luna had only the last word or two left to read.
  - **So a rolling prefill has almost nothing left to save**: at most the rare slow prefill (1 in 12 here).
- Luna with the prefill (`lunaMs`, from the cleanup request to the full answer): median about 1560 ms (1280–2594). This is now most of the wait, and the reading is already done, so it is mostly Luna writing the answer.
- Early cleanup: sent 17 times, 11 hits (65%), 6 misses. **Hits are not faster**: from the early send to the answer took a median of about 2370 ms (1360–3840), against about 1560 ms for a prefilled cleanup, because the spare socket reads the whole text with no prefill. The early send is only 50–600 ms ahead of Mistral, so this eats the head start. The longest dictations (23–41 s) took 2.2–3.8 s on a hit.
- Release → paste: about 2.5 s with a hit and about 2.5 s with the prefill (similar lengths: median 9.5 s and 10.3 s). Same result as the replay: no gain.

## Cleanup guesses on prefilled spare sockets (built 2026-11-01, released in 0.1.11)

- The user's idea: Luna is cheap, so keep several prefilled sockets and guess the end of the sentence, even before key release.
- Built: 3 spare sockets. While the user speaks, the spares read the text every 15 words (rolling prefill, skipping the main socket, whose prefill at release already ends before Mistral does). A 50 ms loop from the start of the recording sends a guess to a free spare once speech end + 880 ms passed and no new words came for 150 ms, and again each time the text changed. A guess continues its spare's prefill, so Luna reads only the last words. The cleanup uses the first guess with exactly its text.
- Replay (`cleanup-replay.cjs`, 21 recordings ≤ 30 s, each once per mode, order turning, 2026-11-01):

| Mode                     | Release → cleaned vs base | Hits | Guesses (median) | Before release |
| ------------------------ | ------------------------- | ---- | ---------------- | -------------- |
| `guess` (+880 ms)        | **−414 ms** (all 21)      | 14   | 2                | 1              |
| `guess-fast` (+630 ms)   | −320 ms                   | 19   | 3                | 2              |
| control (did nothing, 3) | +6 ms                     |      |                  |                |

- On a hit (`guess`), Luna's answer came 1568 ms after Mistral's final text, against 2026 ms in base: the guess went out a median 417 ms after release, about 380 ms before Mistral's final text, and read only the last words. The 4 misses had their last guess before release (the user spoke on); they used the main socket like base.
- `guess-fast` hits more often, but saves less. Kept +880 ms.
- **Luna's first token is most of its time**: in this replay, 1.38–1.48 s from request to first token (median), even with only ~70 characters left to read, and about 0.3 s more to write the answer. So the earlier guess from the 0.1.10 logs ("mostly writing") was wrong. `firstTokenMs` is now in the app log (0.1.11) to check it on real dictations.

## Known issues to fix later

- On a usage-limit (`subscription_sharing_usage_limit_exceeded`) or sign-in error, the socket fails and `chatgptPlan.ts` still tries HTTP, which fails the same way. That adds 1.3–2 s before the raw text is pasted. The user called this an exception, to handle later.

## Ideas the user rejected

- A "no change" marker from Luna (almost never happens).
- Asking Luna for an edit list instead of the full text (complex tasks are slower).

## Open questions

- Prefill: how much does it save when the prefix is most of the text, sent at release?
- Early cleanup: the replay and 25 real dictations in 0.1.10 found no gain (see Early send and Real dictations 0.1.10), because the spare socket had no prefill. Replaced by cleanup guesses on prefilled spares in 0.1.11.
- Rolling prefill: the 0.1.10 logs show the prefill at release already ends before Mistral (wait 0 in 11 of 12), so on the main socket it would save almost nothing. It is useful on the spare sockets, where guesses go out before or right after release (see Cleanup guesses).
- Next: check the guesses on real dictations (0.1.11 logs: `early`, `guessesSent`, `earlySentMs`, `firstTokenMs`). Then Luna's first token (about 1.4 s): is it the server, the prompt length, or `service_tier`?
- Next idea: a rolling prefill (send the text to Luna in parts with `generate: false` while the user speaks), so at release only the last words are left. It would help every dictation, not only a right guess. Not tested yet: test it with the replay (SKILL.md section 4).
  - Plan (2026-11-01): while the user speaks, each time the live text grew by about 15 words and no prefill is running, prefill the whole text so far again (it replaces the last one, so the cleanup still has the two tested parts: prefill + rest). In the renderer only (`audioManager.js`, the `onPartial` listener), through the existing `chatgptSocketPrefill`. At release: test sending the prefill as today (`rolling`) or skipping it after a rolling one (`rolling-skip`). Test first with `cleanup-replay.cjs` (modes `rolling`, `rolling-skip`, `rolling-early`).
  - Step 0, built on 2026-11-01 (released in 0.1.10): `CHATGPT_PLAN_SOCKET` logs `prefillWaitMs` (how long the cleanup waited for the warmup and the prefill), `prefillMs` and `restChars` (text left after the prefill). The wait is the most a prefill sent earlier can save at release; `log-timings.cjs` shows all three.
  - The user (2026-11-01): more requests on the plan are fine. A `generate: false` request adds no output tokens, so the number of requests is not a reason to reject an idea.
- Paste: why is the first focus check slower (341 ms vs 98–181 ms)?
- Socket fallback: how often does it fail and fall back to HTTP? (Warning `ChatGPT socket failed, using HTTP` in `errors.log`.)
- Does `context_bias` change the accuracy of the lower delays?
