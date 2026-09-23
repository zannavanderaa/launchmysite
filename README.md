# launchmysite

A Claude Code skill by BeYourOwnCEO. Someone says "launch my site" (or "zet mijn website online") and Claude walks them, one calm step at a time, from nothing to their own website on their own new domain, with a preview-first routine for every later change.

Version 0.1.0 (v1). Built 2026-09-23.

## What it does

The person does only what only a human can do. Claude does the rest.

| Phase | The person | Claude |
|---|---|---|
| 0. Tools | Clicks Yes on Windows install prompts; on Mac types their password for Homebrew; restarts the app once | Checks and installs Git, GitHub CLI, Node.js LTS, Netlify CLI (winget on Windows, Homebrew on Mac) |
| 1. Accounts | Creates free GitHub, Netlify and Porkbun accounts | Explains what each one is for |
| 2. Domain | Buys a new domain at Porkbun and pays | Explains what to pick and what to decline |
| 3. Logins | `gh auth login` and `netlify login` in the terminal pane, clicks Authorize; creates a Porkbun API key and switches API Access on for the domain | Explains exactly what each permission allows and does not allow |
| 4. Build | Approves the first version of the site locally; pastes one line in the terminal pane and types the Porkbun keys there | Creates the site from a starter, an HTML design or a picture/PDF design; private GitHub repo; Netlify site linked to it; custom domain; Porkbun DNS (bare domain ALIAS, www CNAME); waits for DNS and HTTPS |
| 5. Handover | Deletes the Porkbun key | Writes the site's `CLAUDE.md` and pre-push hook, explains credits once, hands over a "what you own and where it lives" summary |

Every later change: Claude works on a branch, opens a pull request, Netlify builds a free deploy preview, Claude says "Here is how it will look: <link>. Shall I put this live?" and merges only on yes. The person never hears "PR" or "merge".

Out of scope in v1, and the skill says so honestly: existing domains (v1.1), sites with a build step (frameworks), WordPress.

## Layout

```
.claude-plugin/marketplace.json          marketplace "beyourownceo"
plugins/launchmysite/
  .claude-plugin/plugin.json             plugin "launchmysite", version 0.1.0
  skills/launchmysite/                   self-contained: copy this folder alone and it still works
    SKILL.md                             the whole flow
    scripts/_lib.mjs                     shared helpers, token handling
    scripts/netlify.mjs                  whoami, setup (replaces netlify init), build, status, domain, tls, preview, count
    scripts/porkbun-dns.mjs              points bare domain and www at Netlify, nothing else
    scripts/check-site.mjs               DNS (two resolvers) and HTTPS check from outside
    templates/site-CLAUDE.md             the rules written into the person's site project
    templates/githooks/pre-push          refuses a direct push to main
    templates/starter/                   one-page starter, netlify.toml, gitignore, gitattributes
```

Scripts are plain Node (20+), no dependencies. They never print, log or write a secret. The Netlify token is read from the Netlify CLI's own login file (or `NETLIFY_AUTH_TOKEN`), the GitHub token from `gh auth token`, the Porkbun keys from `PORKBUN_API_KEY` / `PORKBUN_SECRET_API_KEY` or a hidden prompt. Nothing reads a key from a file in the repository.

## Installing

The target user runs the **Claude desktop app, Code tab, Local session**, Pro plan, on Windows or Mac.

