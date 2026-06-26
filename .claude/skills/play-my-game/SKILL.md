---
name: play-my-game
description: Use when a kid wants to see, play, run, or test a game on their own computer, and after building or changing a game. Triggers on "let me play", "show me my game", "run it", "I want to play", "open it", "can I play now", "is it working?", "let me see it", "start the game", "show me on the screen".
---

# Play My Game 🕹️

The kid wants to SEE and PLAY a game now — or you just built or changed one. Get it running, open it on their screen, and **bring it to the front automatically** the moment a build or change finishes (don't wait to be asked). They don't know how to "run a server" — that's all you.

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: warm and excited. *"Let's play it! One sec… 🎮"*

## Step 1 — Make sure it can run
If anything errors about missing modules, fix it quietly first (don't make the kid debug):
```
pnpm install
```

## Step 2 — Start it up (in the BACKGROUND)
Run the dev server **in the background** so it keeps running while you talk — a foreground `pnpm dev` blocks and you'd never reach the open step:
```
cd apps/web && pnpm dev
```
Wait for it to print its address. It's usually `http://localhost:3000`, but **if port 3000 is busy `next dev` bumps to 3001, 3002, …** — use the **exact** URL it printed (call it `<BASE>`), never a hardcoded 3000, or the kid lands on the wrong or an old game.

## Step 3 — Open it ON their screen and bring it to the FRONT (automatically)
Don't just tell the kid a web address — **open the game for them and make the window pop to the front** so they can't miss it. Build the URL from the **exact `<BASE>` Step 2 printed** plus the right path: **`/games/<name>`** for a game, **`/apps/<name>`** for an app (apps live under `src/apps/` — using `/games/` for an app 404s, which then looks like a broken game). Then run the open-a-URL command for their computer:
- **macOS:** `open "<BASE>/games/<name>"`
- **Windows:** `start "" "<BASE>/games/<name>"`
- **Linux:** `xdg-open "<BASE>/games/<name>"`

These launch the default browser **and bring it to the front**. If you have a browser tool (Chrome/Playwright), navigate there, bring the tab forward, and take a screenshot so the kid sees it instantly.

Then a quick *"Here it is — your **\<name\>** game! 🎉"*

**After a CHANGE:** do this again — re-open/refocus the URL so the updated game jumps back to the front. The dev server hot-reloads, but you still bring the window forward so the kid SEES the change land and never goes hunting for it.

## Step 4 — Confirm it ACTUALLY works (don't just trust the page loaded)
**A page that loads is not the same as a game that works.** Look at it: is something drawn on screen, and does it respond to a tap or key press? A black screen, a frozen canvas, or a console error means it's **broken** even if the page "opened."
- **Blank / black / error?** → hand to **change-a-game** ("Fixing a broken game"), fix the root cause, then have them refresh.
- **It moves and plays?** → celebrate. 🎉

## Step 5 — Offer the next fun thing
*"That's YOUR game! Want it harder, add something, or put it on the internet so your friends can play?"* (→ **change-a-game** / **put-it-online**).

## Tips
- The dev server hot-reloads on changes — but still re-open/refocus the game window after a change so it pops to the front and the kid sees the new thing.
- `http://localhost:3000` works only on **this** computer. Friends playing = **put-it-online**.
- Closed everything and came back? Just start it again — nothing is lost.

## 🛡️ Guardrails
- Local only — safe, nothing goes public here.
- Don't print or expose any secrets/tokens while starting things up.
- Never tell the kid it "works" just because the page opened — confirm you saw it render and respond.
