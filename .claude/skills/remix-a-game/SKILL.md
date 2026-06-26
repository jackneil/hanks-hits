---
name: remix-a-game
description: Use when a kid wants a new game based on one that already exists — "make one like X but Y". Triggers on "make one like my truck game but dinosaurs", "do a snake game but space", "remix", "like X but Y", "same as my game but with…", "copy my game and change it", "another one like that but different". This is the default fun path — start from a game they love, don't build from a blank page.
---

# Remix a Game 🎨

The kid wants "one like X, but Y." **Copy a working game and re-theme it** — never start from scratch. This gives an instant working thing to tweak, which is how kids actually love to create. (Research: remixing is the #1 way kids build; the blank page is paralyzing.)

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: *"Ooh, your truck game but DINOSAURS? Let's do it! 🦕"*

## Step 1 — Find the source + the twist
- **Source game (X):** which game to copy. It can be one of the kid's own (the `madeByKid: true` ones — see **my-creations**) or any built-in in `apps/web/src/games/`. Confirm: *"You mean your **truck** game, right?"*
- **Twist (Y):** what changes — usually the theme/look ("dinosaurs", "space", "underwater"), sometimes a rule. The *mechanics* stay; the *skin* changes.
- **Pick a clean new id** yourself (lowercase-ascii-hyphen): "truck game but dinosaurs" → `dino-dash`. (Same id rules as make-a-game — the kid's words are the name/emoji; you invent the slug.)

## Step 2 — Copy the whole island
Copy BOTH folders for the source `<src>` into the new id `<new>`:
```
cp -r apps/web/src/games/<src>      apps/web/src/games/<new>
cp -r apps/web/src/app/games/<src>  apps/web/src/app/games/<new>
```
(For an app, use `src/apps/<src>` + `src/app/apps/<src>`.)

## Step 3 — Re-id EVERYTHING (the part that breaks if you miss one)
The copy still says the old id all over. **Every load-bearing reference must become the new id**, or the remix shares save-data with the original (a real bug) or won't compile:
- `metadata.ts` → `id`, `name`, `emoji` (and `madeByKid: true`)
- `lib/store.ts` → the persist `name: "<src>-state"` → `"<new>-state"` **(critical — same name = shared localStorage with the original)**, and the store hook/types (`useSrcStore`→`useNewStore`) for clarity
- `Game.tsx` → `useAuthSync({ appId: "<new>", localStorageKey: "<new>-state", … })`, and the store import
- `index.ts` → exports
- the route `src/app/games/<new>/page.tsx` → `dynamic(() => import("@/games/<new>"))`, `<GameShell gameName="…" appId="<new>">`

After re-id-ing, **grep to be sure**: `grep -rn "<src>" apps/web/src/games/<new> apps/web/src/app/games/<new>` should return nothing referencing the old id.

## Step 4 — Register the new id (same as make-a-game ①②③)
- `packages/db/src/schema/app-progress.ts` → add `"<new>"` to `VALID_APP_IDS` (do this so `Game.tsx` typechecks).
- `apps/web/src/lib/progress-schemas.ts` → copy the source's schema entry under `"<new>"` (the saved fields are the same shape).
- `apps/web/src/apps/profile/lib/gameStatExtractor.ts` → copy the source's `case` as `case "<new>":`.

## Step 5 — Re-theme to the twist
Now make it look like Y: colors, sprite shapes/emoji, labels, on-screen text, the background, the metadata `name`/`emoji`. Keep the mechanics that already work; change the skin. (For richer art/sound, hand to **make-it-mine** if it exists.) Kid-safe content rules from make-a-game still apply.

## Step 6 — Prove it works (same gates as make-a-game)
1. `cd apps/web && pnpm test`
2. `cd apps/web && pnpm build` — the **real gate**: a missed re-id or unregistered `appId` fails the TypeScript step here.
3. Watch it run (→ **play-my-game**, auto-open + front).

## Step 7 — Show + celebrate
- The `madeByKid: true` in its `metadata.ts` (Step 3) already puts it on the kid's **my-creations** shelf — nothing else to record.
- Show it (→ **play-my-game**, auto-open + front), celebrate, offer the next thing.

## 🛡️ Guardrails
- **Persist `name` and `appId`/`localStorageKey` MUST be the new id** — the #1 remix bug is two games sharing save data.
- One game = one island — the copy lives entirely in its own two folders; don't touch the source game.
- Don't ship until `pnpm build` is green (it catches missed re-ids) and you've watched it run.
- Kid-safe content; no PII baked into the game.
