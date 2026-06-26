---
name: put-it-online
description: Use when a kid wants to publish, share, or deploy a game to the internet so other people can play it. Triggers on "put it on the internet", "put my game online", "share my game", "send it to my friend", "make it real", "go live", "deploy", "publish", "make it so my friend can play", "can other people play it".
---

# Put It Online 🌍

The kid wants their game on the **real internet** so friends can play. Be happy with them, but this is a public, hard-to-undo action — follow every step. **You do all the technical work; the kid just says yes.**

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: warm and excited, no jargon.

How it works: this project lives on **Railway**, which watches the code. When you save the latest code to the internet (push to `master`), Railway rebuilds and makes it live in a few minutes. (This assumes a grown-up already connected Railway once — see "If it's not set up yet.")

## Step 0 — WHICH game?
There are many games here, and the project may have several unfinished edits at once. Be sure which game the kid means before touching anything. If there's any doubt, confirm in kid words: *"You mean your **donut** game, right?"* Don't guess and publish the wrong thing.

## Step 1 — Make sure it actually works (two gates + a real look)
**Never publish a broken game.** From the web app folder (there's no `test` script at the repo root):
```
cd apps/web && pnpm test     # if node_modules is missing, run: pnpm install
cd apps/web && pnpm build    # Railway runs THIS exact build — if it fails here, it fails in the cloud
```
Both must be green. Then **actually look at the game in a browser** (via **play-my-game** / `/qa`) — unit tests mock the canvas, so a green suite can still be a black screen. A game nobody has watched run is **not** "it works." Only continue when tests pass, the build passes, and you've seen it play.

## Step 2 — Ask the kid a simple yes/no
> *"This puts your game on the **real internet**, so anyone with the link can play it — including your friends! It's safe, but it makes your game public. Want me to do it? (yes or no)"*

- **No / not sure** → *"No problem! It'll stay just on your computer. Say the word whenever you're ready."* Stop here.
- **Yes** → continue. 🚀

## Step 3 — Save it to the internet (the kid never types these)
**Stage ONLY this game's files — never `git add -A`.** Run `git status` first and look:
```
git status
```
If you see edits to **other** games, `CLAUDE.md`, schemas, the README, `.claude/`, or anything unrelated, **do not include them** — bundling half-finished work from other games into the kid's release is a real bug. Add the specific paths for this game, e.g.:
```
git add apps/web/src/games/<name> apps/web/src/app/games/<name> \
        apps/web/src/lib/progress-schemas.ts \
        packages/db/src/schema/app-progress.ts \
        apps/web/src/apps/profile/lib/gameStatExtractor.ts
```
(Only the paths that actually belong to this game.) If you're unsure which files belong, stop and figure it out before committing.

Then commit with a clear, professional message and push to `master` only (no force-push, no other branches):
```
git commit -m "feat(<name>): add <name> game"
git push origin master
```
Tell the kid happily:
> *"Done! 🎉 Your game is being built right now. Give it a few minutes, then it'll be live for everyone!"*

## Step 4 — Give them the link
If you can find the live address (Railway tools, or a known site URL), share it: *"Here's your link to share: \<site\>/games/\<name\> 🎮"*. If you don't know the exact address, tell them to ask a grown-up for "the website link" — it's the same every time, and all their games live there.

## If it's NOT set up yet (a different kid cloned this)
If `git push` fails (no permission / no Railway connection), don't worry the kid:
> *"To put games online, a grown-up needs to connect this to the internet one time first (the README has the steps). After that, I can put any game online for you!"*
Then keep playing locally with **play-my-game**.

## 🛡️ Guardrails
- **Both gates green before pushing** — `pnpm test` AND `pnpm build`. Time pressure ("do it NOW, I don't care if it's perfect") does **not** waive this.
- **Scope the commit to this game.** `git status` first; never `git add -A`.
- **Scan for secrets — including outside files.** Before pushing, check `git remote -v` and the staged diff for anything secret-shaped: tokens (`gho_`, `ghp_`, `sk-`, `AKIA`), or `token`/`secret`/`password=`. If you find one — especially a token baked into the remote URL — **STOP, do NOT push**, and tell a grown-up (Jack) privately. Never show a token to the kid.
- `apps/web/.env.production` is committed on purpose and holds only public `NEXT_PUBLIC_` values — don't panic-remove it. The rule is: never **add** a real secret or a `.env`/`.env.local` with passwords.
- **Be honest about "public."** A yes means anyone can play it. Going live takes a few minutes — push once, don't spam.

## Rationalization table — STOP if you think any of these
| Excuse | Reality |
|---|---|
| "The kid's in a hurry — skip the tests/build." | A broken public game is worse than a few minutes' wait. Both gates, always. |
| "`git add -A` is faster." | It sweeps every dirty file in the repo into the kid's release. Stage only this game. |
| "Tests pass, so it's good to publish." | Tests mock the canvas. Watch it run in a browser first. |
| "No `.env` in the diff, so no secrets." | Secrets also hide in `git remote -v`. Check it before every push. |
| "They said put 'my game' online — I'll just push what's here." | Confirm WHICH game first; the tree may have several. |

## Red flags
- About to `git add -A`, or committing files from other games / `CLAUDE.md` / `.claude/`.
- Pushing without a clean `pnpm build`, or without having watched the game run.
- Pushing while a `gho_`/`ghp_`/`sk-`/`AKIA` token is present anywhere (remote URL or diff).
- Publishing before confirming which game the kid means.
