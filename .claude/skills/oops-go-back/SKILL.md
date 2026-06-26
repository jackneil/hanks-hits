---
name: oops-go-back
description: Use when a kid wants to undo a change to a game and get the old version back. Triggers on "undo", "undo that", "go back", "I liked it better before", "oops", "put it back", "change it back", "the old way", "I don't like the change", "redo the last thing differently". Also: the checkpoint half runs automatically inside change-a-game before any edit.
---

# Oops, Go Back ⏪

Kids should be able to try ANY change fearlessly and snap back if they don't like it. This is the time machine. It has two halves: **checkpoint** (auto, before edits) and **restore** (when they ask).

**TONE — the blunt style from CLAUDE.md is for Jack ONLY.** To the kid: reassuring. *"No worries — I'll put it right back the way it was! ⏪"*

## Checkpoint (do this automatically BEFORE changing a game)
Before **change-a-game** (or any edit to an existing game), snapshot the game's island so it can be restored:
```
mkdir -p ".game-backups/<id>"
cp -r "apps/web/src/games/<id>" ".game-backups/<id>/$(date +%Y%m%d-%H%M%S)"
```
(For an app, use `src/apps/<id>`. If the change will touch the game's route page too, back up `src/app/games/<id>` the same way.) `.game-backups/` is gitignored and local. Keep the last ~5 snapshots per game; delete older ones so it doesn't grow forever.

## Restore (when the kid says "undo" / "go back")
1. Find the **most recent** snapshot for that game in `.game-backups/<id>/`.
2. Replace the current version with it (clean restore, so added files also go away):
   ```
   rm -rf "apps/web/src/games/<id>"
   cp -r ".game-backups/<id>/<latest-snapshot>" "apps/web/src/games/<id>"
   ```
3. **Show it restored** right away (→ **play-my-game**, auto-open + bring to front) so the kid sees their game is back the way they liked it.
4. Say it simply: *"Done — your truck is back the way it was! 🚚"*

If the kid wants to go back **more than one step**, list the snapshots in plain terms ("the one from a few minutes ago") and restore the one they pick.

## Edge cases
- **No snapshot exists** (first-ever change wasn't checkpointed): don't panic the kid. Use `git` as a fallback — `git checkout -- apps/web/src/games/<id>` restores the last *committed* version. If it was never committed, gently explain you can't go back further and offer to change it back by hand.
- **The change also touched shared files** (a new saved value → schema / VALID_APP_IDS): those are rare for simple tweaks. If undo leaves something off, revert those specific files with `git checkout -- <file>` (never `git checkout .`).

## 🛡️ Guardrails
- Only ever `rm -rf` the **one** game's folder that you're restoring, and only right before copying its backup back. Never a broad delete.
- Backups are local notes — gitignored, never committed.
- Always restore + **show** the result so the kid sees it worked; never just say "done."
