---
name: play-my-game
description: Use when a kid wants to see, play, run, or test a game on their own computer, and after building or changing a game. Triggers on "let me play", "show me my game", "run it", "I want to play", "open it", "can I play now", "is it working?", "let me see it", "start the game", "show me on the screen".
---

# Play My Game 🕹️

The kid wants to SEE and PLAY a game now. Get it running and put it in front of them. They don't know how to "run a server" — that's all you.

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: warm and excited. *"Let's play it! One sec… 🎮"*

## Step 1 — Make sure it can run
If anything errors about missing modules, fix it quietly first (don't make the kid debug):
```
pnpm install
```

## Step 2 — Start it up (in the background)
```
cd apps/web && pnpm dev
```
Wait for it to say it's ready (it shows an address like `http://localhost:3000`).

## Step 3 — Put it in front of the kid
> *"Your game is ready! Open your web browser and go to **http://localhost:3000** — your game is the one called **\<name\>**! 🎉"*

If you have a browser tool, open it for them and take a screenshot so they don't have to do anything. For a specific game go straight to `http://localhost:3000/games/<name>`.

## Step 4 — Confirm it ACTUALLY works (don't just trust the page loaded)
**A page that loads is not the same as a game that works.** Look at it: is something drawn on screen, and does it respond to a tap or key press? A black screen, a frozen canvas, or a console error means it's **broken** even if the page "opened."
- **Blank / black / error?** → hand to **change-a-game** ("Fixing a broken game"), fix the root cause, then have them refresh.
- **It moves and plays?** → celebrate. 🎉

## Step 5 — Offer the next fun thing
*"That's YOUR game! Want it harder, add something, or put it on the internet so your friends can play?"* (→ **change-a-game** / **put-it-online**).

## Tips
- The dev server auto-refreshes on changes — after a fix, the kid just refreshes.
- `http://localhost:3000` works only on **this** computer. Friends playing = **put-it-online**.
- Closed everything and came back? Just start it again — nothing is lost.

## 🛡️ Guardrails
- Local only — safe, nothing goes public here.
- Don't print or expose any secrets/tokens while starting things up.
- Never tell the kid it "works" just because the page opened — confirm you saw it render and respond.
