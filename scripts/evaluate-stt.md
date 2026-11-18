# Compare speech models on your dictations

Open History, play a recording, and use **Review spoken words** to save exactly what you said. Save an empty reference for silence. Review a mix of routine recordings and mistakes. Reviewing only mistakes will make everyday accuracy look worse.

Run this command from the project folder.

```sh
vp env exec node scripts/evaluate-stt.js
```

The command reads your local history and replays reviewed audio with the installed Parakeet model. It uses no network and prints totals without transcripts. Only saved audio can be replayed. Reviewed recordings made before the app began saving original model results count toward candidate-only scores.

The report groups clips by the original app version, speech model and candidate model. Word error rate (WER) counts added, missing and changed words per 100 reference words. Case and punctuation are ignored. When all references in a group are silent, the report gives edit counts and leaves the rate empty. The original time runs from key release to raw text. Replay time measures processing a saved clip and includes loading the model on the first run.

You can also check for changes before reviewing any words.

```sh
vp env exec node scripts/evaluate-stt.js --agreement --show-mismatches
```

This compares raw model outputs for the 30 newest unreviewed recordings with a saved original result. It reports how often they disagree. Both models can make the same mistake. Use the listed history IDs to choose recordings to review. Set `--limit N` to change the sample size. To repeat a sample after more dictations, pass its reported `throughId` with `--through-id N`. Review changes and your normal history retention still affect which clips are available.

To compare a different model, use `--list-inputs` to print each selected recording's ID and local audio path. Run that model on those files and save its raw results as one JSON object per line. For example, a model result can look like this.

```json
{"id":"recording-id-from-list","model":"name-and-version","text":"raw model output"}
```

Pass the file to `--predictions <path>` using the same sample options. This scores the supplied results without running Parakeet. Missing predictions and missing audio are counted separately. Use `--profile <folder>` to read a different profile containing `transcriptions.db` and `audio/`.
