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
- Not built yet. Plan: early request over HTTP so the warm socket stays free for the final text (the socket runs one request at a time, `chatgptResponsesSocket.js`).

## Luna (ChatGPT plan, Responses API)

- Once it starts, Luna is fast. Output speed is not the problem.
- The socket runs one request at a time. A wrong early request on it would block the real one.
- Not verified: `response.cancel` is documented for the Realtime API, not the Responses socket. The docs may allow parallel `stream_id` lanes on one socket.
- Prefill (send the first part with `generate: false`, then the rest): not measured yet. `scripts/luna-prefill.cjs` is ready; it needs a fresh ChatGPT token.

## Ideas the user rejected

- A "no change" marker from Luna (almost never happens).
- Asking Luna for an edit list instead of the full text (complex tasks are slower).

## Open questions

- Prefill: does it cut Luna's time to first token?
- Paste: how long do the focus check and the paste helper take? (`Paste steps timing`, needs real dictations in debug mode.)
- Socket fallback: how often does it fail and fall back to HTTP? (Warning `ChatGPT socket failed, using HTTP` in `errors.log`.)
- Does `context_bias` change the accuracy of the lower delays?
