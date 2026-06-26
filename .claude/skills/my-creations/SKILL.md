---
name: my-creations
description: Use when a kid wants to see, revisit, or pick from the games THEY made (not the built-in catalog). Triggers on "my games", "show me my games", "what have I made", "my creations", "the games I made", "my stuff", "what did I build", "show my games".
---

# My Creations 🏆

The kid's personal trophy shelf — just the games **they** made, not the 24 built-in ones. Show it off and let them jump back into any of theirs.

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: proud and excited. *"Look at everything YOU made! 🤩"*

## How "their" games are marked
Every game a kid builds or remixes gets **`madeByKid: true`** in its `metadata.ts` (set by **make-a-game** and **remix-a-game**). That marker travels with the game, so it works even on a fresh clone. Find them with:
```
grep -rl "madeByKid: true" apps/web/src/games/*/metadata.ts apps/web/src/apps/*/metadata.ts
```
Read each match's `name` + `emoji` for the display.

## What to do
1. **Show their games as a fun row of trophies** — emoji + name:
   > *"🍩 Donut Catcher · 🚚 Monster Smash · 🦕 Dino Dash — look at all YOUR games!"*
2. **Ask what they want to do** with one: *"Want to play one, change one, or put one on the internet?"*
   - play → **play-my-game**
   - change / make harder / add to it → **change-a-game**
   - share it → **put-it-online**
   - undo a change they regret → **oops-go-back**
3. **Always offer to make a new one too:** *"…or make a brand-new one!"* → **make-a-game** / **remix-a-game**.

## Edge cases
- **None found:** they haven't made one *here* yet — don't make them feel bad. *"You haven't made one yet — want to make your FIRST game right now? 🎉"* → **make-a-game**.
- **An older game of theirs is missing the marker** (made before this existed): if the kid says they made it, add `madeByKid: true` to its `metadata.ts` so it shows up next time.

## 🛡️ Guardrails
- Only show the kid's OWN games (the `madeByKid` ones) — keep the built-in catalog separate (that's the home page).
- Keep it short and celebratory; this is a brag wall, not a file browser.
