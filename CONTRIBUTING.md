# Contributing

Thanks for helping with Only Whispers!

## Set up

You need [Git](https://git-scm.com/), [Node.js 24](https://nodejs.org/) and [pnpm](https://pnpm.io/installation).

```bash
git clone https://github.com/raythurnvoid/only-whispers.git
cd only-whispers
pnpm install
pnpm dev
```

Quit the installed app first, so both copies don't react to the hotkey.

## Commands

| Command          | What it does                    |
| ---------------- | ------------------------------- |
| `pnpm dev`       | Starts the app with hot reload. |
| `pnpm test`      | Runs the tests.                 |
| `pnpm run lint`  | Checks the code with ESLint.    |
| `pnpm typecheck` | Checks the TypeScript types.    |

## Pull requests

- Keep each change small and focused.
- Run `pnpm test`, `pnpm run lint` and `pnpm typecheck` before you open it.
- Put every new UI text in all the files in `src/locales/`.
