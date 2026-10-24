<p align="center">
  <img src="src/assets/logo.svg" alt="only-whispers" width="120" />
</p>

<h1 align="center">only-whispers</h1>

<p align="center">
  Hold a key, speak, and get clean text in any app.<br/>
  A small, cheap Wispr Flow alternative for Windows.
</p>

---

## Install (Windows)

1. Download **[only-whispers-Setup.exe](https://github.com/raythurnvoid/only-whispers/releases/latest/download/only-whispers-Setup.exe)** from the [latest release](https://github.com/raythurnvoid/only-whispers/releases/latest).
2. Run it. The installer is not signed, so Windows may show "Windows protected your PC". Click **More info**, then **Run anyway**.
3. Open only-whispers and follow the setup screen (see [Setup](#setup)).

## How it works

1. Hold the hotkey (Right Ctrl by default) and speak.
2. Release the key.
3. **Mistral Voxtral 3** turns your speech into text.
4. **OpenAI Luna** cleans the text: it removes filler words and fixes grammar and punctuation. It runs on your ChatGPT plan, so it needs no OpenAI API key.
5. The clean text is pasted where your cursor is.

If the ChatGPT plan fails, cleanup falls back to **Mistral Ministral 8B**.

In my tests, a 14-second clip took about 0.9 s for speech-to-text and about 3 s for cleanup.

## Setup

The first screen asks for two things only:

- A **Mistral API key**. Create one in [Mistral admin](https://admin.mistral.ai/organization/api-keys). The free plan works.
- **Sign in with ChatGPT**, for cleanup on your plan.

There are no other providers or models to choose.

## Cost

- Voxtral Mini Transcribe 3: about $0.0035 per minute of audio.
- Luna cleanup: included in your ChatGPT plan.

## Develop on a new computer

You need:

- [Git](https://git-scm.com/)
- [Node.js 24](https://nodejs.org/) (any Node version manager works)
- [pnpm](https://pnpm.io/installation)

Then:

```bash
git clone https://github.com/raythurnvoid/only-whispers.git
cd only-whispers
pnpm install
pnpm dev
```

`pnpm dev` starts the app with hot reload. The first run also downloads small native helpers (hotkey listener, paste helper), so it needs internet.

Quit the installed only-whispers first, so the two copies don't both react to the hotkey. If the dev app shows the setup screen, add the Mistral key and sign in with ChatGPT again.

Useful commands:

| Command                | What it does                                 |
| ---------------------- | -------------------------------------------- |
| `pnpm test`            | Runs the tests.                              |
| `pnpm run build:win`   | Builds the installer into `dist/`.           |
| `pnpm run build:mac`   | Builds the macOS app (run it on a Mac).      |
| `pnpm run build:linux` | Builds the Linux packages (run it on Linux). |

## Publish a new installer

1. Build it: `pnpm run build:win`.
2. Upload it as the latest release. Keep the asset name `only-whispers-Setup.exe`, so the download link above keeps working:

```bash
cp "dist/only-whispers Setup 0.1.0.exe" dist/only-whispers-Setup.exe
git tag only-whispers-v0.1.0
git push origin only-whispers-v0.1.0
gh release create only-whispers-v0.1.0 dist/only-whispers-Setup.exe --repo raythurnvoid/only-whispers --verify-tag --title "only-whispers 0.1.0" --latest
```

Change the version and the tag to match `package.json`. Keep `--repo`: this clone also has the OpenWhispr `upstream` remote, and without `--repo` the GitHub CLI may pick that repo.

## Voice assistant

Select some text, hold the hotkey, and say "Hey Wisper, make this more formal". The selected text is replaced with the result. You can change the name in Settings → Language Models → Voice Assistant.

## Limits

- Meeting notes are off: Mistral Voxtral has no streaming model in this app.

## Credits

only-whispers is a fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr) (MIT License). Thank you to the OpenWhispr team. See [LICENSE](LICENSE).

The "Sign in with ChatGPT" flow is based on [OpenCode](https://github.com/anomalyco/opencode) (MIT License).
