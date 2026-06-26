---
name: change-a-game
description: Use when a kid wants to change, improve, or fix a game that already exists. Triggers on "change my game", "make it harder", "make it easier", "make it faster", "add X to my game", "I don't like Y", "the game is broken", "it doesn't work", "it's too hard", "fix my game", "make the truck bigger", "add a level", "more enemies", "make it rainbow", "change all my games".
---

# Change a Game 🔧

The kid wants to tweak or fix an existing game. Make the change, **prove it actually works**, and show them.

**TONE — the blunt/sarcastic style from CLAUDE.md is for Jack ONLY.** To the kid: warm, can-do, no jargon. Describe changes by **feel**, not numbers: *"the pipes are skinnier and zoom faster!"* not *"GAP=105, SPEED=3.6."*

## Step 1 — Which game?
If unclear, ask simply: *"Which game — the truck one, or a different one?"* If they just made one this session, it's probably that. Find its folder: `apps/web/src/games/<name>/` (or `src/apps/<name>/`).

## Step 2 — Turn their wish into a real change
- "harder" → faster / more enemies / smaller target / less time. **"easier" → the opposite.**
- "add a dog / level / power-up" → a new thing inside that game.
- "it's broken" → go to **Fixing a broken game** below.

**Change ONE lever at a time when you can.** Stacking three difficulty knobs at once (faster AND tighter AND smaller) usually makes it impossible, not fun. Confirm in kid words first: *"Got it — I'll make the donuts fall twice as fast. Ready?"*

## Step 3 — Make the change — and know where things actually live
A game is **one island, but it spans two folders:** the module `apps/web/src/games/<name>/` AND its thin route `apps/web/src/app/games/<name>/page.tsx`.
- **Speeds, sizes, counts, difficulty** → `lib/constants.ts`
- **Scoring, lives, what's saved** → `lib/store.ts`
- **How it plays / looks inside** → `Game.tsx` / `components/`
- **Page background / page-level color / theme** → usually the **route page** `src/app/games/<name>/page.tsx` (`min-h-screen bg-...`). Most games set their background here, not in the module. (A few, like 2048, set it in both — change both.)

**Read the file before you claim you added something.** If the feature already exists (e.g. flappy's bird is already an animated rainbow in `Game.tsx`), don't fake-add it — tell the kid happily it's already there and make it pop more. Ground every claim in the real code, never in what you assume. Before declaring a CSS class "missing," check the component's own `<style jsx>` block, not just `globals.css` — classes are often defined locally.

Editing **this game's own** module and route page is fine — that's still its island. The danger zone is **truly shared** code (see next section).

## When the kid wants to change MANY games at once 🌈
("make ALL my games rainbow", "theme the whole site", "change every game")

**STOP — this is not one island.** It fans out across ~25 games + ~9 apps, each self-contained. There is **no global theme switch** you should hack.
1. Do it **one game at a time**, each in its own files, and run the gates after each.
2. **Never** hack a truly-shared file to fake "all at once." The real all-games levers — `apps/web/src/app/globals.css` (the daisyUI theme block) and `apps/web/src/app/layout.tsx` (body background) and anything in `src/shared/` — are the **danger zone**: touching them to restyle "all" games can break every game at once. Don't.
3. **Check what's already done** before editing (e.g. the home page may already be rainbow — celebrate it, don't redo it).
4. Be honest about scope: tell the kid it'll roll out game-by-game, offer to start with their favorite, and report how many are done — never say "all done" after one.

## Fixing a broken game 🩺
1. **Don't guess. Look first.** Reproduce it: open it with **play-my-game** and read the real error (browser console / terminal). Run the gates (below).
2. Find the **root cause** (read the code around the error), fix it, don't band-aid.
3. Re-run and confirm it's actually fixed.
4. Tell the kid happily: *"Found it and fixed it! Try now."*

If you add a brand-new saved value, remember the save plumbing from **make-a-game** (Progress type + the Zod schema in `apps/web/src/lib/progress-schemas.ts`), or saving silently breaks.

## Step 4 — Prove it works (don't trust a green suite)
1. `cd apps/web && pnpm test` — **but most games (flappy, snake, etc.) have NO test**, so green here often proves nothing about your change. If the game you changed has no test, **add one** for the logic you changed (copy `src/games/arkanoid/__tests__/store.test.ts`). Then make sure your new test passes.
2. `cd apps/web && pnpm build` — typecheck gate; must pass.
3. **Run the actual game** (via **play-my-game**) and watch your change: did the rainbow really render? Is the harder version still **beatable by a 9-year-old**? If you stacked changes and it's brutal, dial it back. Judge the **running game**, not the numbers in `constants.ts`.

## Step 5 — Show + offer more
Let them try it (via **play-my-game**). Then: *"Like it? Want it even harder, or put it online?"*

## Rationalization table — STOP if you think any of these
| Excuse | Reality |
|---|---|
| "`pnpm test` passed, so my change works." | The suite likely never touches this game. Add a test and watch it run. |
| "I added the rainbow bird!" | Read `Game.tsx` first — it may already exist. Don't fake-add features. |
| "Make it harder = crank every knob." | One lever at a time, then check it's still beatable. |
| "Background changes go in the game module." | For most games it's the **route page** under `src/app/games/<name>/`. |
| "I'll theme all games via a shared file." | That can break all 30+ at once. One game at a time, never the shared theme block. |
| "This class is defined nowhere." | Check the component's local `<style jsx>` before declaring it missing. |

## Red flags
- Reporting a change "done" on a green suite that never ran this game.
- Editing `src/shared/`, `globals.css`, `layout.tsx`, or another game to change one (or "all") games.
- Claiming to add something without reading the file first.
- Stacking difficulty multipliers with no beatability check.
- Any sarcasm, or describing the change in raw numbers to the kid.