**Route A, plugin marketplace (needs this repo public on GitHub first, Zanna's decision).** In the Claude Code CLI, or typed into the desktop prompt box if the desktop app accepts it:

```
/plugin marketplace add <github-owner>/launchmysite
/plugin install launchmysite@beyourownceo
```

In the desktop app the documented route is the plugin browser: **+** next to the prompt box, Plugins, Add plugin. That browser lists plugins from marketplaces that are already configured; **whether a non-technical user can add this marketplace from the desktop app without typing a slash command is not verified.** The Claude Code docs say `/plugin` is an interactive terminal panel and that desktop users should use the plugin browser instead. Test this on a clean desktop install before publishing instructions.

**Route B, copy the skill folder (works today, no GitHub needed).** Copy `plugins/launchmysite/skills/launchmysite/` to `~/.claude/skills/launchmysite/` (Windows: `%USERPROFILE%\.claude\skills\launchmysite\`). Local desktop sessions load personal skills from there (checked: code.claude.com/docs/en/desktop). A brand-new `skills` folder is only picked up after restarting the app. For a beginner the practical form is: the public page gives them one sentence to paste to Claude, asking Claude to download this folder into their skills folder; that needs Git or a zip download link, so it belongs after Git exists or uses a zip.

Before publishing: run `claude plugin validate .` in this repo (not run; the `claude` CLI is not on PATH on this machine).

## What belongs on the public page, not in the skill

The skill starts at the first moment Claude can talk to the person. Everything before that is the public page's job:

- Download the Claude desktop app (Windows or Mac) and install it.
- Choose the Pro plan and sign in.
- Open the Code tab, start a **Local** session (not Cloud: cloud sessions do not load `~/.claude/skills` or desktop-installed plugins), and pick or create a folder to start in.
- Install the skill (route A or B above).
- Ask "Do you already have a design?" and build that answer into the sentence they paste, for example "Launch my site. I have a design as an HTML file in my Downloads." The skill accepts the answer from the first message and does not ask again.
- Set expectations: about an hour of their time, three free accounts, one payment (the domain, around 8 to 11 dollars a year for .nl or .com at Porkbun), and some waiting for the address to work.

## What was tested, and what was not

Tested on this machine (Windows 11, Git for Windows 2.53, bun 1.3 standing in for Node, which is not installed here):

- All four scripts parse. Their argument and not-logged-in error paths behave as written.
- `check-site.mjs` against a real Netlify site (`beyourownceo.ai`): DNS at Google and Cloudflare, HTTPS 200 on the bare domain and 301 on www, reported live. Against `example.com`: reported not live.
- The pre-push hook, against a local bare remote: blocks `git push origin main`, `git push --dry-run origin HEAD:main` and `git push origin change/x:main`; allows pushing a branch. Also blocks correctly when the hook file has Windows line endings.

Not tested:

- **The live GitHub and Netlify test did not run.** The Netlify CLI and Node.js are not installed on this machine and Netlify has never been logged in here, which needs Zanna's browser click. See the session report for exactly what to click.
- `netlify.mjs setup`, `build`, `domain`, `tls`, `preview`, `count` against the real Netlify API.
- Whether the webhook-based link (no Netlify GitHub App) gives deploy previews for pull requests in practice. The Netlify CLI source says it subscribes to `pull_request`, and the setup is identical to what `netlify init` creates.
- `porkbun-dns.mjs` against a real Porkbun domain, including how Porkbun's default parking records appear through the API and whether deleting them by id works.
- Fresh Windows and fresh Mac machines: the winget and Homebrew installs, the UAC prompts, the restart-to-refresh-PATH step, `npm install -g netlify-cli` under PowerShell's execution policy.
- `gh auth login --web` and `netlify login` typed into the desktop app's terminal pane.
- Anything on a Mac at all.
- A real domain purchase at Porkbun and what the checkout offers today.

## Design choices worth knowing

- **`netlify.mjs setup` instead of `netlify init`.** The brief said `netlify init`. It cannot be used as-is: `netlify init` asks its questions through interactive menus, which Claude's shell tool cannot answer, and it offers only two GitHub options, a second browser authorisation or pasting a token into a hidden prompt. It does not reuse the `gh` login on its own (checked: netlify/cli `src/utils/gh-auth.ts` and `src/utils/init/config-github.ts`, 2026-09-23). `setup` performs the same API calls `netlify init` makes (read-only deploy key, webhook for push, pull_request and delete, repo link on the site) with the existing `gh` login, so there is no second browser round trip.
- **Netlify's GitHub commit statuses are off by default.** `netlify init` also hands Netlify a copy of the GitHub login token so it can post "preview ready" statuses on GitHub. The person never looks at GitHub, so `setup` skips this unless run with `--commit-status`. Claude finds the preview URL itself: `https://deploy-preview-<n>--<site>.netlify.app`.
- **Only `site/` is published** (`netlify.toml` `publish = "site"`), so `CLAUDE.md`, the hook and other project files are never on the public website.
- **The site's `CLAUDE.md` is complete in the first commit**, because every merge to `main` is a production deploy that costs 15 Netlify credits, including a notes-only change.
- **DNS stays at Porkbun.** Only the bare domain (ALIAS to `apex-loadbalancer.netlify.com`) and www (CNAME to `<site>.netlify.app`) are changed; nameservers never move.

## Claims in SKILL.md that could not be fully verified

- **Porkbun key, the honest version.** Zanna's example wording ("It cannot spend money, buy domains") is **not true** and was not used. Per the Porkbun API spec (v3.39, checked 2026-09-23), an API key can register domains from prepaid account credit, and `POST /account/topup` charges the saved card (capped by the account's monthly spend limit, or 100 dollars a month when none is set, emailed each time). A per-key domain allowlist exists (gear icon next to the key) but does not cover account-level endpoints like top-up. SKILL.md says this plainly and has the person delete the key afterwards.
- **Netlify login scope.** Netlify's docs describe how to revoke the CLI (User settings, Applications, Authorized applications) but I found no page stating what the CLI's OAuth token can and cannot do. SKILL.md says honestly that it is broad, roughly what they can do in the dashboard, and only claims that it does not reveal their password.
- **GitHub login scope.** `repo`, `read:org`, `gist` are gh's documented minimum; `workflow` also appeared on this machine. `repo` is full access to public and private repositories including webhooks; deletion needs `delete_repo`, which gh does not request (checked: GitHub OAuth scopes docs). The revoke path "Settings, Applications" is from general knowledge, not re-read.
- **Porkbun checkout.** That checkout pushes no pre-selected extras comes from third-party reviews, not from Porkbun. WHOIS privacy free and on by default is from Porkbun's own API docs.
- **Porkbun default parking records.** That new domains carry parking records on the bare domain and www, and that they can be deleted through `/dns/delete`, is from memory. The script prints a NOTE for unrecognised record types and verifies the result by reading it back.
- **Desktop app restart for PATH.** That the desktop app only picks up newly installed tools after a full restart is inferred from the docs ("On Windows, the app inherits user and system environment variables"; "PATH updates only apply to new terminal sessions"), not tested.
- **`gh auth login` prompt wording** ("press Enter", "authenticate Git") is from memory of gh's interactive flow.
- **Netlify Free plan numbers** (300 credits, 15 per production deploy, previews free, 20 credits per GB, site pauses when out) come from the brief, which says they were checked on netlify.com the same day. I did not re-check them.
