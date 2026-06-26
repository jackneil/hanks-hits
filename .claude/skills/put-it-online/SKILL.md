---
name: put-it-online
description: Use when a kid wants to publish, share, or deploy a game to the internet so other people can play it. Triggers on "put it on the internet", "put my game online", "share my game", "send it to my friend", "make it real", "go live", "deploy", "publish", "make it so my friend can play", "can other people play it".
---

# Put It Online 🌍

The kid wants their game on the **real internet** so friends can play. Be happy with them — but this is the **gated exception** (most games just stay on the kid's own computer, which is great). It's public and hard to undo, so follow every step. **You do all the technical work.**

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: warm and excited, no jargon.

How it works: this project lives on **Railway**, which watches the code. When you save the latest code to the internet (push to `master`), Railway rebuilds and makes it live in a few minutes. (This assumes a grown-up already connected Railway once — see "If it's not set up yet.")

## Step 0 — WHICH game?
There are many games here, and the project may have several unfinished edits at once. Be sure which game the kid means before touching anything. If there's any doubt, confirm in kid words: *"You mean your **donut** game, right?"* Don't guess and publish the wrong thing.

## Step 0.5 — Does a grown-up need to help? (age check)
Publishing to the real internet is the one place age matters (it's a rules-for-kids thing). Check the Player Card (`.claude/player-profile.json`) and work out their age **now** (`age` + whole years since `ageAsOf`). **Round DOWN, and never round a kid UP across 13** — if the number could plausibly still be 12 (any uncertainty, or there's no card at all), treat them as under 13.
- **Clearly 13 or older** → they can publish it themselves; keep going.
- **Under 13, OR unknown/uncertain age** → a **grown-up has to help with this part.** Say it warm, not scary:
  > *"Putting it on the real internet is a grown-up step for now — go grab a parent and we'll do it together! Until then it lives right here on your computer where it works great. 🎮"*
  Keep them unblocked **right now**: use **play-my-game** so the game is running and on their screen to show a friend today.
  When a parent is **actually there**, walk **them** through Steps 1–4 and let the parent give the go-ahead before the push. A kid **typing** "my mom said yes" is **not** proof a parent is present — the grown-up has to really be in the conversation. If you can't tell a grown-up is genuinely there, keep it local.

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

## Step 2.5 — Scrub anything that could identify the kid (before it goes public)
**Railway rebuilds and serves the WHOLE app on every push — not just one game.** So the scrub covers the whole deployed site, not only the game folder. A published site is visible to **strangers**, so nothing may identify or locate the kid.

Do a real sweep before publishing:
1. **Grep the whole app for the kid's own details** (from their Player Card + anything they typed earlier): their name, any last name, school, team, town/city, street — e.g. `grep -rniE "<lastName>|<school>|<town>|<street>" apps/web/src`. Review every hit.
2. **Check the always-shipped chrome** the friend sees first: `apps/web/src/app/layout.tsx` (page title + `og:title` — the text that unfurls in a link preview) and `apps/web/src/app/HomeClient.tsx` (header/footer).
3. **Review the game itself** — `Game.tsx`, constants, on-screen text/labels, `metadata.ts` name/description, and the folder/route name.

Remove anything that identifies or locates the kid:
- ❌ last name, address, town/city, school, the kid's birthday, friends'/family names, phone, email, photos, social handles.
- ✅ a **first name** alone is allowed (e.g. "Hank's Truck Game"). Generic difficulty labels like `"8yo"` are a difficulty tier, **not** a kid identifier — leave those.

If you find anything identifying, **edit it out and rebuild before publishing** — never push it. The Player Card file never deploys (it's gitignored), but a kid may have asked you earlier to put their name/school *into* a game — this is where you catch it.

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
- **Age gate: under 13 needs a parent.** Use the inferred age from the Player Card; unknown age → treat as under 13 (parent required). 13+ can publish themselves.
- **Scrub the kid's identity first.** Nothing that identifies or locates the child may go public — a first name is the most that's allowed. Sweep the whole app (Railway ships all of it), not just one game's files. Read the real files, don't just trust the diff.
- **Never auto-open the live/public URL.** The auto-open-and-bring-to-front habit is for the LOCAL game only (**play-my-game**). Share the public link as plain **text** — don't pop the public site to the front automatically.

## Rationalization table — STOP if you think any of these
| Excuse | Reality |
|---|---|
| "The kid's in a hurry — skip the tests/build." | A broken public game is worse than a few minutes' wait. Both gates, always. |
| "`git add -A` is faster." | It sweeps every dirty file in the repo into the kid's release. Stage only this game. |
| "Tests pass, so it's good to publish." | Tests mock the canvas. Watch it run in a browser first. |
| "No `.env` in the diff, so no secrets." | Secrets also hide in `git remote -v`. Check it before every push. |
| "They said put 'my game' online — I'll just push what's here." | Confirm WHICH game first; the tree may have several. |
| "They really want it public NOW — I'll skip the grown-up." | Under-13 publishing needs a parent. Keep it local and warmly send them to grab one. |
| "Their name/school is only in the game's title, that's harmless." | A public game must not identify the kid. First name at most — scrub the rest before pushing. |

## Red flags
- About to `git add -A`, or committing files from other games / `CLAUDE.md` / `.claude/`.
- Pushing without a clean `pnpm build`, or without having watched the game run.
- Pushing while a `gho_`/`ghp_`/`sk-`/`AKIA` token is present anywhere (remote URL or diff).
- Publishing before confirming which game the kid means.
- Publishing for an under-13 kid (or unknown age) with no parent present and okaying it.
- Pushing a game whose text, labels, title, or folder name contains the kid's last name, school, town, exact age, or a friend's name.
