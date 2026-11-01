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

## Known issues to fix later

- On a usage-limit (`subscription_sharing_usage_limit_exceeded`) or sign-in error, the socket fails and `chatgptPlan.ts` still tries HTTP, which fails the same way. That adds 1.3–2 s before the raw text is pasted. The user called this an exception, to handle later.

## Ideas the user rejected

- A "no change" marker from Luna (almost never happens).
- Asking Luna for an edit list instead of the full text (complex tasks are slower).

## Open questions

- Prefill: how much does it save when the prefix is most of the text, sent at release?
- Early cleanup: the real hit rate and saving (`early` in the log). The lab said 67% hits and about 190 ms saved per dictation.
- Paste: why is the first focus check slower (341 ms vs 98–181 ms)?
- Socket fallback: how often does it fail and fall back to HTTP? (Warning `ChatGPT socket failed, using HTTP` in `errors.log`.)
- Does `context_bias` change the accuracy of the lower delays?
