---
name: mobile-playability
description: Use to prove a game is fully playable on a touch-only phone — no mouse, no keyboard, no hover. Run it as a done-gate inside make-a-game / change-a-game / remix-a-game before showing the kid, and standalone when auditing one game or sweeping all of them. Triggers on "does it work on a phone?", "check my game on mobile", "touch audit", "phone check", "test it on a phone", "mobile sweep".
---

# Mobile Playability 📱

Kids play on phones. A game that needs a keyboard, a mouse, or a hover state is **broken** for them, even if it's perfect on a laptop. This skill proves — in a real browser, under touch-only emulation — that every core action of a game can be done with fingers on a ~390x844 phone screen.

**Two modes, same checklist:**
- **Gate mode** (inside make-a-game Step 5 / change-a-game Step 4 / remix-a-game Step 6): audit THE game you just built/changed against the local dev server before you show the kid. A game is NOT done until this passes.
- **Audit mode** (standalone): audit one game or sweep many, usually against production. Record a verdict matrix.

## Step 1 — Set up the touch-only phone

**Primary: Chrome DevTools MCP.** Open the game's URL, then emulate a phone with touch:

```
mcp__chrome-devtools__new_page        url: <game url>
mcp__chrome-devtools__emulate         viewport: "390x844x3,mobile,touch"
mcp__chrome-devtools__navigate_page   type: "reload"        ← reload AFTER emulating so the page boots as a phone
```

The reload matters: `pointer: coarse`, `ontouchstart`, and mobile detection all evaluate at load time — emulating after load leaves the page thinking it's a desktop.

**Fallback: Playwright MCP** — `browser_resize` to 390x844; note it doesn't flip `pointer: coarse`, so prefer DevTools.

**The rules while auditing (touch-only means touch-only):**
- **NEVER send keyboard events.** No `press_key`, no typing shortcuts to move the game along (typing into a text input a kid could reach via the on-screen keyboard, e.g. Wordle letters, is allowed ONLY if the game shows a real text input or on-screen keys).
- **NEVER rely on hover.** If a control only reveals itself on hover, that's a finding, not a path forward.
- Tap = `click` on an element (with touch emulation on, this dispatches as a tap). Drag/swipe = the `drag` tool.
- **Tilt cannot be emulated.** For tilt-steering games, verify the touch pedals by tap AND verify the tilt wiring in code (`deviceorientation` listener + iOS permission request). Don't fail a driving game for untestable tilt; DO fail it if the pedals don't work by tap.

## Step 2 — Play it like a kid with a phone

For each game: load it, then actually play — not just look:
1. **Start** it by touch (tap the start overlay / start button).
2. **Do the core action** at least a few times by touch: steer, jump, flap, shoot, move a piece, merge a tile — whatever the game IS.
3. **Score or progress** — confirm the game state visibly responds (score ticks, piece moves, truck drives).
4. **Restart / pause / exit** by touch (GameShell's buttons, game-over retry, back button).
5. Take a screenshot; check `list_console_messages` for errors.

## Step 3 — The checklist (all must hold to PASS)

- [ ] Every core action is doable by tap / drag / on-screen controls — zero keyboard-only actions
- [ ] Nothing is hover-gated (menus, buttons, tooltips that only appear on hover)
- [ ] Touch targets are ≥ 44px (kid fingers; CLAUDE.md rule)
- [ ] No horizontal scroll; canvas/board fits and is not clipped at 390x844
- [ ] Start, restart, pause (if present), and exit are all reachable by touch
- [ ] Instructions shown on a touch viewport never say "press SPACE / use arrow keys" (use `useCoarsePointer` from `@/shared/hooks` to branch the copy)
- [ ] Driving games: touch pedals work by tap; tilt steering wired in code (monster-truck pattern)
- [ ] No console errors while playing

**Verdicts:** **PASS** = all boxes. **PARTIAL** = playable but degraded (small targets, keyboard-copy shown, minor clipping). **FAIL** = a core action is impossible by touch (can't start, can't steer, can't play).

## Step 4 — Fix patterns (reuse, don't reinvent)

| Problem | Reuse this |
|---|---|
| Game needs to know it's on touch | `useCoarsePointer()` from `@/shared/hooks` |
| Keyboard-only instructions text | Branch copy on `useCoarsePointer()` |
| Driving game needs controls | `monster-truck/components/MobileControls.tsx` (tilt + pedals) or `hill-climb/ui/MobileControls.tsx` (pedals) |
| Action game needs buttons/d-pad | On-screen buttons wired to the same handlers as the keys — see monster-truck/hill-climb; keep them inside the game's own folder |
| Wrong orientation for the game | `OrientationWarning` from `@/shared/components` |
| Emulator (retro-arcade) touch input | EmulatorJS virtual gamepad config in `apps/web/public/emulator/index.html` — verify against current EmulatorJS docs, not memory |

Fixes follow change-a-game rules: one game = one island, new tests for new touch logic, `pnpm build` green, then **re-run this audit** on the fixed game.

## Step 5 — Record the result

- **Gate mode:** state the verdict + evidence (what you tapped, what happened) in your report. FAIL/PARTIAL = the game is not done; fix and re-audit before showing the kid.
- **Audit mode (sweep):** one matrix row per game — verdict, the exact broken interaction observed, screenshot. Keep the matrix in `design/audits/`.

## Rationalization table — STOP if you think any of these

| Excuse | Reality |
|---|---|
| "It has touch handlers in the code, so it works on mobile." | Handlers ≠ playable. Emulate and play it. |
| "I clicked it with a mouse and it worked." | Mouse click without touch emulation misses `pointer: coarse` branches and hover traps. Emulate first, reload, then tap. |
| "The board games are click-based, taps obviously work." | Verify anyway — drag-to-move pieces, hover-highlights, and tiny squares all break on phones. |
| "I'll skip the reload after emulate." | The page already booted as desktop. Your audit is testing the wrong device. |
| "Tilt can't be emulated so I'll pass the driving game." | Pedals CAN be tapped and tilt wiring CAN be read. Verify both. |
| "It fails but fixing it is a separate task." | In gate mode the game is not done. Fix it now, re-audit, then show the kid. |

## Red flags
- Declaring a game mobile-ready without a touch-emulated browser session in the transcript.
- Any `press_key` call during a touch-only audit (outside a real text-input flow).
- A verdict with no screenshot and no described interaction.
- Emulation applied but the page never reloaded.
- A "fixed" game never re-audited under the same emulation.
