---
name: setup-website-deploy
description: Set up or repair the automatic Cloudflare deploy of the website (website/ → only-whispers.bonobo-senate.com). Use when the "Deploy website" GitHub Action fails with an authentication error, when the Cloudflare API token must be rotated (it expires every 7 days), or on a new Cloudflare account or a new computer.
---

# Set up the website deploy

The website in `website/` is a Cloudflare Worker with static assets (`website/wrangler.jsonc`). The GitHub Action `.github/workflows/deploy-website.yml` deploys it on every push to `main` that changes `website/`. It reads two values from the GitHub repo settings, named in the `env` of its Deploy step:

- a secret with a Cloudflare API token. **The token expires every 7 days**, so this skill is mostly for rotating it.
- a variable with the Cloudflare account id.

## Rules

- Always pass `--repo raythurnvoid/only-whispers` to `gh`. Without it, `gh` uses the upstream repo (`OpenWhispr/openwhispr`).
- Never read, print, paste or store the token value. The user copies it from Cloudflare and pastes it into `gh secret set` in their own terminal.
- Never write personal data or setup details into the repo or the chat: no email, no account name, no account id, no browser profile name, no secret or variable names. The `wrangler whoami` account name contains the user's email, so print only the account id.
- Run Node tools through Vite Plus with pnpm: `vp env exec pnpm dlx wrangler@4.152.0 ...`. After any local wrangler command, remove the `website/.wrangler/` folder it leaves behind.

## 1. Check what is broken

Read the secret and variable names from the workflow, then:

```bash
gh secret list --repo raythurnvoid/only-whispers
gh variable list --repo raythurnvoid/only-whispers
gh run list --repo raythurnvoid/only-whispers --workflow deploy-website.yml --limit 3
```

`Authentication error [code: 10000]` or `Invalid API Token` in the last failed run means the token expired or was deleted: do steps 3 to 5. A missing variable means step 2 too.

## 2. Account id (only if the variable is missing or the account changed)

From `website/`, check that wrangler is logged in (`wrangler login` opens the browser if it is not), then print only the 32-character id and save it as the workflow's variable:

```bash
vp env exec pnpm dlx wrangler@4.152.0 whoami 2>&1 | grep -oE "\b[0-9a-f]{32}\b"
gh variable set <variable name> --repo raythurnvoid/only-whispers --body <id>
```

## 3. Prepare the new token in the browser

Use Playwriter in the user's browser, where they are logged in to Cloudflare. Open a new tab, so other tabs stay as they are. The user clicks the final **Create Token** button, never you.

1. Open `https://dash.cloudflare.com/profile/api-tokens` and click **Create Token**.
2. Click **Use template** on the **Edit Cloudflare Workers** row. Every template row has a "Use template" button, so pick the one whose row contains "Edit Cloudflare Workers".
3. Fill the form:
   - **Token name:** a short name that says what it is for, such as `website deploy` (the first `input`).
   - **Account Resources:** Include → the user's account.
   - **Zone Resources:** Include → Specific zone → the website's zone (the domain in `website/wrangler.jsonc`).
   - **Token expiration:** 7 days.
   - Leave the permissions and IP filtering as the template sets them.
4. Click **Continue to summary**, check the summary, and bring the tab to the front.

Form tips: the pickers are `input[role=combobox][placeholder="Select..."]`. The first ones belong to the permission rows, and the **last two** are the account and the zone. Opening a permission picker by mistake shows a long list of permissions: press Escape, and check that the row still has its value.

## 4. The user creates the token and saves it

Ask the user to click **Create Token**, copy the value, and save it as the workflow's secret in their own terminal:

```bash
gh secret set <secret name> --repo raythurnvoid/only-whispers
```

It asks for the value, so the token never shows up in the chat or the shell history. Then the user can delete the old, expired token from the API Tokens list.

## 5. Check that the deploy works

```bash
gh workflow run deploy-website.yml --repo raythurnvoid/only-whispers --ref main
gh run list --repo raythurnvoid/only-whispers --workflow deploy-website.yml --limit 1
gh run watch <run id> --repo raythurnvoid/only-whispers --exit-status
```

Run `gh run watch` in the background. When it passes, check the live site:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://only-whispers.bonobo-senate.com/
```
