# CLAUDE.md

Instructions for Claude when working on this website. Written by the launchmysite skill on {{SETUP_DATE}}.

## Who you are working with

This website belongs to {{OWNER_NAME}}. They are not a developer and do not want to become one. They decide what the website says and when a change goes live. You do everything technical.

- Reply in the language they write in (Dutch or English).
- Address them as "you". Keep it warm, calm and short. Never condescending, never "don't worry, it's easy".
- Never use an em dash in anything you write for them or put on the website. Use a comma, a colon or a full stop.
- Explain in one or two plain sentences before you do anything they will notice.

## Words to use

They do not need the vocabulary of developers. Unless they ask, never say "pull request", "PR", "merge", "branch", "commit", "push" or "repo".

| Instead of | Say |
|---|---|
| deploy preview | preview |
| merge to main | put it live |
| commit / branch | saved version / draft |
| repository on GitHub | the safe copy of your website on GitHub |

## What lives where

| Thing | Where |
|---|---|
| The website files | the `site/` folder in this project. Only this folder is published |
| The safe copy with every past version | GitHub, private repository `{{GITHUB_REPO}}` |
| The hosting | Netlify, site `{{NETLIFY_SITE}}` (its id is in `.netlify/state.json` on this computer) |
| The address | `{{DOMAIN}}`, registered at Porkbun in their own name |
| The Netlify address that always works | https://{{NETLIFY_SITE}}.netlify.app |

## The routine for every change: preview first, live only after a yes

**Never change the live website without a preview and a clear yes.** On free GitHub a private repository cannot protect `main`, so this file is the rule, and the git hook in `.githooks/pre-push` is the mechanical backstop that refuses a direct push to `main`.

1. Start from the current live version:
   `git switch main` then `git pull --ff-only`
2. Start a draft: `git switch -c change/<short-description>`
3. Make the changes in `site/`. Collect everything they asked for in this session into this one draft.
4. Save and upload the draft:
   `git add -A`, `git commit -m "<what changed, in plain words>"`, `git push -u origin HEAD`
5. Ask Netlify for a preview: `gh pr create --base main --fill`. Note the number it prints.
6. Wait for the preview. Its address is always
   `https://deploy-preview-<number>--{{NETLIFY_SITE}}.netlify.app`.
   It returns 404 until the build finishes, usually within a minute or two. Check with
   `curl -s -o /dev/null -w "%{http_code}" <address>` (on Windows PowerShell use `curl.exe`) until it says 200.
7. Show it and ask, in their language, in these words or very close:
   "Here is how it will look: <address>. Shall I put this live?"
8. Only after a clear yes: `gh pr merge <number> --squash --delete-branch`, then `git switch main` and `git pull --ff-only`.
   Wait a minute, check that https://{{DOMAIN}} shows the change, and tell them it is live.
9. If they want something different: change it on the same draft, commit and push again. The preview updates itself at the same address, and previews are free.
10. If they say no altogether: leave the draft alone and say it is kept aside, nothing went live.

Never do any of these, even if asked to "just do it quickly":
- push to `main` directly, use `--no-verify`, force-push, or delete the `main` branch
- change `core.hooksPath` or remove `.githooks/pre-push`
- put a password, API key or token in any file in this project

If `git config core.hooksPath` does not print `.githooks` (for example on a new computer), run `git config core.hooksPath .githooks` before anything else.

## Going live costs credits: batch the changes

The website runs on Netlify's Free plan. That plan has 300 credits a month. Every time a change goes live it costs 15 credits, and visitors downloading the website also use credits (20 credits per GB). Previews are free. **When the credits run out on the Free plan, the website is paused until the next month, and on Free there is no way to buy more.**

So:
- Any go-live costs the same 15 credits, even one that only changes this CLAUDE.md or other files outside `site/`. Never put such a notes-only change live on its own; include it in the next draft that changes the website.
- Collect several changes into one draft and one go-live. Aim for no more than about 15 go-lives in a month, which leaves room for visitors.
- The first time they ask for a second go-live on the same day, explain this once, simply, for example: "Each time we put something live, Netlify uses a bit of your free monthly allowance. If we collect a few changes and put them live together, your site never runs out. Shall I wait and add this to the next batch?" Do not repeat the explanation every time.
- If they go live often, count this month's go-lives. If the launchmysite skill is installed, run its `scripts/netlify.mjs count` from this folder. Otherwise count the merged changes since the first of the month with `gh pr list --state merged --search "merged:>=YYYY-MM-01"`. The real credit total, including visitors, is in the Netlify dashboard under the team's Usage page; offer to walk them there.

## Undoing a change

Every version is kept on GitHub. To undo, make a draft that reverses the change (`git revert <commit>` on a new draft), show the preview and ask, exactly as above. Never rewrite history.

## If something is wrong

- The preview address stays 404 for more than 10 minutes: look at the build log in the Netlify dashboard (Deploys) and explain what failed in one plain sentence.
- The website shows "Site not available" or similar and they did not change anything: the monthly credits may be used up. Check Netlify, Usage. Explain honestly; it comes back at the start of the next month or with a paid plan, which is their decision.
- The domain stops working: check with `nslookup {{DOMAIN}}` and `nslookup www.{{DOMAIN}}`. The bare domain should point to `apex-loadbalancer.netlify.com` (an ALIAS at Porkbun) and www to `{{NETLIFY_SITE}}.netlify.app`. Changing DNS needs a new Porkbun API key from them, which they can create and delete afterwards.
