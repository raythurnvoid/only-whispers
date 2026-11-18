<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.png" />
    <img src=".github/logo-light.png" alt="Only Whispers" width="432" height="144" />
  </picture>
</h1>

<p align="center">
  <em>Hold the Key, speak, and get clean text in any app.</em><br/>
  <a href="https://only-whispers.bonobo-senate.com"><strong>Website</strong></a> ·
  <a href="https://github.com/raythurnvoid/only-whispers/releases/latest">Releases</a> ·
  <a href="#privacy">Privacy</a>
</p>

---

## How it works

1. Hold the Key and speak.
2. Let go.
3. Clean text appears where your cursor is, in any app.

## Install

1. Download the app for your platform from the [website](https://only-whispers.bonobo-senate.com) or the [latest release](https://github.com/raythurnvoid/only-whispers/releases/latest).
2. On the setup screen:
   - Download **Parakeet** for speech recognition on your computer.
   - Click **Sign in with ChatGPT**.

The app updates itself. When a release changes the local model, the app downloads the new version.
For live transcription, you can add a paid Mistral API key in Settings. If Mistral reaches its limit, the app uses Parakeet.

The local model is [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Only Whispers downloads the [8-bit sherpa-onnx conversion](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8).

**macOS** (preview, Apple Silicon only): open the `.dmg` and drag the app to Applications. The app is not checked by Apple, so macOS blocks the first open: go to System Settings → Privacy & Security and click **Open Anyway**. You do this once; updates open normally.

## Privacy

Your words stay yours.

- We never see your voice or your text. There is no account with us.
- Parakeet processes audio on your computer. Adding a Mistral key sends audio to Mistral for transcription.
- When cleanup is enabled, ChatGPT receives the transcript.
- Your history stays on your computer.

You can review a recording in History and use it to compare speech models on the same audio. [Run a local comparison](scripts/evaluate-stt.md)

With local history enabled, open **Logs → Open logs folder** and look for `dictionary-edits.jsonl`. Events with the same `pasteId` belong to one dictation. If the same candidate ID appears in `undone` and then `repeat-suppressed`, the app saw that word again and respected your Undo. The log leaves out the words and the text you typed.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- Committers and reviewers: [raythurnvoid](https://github.com/raythurnvoid)
- Approvers: [raythurnvoid](https://github.com/raythurnvoid)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Only Whispers is open source under the [MIT License](LICENSE).

Made by Daniele Loreto ([GitHub](https://github.com/raythurnvoid), [LinkedIn](https://www.linkedin.com/in/ray-thurn-void), [X](https://x.com/raythurnvoid)).

Based on [OpenWhispr](https://github.com/OpenWhispr/openwhispr) by Gabriel Stein ([LinkedIn](https://www.linkedin.com/in/gabrielste1n)). The "Sign in with ChatGPT" flow is based on [OpenCode](https://github.com/anomalyco/opencode).
