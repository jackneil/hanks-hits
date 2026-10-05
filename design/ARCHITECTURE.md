# Hank's Hits - Architecture Design Document

## Executive Summary

A web platform where 9-year-old Hank Neil (and other kids who clone it) design their own browser games and simple apps just by describing them. **Claude builds and maintains all code.**

**Site Name:** Hank's Hits
**Hosting:** Railway only (PostgreSQL + web app)

---

## Tech Stack

| Component | Version | Notes |
|-----------|---------|-------|
| **Next.js** | 16.2.9 | App Router |
| **React** | 19.2.3 | Latest |
| **Tailwind** | 4.x | CSS |
| **DaisyUI** | 5.x | Kid-friendly theme |
| **Hosting** | Railway | Everything in one place |

### 3D Game Stack (Confirmed Compatible)

| Package | Version | Peer Deps |
|---------|---------|-----------|
| `three` | 0.182.0 | N/A |
| `@react-three/fiber` | 9.4.2 | React ^19.0.0 |
| `@react-three/rapier` | 2.2.0 | React ^19, R3F ^9.0.4 |
| `@react-three/drei` | 10.7.7 | React ^19, R3F ^9.0.0 |

**All four packages are installed and in use, verified compatible with our React 19.2.3.** For 2D physics games, `matter-js` (0.20.0) is also installed. `ecctrl` (a ready-made vehicle controller + joystick) is **not currently installed** — the monster-truck game uses a hand-rolled controller instead. Add it with `cd apps/web && pnpm add ecctrl` if a future driving game wants an off-the-shelf controller (it's compatible with this stack; see Key References).

---

## Infrastructure: Railway Only

```
┌─────────────────────────────────────────┐
│              RAILWAY                     │
├─────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    │
│  │  Next.js    │───▶│ PostgreSQL  │    │
│  │  Web App    │    │ (Drizzle)   │    │
│  └─────────────┘    └─────────────┘    │
└─────────────────────────────────────────┘
```

---

## 3D Game Architecture

### React Three Fiber + Rapier

```tsx
// CRITICAL: Must use dynamic import with ssr: false
import dynamic from 'next/dynamic';

const MonsterTruckGame = dynamic(
  () => import('@/games/monster-truck'),
  { ssr: false }
);

export default function GamePage() {
  return <MonsterTruckGame />;
}
```

### Vehicle Physics (Rapier)

```tsx
// src/games/monster-truck/components/Vehicle.tsx
"use client";

import { RigidBody, useRapier } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';

export function MonsterTruck() {
  // Chassis with wheel rays for suspension
  // Low stiffness for bouncy monster truck feel
  // Large wheel radius for ground clearance
}
```

### Mobile Controls

**Tilt Steering (DeviceOrientationEvent):**
```typescript
// hooks/useDeviceOrientation.ts
export function useDeviceOrientation() {
  const [gamma, setGamma] = useState(0); // Left/right tilt

  useEffect(() => {
    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // Request permission flow
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      // gamma: -90 to 90 degrees (left/right tilt)
      // Map to steering: -30° to +30° = full turn
      const steering = Math.max(-1, Math.min(1, (event.gamma || 0) / 30));
      setGamma(steering);
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, []);

  return { steering: gamma };
}
```

**Touch Pedals:**
```
┌─────────────────────────────────────────┐
│                                         │
│     [TILT PHONE LEFT/RIGHT = STEER]     │
│                                         │
│           3D GAME VIEW                  │
│      (camera behind truck)              │
│                                         │
│                          [🔊 HORN]      │
├──────────────┬──────────────────────────┤
│    BRAKE     │           GAS            │
│     ◀──      │           ──▶            │
└──────────────┴──────────────────────────┘
```

### Desktop Controls

| Key | Action |
|-----|--------|
| W / ↑ | Accelerate |
| S / ↓ | Brake / Reverse |
| A / ← | Steer Left |
| D / → | Steer Right |
| Space | Handbrake |
| H | Horn |
| R | Reset position |

---

## Game Design Principles (Research)

### What Makes Monster Truck Games Fun

From [Offroad Outlaws](https://play.google.com/store/apps/details?id=com.battlecreek.offroadoutlaws):
- Complete vehicle customization (suspension, wheels)
- Diverse terrain (mud, hills, desert)
- Authentic physics that "feel" right

From [Open World Game Design](https://gamedesignskills.com/game-design/game-progression/):
- Core loop: Drive → Find stuff → Unlock rewards → Better truck
- Collectibles in "mini-clusters" (mini-adventures)
- Meaningful rewards (not just points)

### Kid-Friendly (Ages 6–14)

- **Forgiving physics** - truck can flip but auto-recovers
- **Big buttons** (44px minimum)
- **Celebrations** - confetti when collecting stuff
- **Horn button** - kids love honking
- **Simple controls** - just gas, brake, steer

---

## Project Structure

Each game/app is a **self-contained module** (see the "Compartmentalized Structure" section in `CLAUDE.md` for the authoritative rules and the exact "add a new game" checklist).

```
hanks-hits/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/                        # Next.js routes ONLY (kept thin)
│       │   │   ├── page.tsx                 # Home — renders HomeClient.tsx (auto-discovers games)
│       │   │   ├── games/<name>/page.tsx    # Thin route: dynamic() import of the game module, ssr:false
│       │   │   ├── apps/<name>/page.tsx     # Thin route for a fun-app module
│       │   │   └── api/                     # progress, roms, leaderboards, auth, admin, profile, …
│       │   ├── games/                       # SELF-CONTAINED game modules (one folder per game)
│       │   │   └── <name>/
│       │   │       ├── components/          # game-specific components
│       │   │       ├── hooks/               # game-specific hooks
│       │   │       ├── lib/                 # store.ts (Zustand persist), constants.ts, …
│       │   │       ├── Game.tsx             # main component ("use client")
│       │   │       ├── metadata.ts          # home-page discovery (id, name, emoji, category)
│       │   │       ├── index.ts             # exports component + store + Progress type
│       │   │       └── __tests__/           # Vitest tests
│       │   ├── apps/                        # SELF-CONTAINED app modules (one folder per app)
│       │   ├── shared/                      # ONLY truly-reused UI / hooks / lib
│       │   └── lib/                         # progress-schemas.ts, rate-limit.ts, auth-client.ts, progress-merge.ts, …
│       ├── public/                          # static assets
│       └── next.config.ts                   # transpilePackages: ["three"]
├── packages/
│   └── db/                                  # Drizzle ORM schema + migrations (PostgreSQL)
│       └── src/schema/                      # app-progress.ts (VALID_APP_IDS), auth.ts, leaderboards.ts
├── design/
│   ├── ARCHITECTURE.md                      # This file
│   └── games/<name>.md                      # per-game design docs
├── CLAUDE.md                                # Claude instructions (kid tone, guardrails, checklists)
├── .claude/skills/                          # kid-facing playbooks (make-a-game, play-my-game, …)
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Shell Contract (chrome vs. play area)

Every game and app route is wrapped by the shared **GameShell**
(`src/shared/components/GameShell.tsx`). The split is strict:

**The shell owns the chrome.** One fixed header bar per page: home button,
the game/app name (rendered exactly once as chrome), leaderboard button
(when the app id has leaderboard support), fullscreen button, and pause
button (ESC + pause-on-blur via `useGameShell`). Modules must NOT render
their own home/back buttons, title bars, page `<h1>`s naming themselves, or
floating fullscreen buttons — that chrome comes from the shell or not at all.
`src/shared/lib/headerBudget.ts` decides which controls the header shows at
each width. On a phone with a touch screen (the short side of the screen
is 480 px or less, in both orientations), during play (`canPause` is true,
so the pause menu is one tap away), Sign In and Leaderboard leave the
header: the pause menu holds both, and the result chip holds Leaderboard
at game over. Between runs (the start card, game over) both stay in the
header. The signed-in avatar stays in the header (it is 44 px).

**Games own the play area and overlay content.** Start screens are DOM, not
canvas. Every game and every playable app uses **GameStartOverlay**
(`src/shared/components/GameStartOverlay.tsx`). Render it conditionally on
the start state, at any place in the game. It portals to `document.body` and
covers the viewport under the header, so the size of the game box does not
change the card. The card has a body and an action row. The body (the title,
the hints, and the picker when Play shows) scrolls on a short screen. The
action row (the read-aloud button, then Play or the picker choices) stays at
the bottom of the card, so the start action is always on screen with no
scroll. On a short screen (a phone held sideways) the action row sits to the
right of the body. A nudge such as the iOS install tip or a trophy
celebration shows in a break slot outside the card (below it), never in
the card's body. The slot shows only while the whole card still fits next
to it. If it does not fit, the nudge waits for the next break (the pause
menu, or the result chip for a celebration). On a short screen there is
no slot beside the card (the tip took 288 px of a 667 px screen); a
trophy, one row there, gets a slot at the top of the action column
instead, under the same rule: when the card would not fit with it, the
slot goes away and the trophy waits. The
break surfaces and the rule that places a nudge live in
`src/shared/lib/gameBreaks.ts` (`useNudgePlacement`): a nudge renders into
the newest slot that holds its kind; it waits while a game shell is on
screen with no break, while a start card has no room, and on an app page
whose start card has left (a Trivia quiz with a timer); and it shows its
page form (a thin strip for a celebration, a 44 px pill for the install
tip) only on a page with no play. An app with no start card puts an
`AppNotesSlot` (`src/shared/components/AppNotesSlot.tsx`) in its own
layout: an inline slot that holds a trophy for its 4 s show window as
part of the page, so the fixed strip never covers the app's buttons. An
inline slot is not a break, so the install pill still shows.
`GameNoticeOverlay` (the same file) is a question before a game starts, not
a break (Retro Arcade's heads-up card). It has no slot, so a nudge waits for
the next break, and its read-aloud text is the card's words only. On a
keyboard it is a modal dialog: focus goes to the first choice, Tab stays in
the card, and Escape calls `onDismiss`. The body shows a soft shadow
at an edge only while there is more content past that edge (`useScrollCue`).
The check in `e2e/start-cards` tests this contract on real screens for each
route that the home page lists. Run it with `pnpm e2e:start-cards
<base-url>` from the repo root, against a server that runs (it builds
nothing and starts no server). The overlay renders the
title once (the only in-content heading, visible only before start),
pointer-aware controls copy (`useCoarsePointer` /
`matchMedia("(pointer: coarse)")`: touch viewports never see keyboard-only
instructions), a 🔊 "Read it to me" button (`ReadAloudButton`, see below),
an optional difficulty/level picker slot (`GameStartOverlayButton`, the one approved
start-button style), and a start button guarded to fire once. All targets
are >= 44x44px. Never draw menu text or hit-boxes into the canvas. Write the
hint lines for a reader in grade 1 to 3: one action per line, an emoji
first, short words. Two kinds of module do not use the overlay: a toy with
no start moment (drawing-app, drum-machine) and a module with its own
launcher (retro-arcade). Those modules put the same `ReadAloudButton` on
their first screen instead.

**Start-card pickers.** The picker slot (the children of
`GameStartOverlay`) has two homes. A slot with ONE child (Hill Climb's
Garage button) is pinned into the action row, above Play, so a centre tap
never lands on Read it to me. A slot with more parts (a heading and a row
of choices) stays in the body, where it can scroll. On a touch screen (a
phone upright too) and on a short screen the body puts the picker before
the hints, so a choice is never under the fold while a hint is on screen,
and the emoji is smaller (a phone upright at 375x549 has room for the
heading and two rows of choices above the fold; the rest scrolls, with
the scroll cue). A desktop with a mouse reads how to play, then the
choices. The hints use two columns on a short screen only with two or
more hints.

**The pause menu.** The menu covers the screen under the header
(`top-[var(--shell-header-h)]`), like the start card and the orientation tip: the header
stays in view and in use, and "Paused" never sits over its ghost. The
menu has two break slots under its buttons: one for a trophy celebration,
on every screen, and one for the install tip, on a tall screen only and
only while the whole menu still fits on the screen with the tip in it.
When the tip lands and the menu would scroll, the tip's slot goes away
for this open and the tip waits for the next break (the same rule as the
start card). On a phone held sideways the menu buttons are a 2 x 2 grid
of 44 px targets (Sign In and Leaderboard in the menu are 44 px there
too), so Resume, Restart and Go Home are on screen with no scroll, and
the celebration is one row under the grid. A menu that is still taller
than the screen scrolls, with the scroll cue at its edges. The restart
question of the menu is answered by GameShell in the same order as the
header's: let the run go, then restart.

**The restart question.** "Restart game?" makes the safe choice the big
blue button, "Keep playing" (the same words as the orientation tip and
the leaderboard), with the focus on it; Restart is a plain bordered
button with a red word. On a phone the header packs Restart next to
Pause, so a mis-tap must not lose the run on a reflex tap.

**GameSheet.** A game's own screens between runs (game over, level
complete, settings, a garage, a store) use `GameSheet`
(`src/shared/components/GameSheet.tsx`), not a `fixed inset-0
items-center` card of its own. The sheet covers the screen under the
header, never the header. Its card has a body that scrolls when the
screen is short and an action column that never scrolls out of view; on
a short screen the column sits beside the body, so every action is on
screen at 667x311 with no scroll. Read-aloud is built in. It is a break:
the install tip renders into its slot (not on a short screen). It is at
z-60 (the game tier) and portals to `document.body`. Use the sheet OR the
result chip for one screen, not both.

**ResultChip adoption.** At game over and at level complete a game mounts
the shared `ResultChip` and stops drawing its result and its buttons into
the canvas. `onRestart` is the game's own restart (the store's newGame or
startGame): it is direct, with no restart question, because after the
game is over there is nothing to lose. The shell's "Restart game?"
question stays for a restart in the middle of a run (the header, the
pause menu). The chip's words are for a finger; `keyboardHint` ("Space")
shows "or press Space" on a mouse or trackpad viewport only. Set GameShell's
`resultChipReady` only when every other screen between runs opens the
pause menu (`headerBudget.ts`, step 3).

**Pause, holds and shell overlays.** `useGameShell`
(`src/shared/hooks/useGameShell.ts`) owns the pause state. Two things stop
a game. The pause MENU (the pause button, ESC, a hidden tab for a game
that can pause) shows the PauseMenu. A HOLD shows no menu: a shell
overlay is open, or the tab is hidden for a game that cannot pause. The
shell overlays are the restart question (`RestartConfirmationDialog`),
the leaderboard (`LeaderboardModal`), the install steps that the 📲 button
opens (`IOSInstallPrompt requested`), the clip sheets (`clips/ui/Sheet`)
and the orientation tip. Each one counts itself in
`src/shared/lib/shellOverlays.ts` (`useShellOverlay(isOpen)`) while it is
open. A new shell overlay must do the same. GameShell holds the game while
the count is above 0. The game hears about the menu and a hold the same
way, once each: `onPause` when it becomes stopped and it can pause,
`onResume` when the last reason goes away. A game that runs its own loop
and has no pause menu (`canPause={false}`) reads the hold as a boolean:
`useShellHold()` (`src/shared/hooks/useShellHold.ts`, from
`ShellHoldContext`, which GameShell provides from `isHeld`; the shell also
calls `onShellOverlayOpen` at the first hold and `onShellOverlayClose` at
the last release). The game must stand still while the hold is true, so
no game time passes under an overlay or while the kid is in another app:
a requestAnimationFrame loop skips its update and starts again with a
seed frame when the hold ends (Flappy Bird, Endless Runner, Dino Runner,
Math Attack); a physics runner stops (Hill Climb, and the R3F games
through `<Physics paused>`); a timer is not set (Trivia). A loop also
caps one step (Math Attack at three frames, Dino Runner at 50 ms), so a
throttled frame never moves the world by a whole stall. The source scan
`src/__tests__/shell-hold-adoption.test.ts` fails on an own-loop game
behind a `canPause={false}` shell, or a game with a `preferredOrientation`,
that reads neither; an idle game (Cookie Clicker, the virtual pet) is
exempt by name, with its reason. A restart from the question, from the
header or from the pause menu, lets the old run go first, then restarts;
no resume reaches the new run. Before this, a game kept running and took
touches under "Restart game?", the hold had no subscriber in any game, and
only a game with `canPause` stopped on a hidden tab.

**The orientation tip.** A game declares the orientation it plays best in
with the metadata literal `preferredOrientation: "portrait"` or
`"landscape"`. GameShell then renders `OrientationWarning` once, above the
game, from `gameMetadata.generated.ts`. A game must not mount it. The tip
is a suggestion, not a gate: it shows at most once per session for each
game (`sessionStorage`), never over the start card, and it never blocks
the header. It shows only on a phone with a touch screen (the short side
of the screen is 480 px or less, in both orientations), when the phone is
held the other way. The game is held while it shows (a shell overlay). It
goes away when the kid turns the phone or taps Keep playing. A game that
plays well both ways (Hill Climb, Monster Truck, Four-Wheeler 3D, and
every game that a phone PR makes work both ways) declares nothing, and
never shows it.

**Scroll reset.** A module that swaps screens by state on one route (the
Retro Arcade catalog, the Oregon Trail store, a board's New Game) calls
`useScrollToTopOn(screenKey)` (`src/shared/hooks/useScrollToTopOn.ts`).
It scrolls the play box and the page to the top, before paint, each time
the key changes.

**Read-aloud.** Kids aged 6 to 8 often cannot read yet. The shared chrome
reads itself out loud: `useReadAloud` (`src/shared/hooks/useReadAloud.ts`)
wraps the browser speech API (`window.speechSynthesis`), and
`ReadAloudButton` (`src/shared/components/ReadAloudButton.tsx`) is the one
control that uses it. The button is on the start overlay, the pause menu,
the restart dialog, and each home-page card. It never speaks on its own.
The kid must tap it. When the browser has no speech support, the button
does not render. Any new text surface a kid meets mid-game must use the
same button, in the same place: under the words, above the action buttons.

**Stacking order (z-index, low to high):**

- 60 or less: game HUDs, touch controls and game modals. The ResultCard
  (the words of a result, across the screen under the header) is at 60,
  and it is last in the page, so it draws over the game's own layers.
- 90: GameStartOverlay, and the own start screen of a module with its own
  launcher (four-wheeler). It covers the viewport, so it must be above
  every game layer.
- 100: OrientationWarning, the orientation tip (a phone held the other way
  than the game's preferredOrientation). It starts under the header.
- 1000: the GameShell header. The clip confirmation (`InPlayConfirm`) lies
  in the title region of the header, at the same level.
- 1050: toasts. The clip toast slot (`ToastSlot`) and the short notes of a
  game (for example "Saved!") use this level.
- 1100: the full-screen Retro Arcade emulator view. It covers the header
  and the toasts. Its own top bar has the Back button.
- 1150: AchievementCelebrations, as the thin strip at the bottom of a page
  with no play. At a break the celebration is a card inside the break
  surface (the start card, the pause menu, the result chip) and has no
  level of its own. During play it waits for the next break. The card
  leaves the queue when the kid taps Yay!, or when the break ends after
  the card was in view (an IntersectionObserver, half of the card) for
  1.5 s in total. A card the kid never scrolled to comes back at the next
  break. The queue is persisted, so a trophy that waits survives a
  reload. On a short screen (the `short:` variant, a phone held
  sideways) the card is one row: the start card holds it at the top of
  its action column, the pause menu under its grid, and the result chip
  above its buttons (the install tip has no slot on a short screen).
- 1200: ResultChip.
- 1500: modals (LeaderboardModal, tutorials).
- 2000: PauseMenu.
- 2500: sheets that the kid opens: the clip sheets (Capture menu, viewer,
  settings) and the install steps that the 📲 button opens (in the header
  or in the pause menu).
- 3000: dialogs (RestartConfirmationDialog).
- 4000: ProgressStorageNotice and ProgressRecoveryNotice, device storage and save recovery warnings above
  fixed game content, headers, and dialogs. It portals to `document.body`,
  respects safe-area insets, and has a 44 px acknowledgement button. Its
  outer layer takes no taps outside the warning. Acknowledgement hides the
  displayed failures; a newly distinct failure displays its own warning.

Every layer above 1000 portals to `document.body` or mounts in the root
layout, so no game container can trap it (gameplay clips plan, section
11.4). The emulator view is `fixed` in the game content, which makes no
stacking context, so it does not need a portal. The celebration strip is
`pointer-events-none`, so it takes no tap except on its own dismiss
button. It stays below the result chip, the modals, the sheets and the
dialogs, so it never covers a question that the kid must answer. The
comment in `AchievementCelebrations.tsx` holds the same list. The install
pill has no level: it renders in the flow of the app page where the app
mounts it, so it covers nothing.
`src/__tests__/stacking-contract.test.ts` reads this list and the code. It
fails when a named layer is not at its level, or when the code uses a z
level above 60 that the list does not name. A new layer takes a level of
this list, or it adds a line here.

**Bottom sheets:** a sheet fixed to the bottom of the screen covers the
end of the page. While a sheet shows, it calls `useBottomSheetSpace`
(`src/shared/lib/bottomSheetSpace.ts`). The hook sets the height of the
sheet on `<html>` as `--bottom-sheet-space`. `globals.css` adds that much
padding at the end of the body, so the kid can scroll every element up
clear of the sheet. When the sheet closes, the space goes away. A new
bottom sheet must use the same hook. The install sheet opens only when
the kid asks for the steps: from the 📲 button, or from the install pill.
The pill is the automatic form on an app page with no play: one 44 px row
in the flow of the page, with the words and a Close. It shows once per
session (`sessionStorage`); Close, or Close on its steps, ends it for the
session, and Don't show this again ends it for good (`localStorage`). On
a short screen (the `short:` variant, a phone held sideways) the install
sheet is one row: the icon, the steps, Read it to me, Don't show this
again, and Close. The row is at most a quarter of the screen height and
keeps the 44 px targets. The sheet also keeps clear of the side safe
areas (the notch). The check in `e2e/install-sheet` tests the pill and
the sheet on each app page that mounts the prompt, at 844x390, 667x375,
568x320, 932x430 and 390x844, and that an app whose start card has left
(Trivia) shows no prompt at all. Run it with
`pnpm e2e:install-sheet <base-url>` from the repo root, against a server
that runs. A start card and a game shell count themselves in a layout
effect. The store hooks subscribe only after paint, so a nudge must not
decide in its first render: the install prompt renders nothing in its
first commit and decides in the render after its layout pass, before
paint. If it decided in its first render, the sheet showed over the Trivia
start card for one frame.

**No decoration tells:** do not put a colored stripe on one edge of a
card, a note or a row (`border-l-4` and a color). Give a note a plain
fill. Mark a selected row with a row background and bold words. The
shared components and the profile pages use solid colors, not
decorative gradients. `src/__tests__/no-design-tells.test.ts` enforces
both rules.

**The play box (layout under the shell):** the header height is the CSS
variable `--shell-header-h` in `globals.css`: 48 px, and 44 px on a short
screen (the `short:` variant is `max-height: 480px`, a phone held
sideways). 44 px is the smallest size of a header button, so a button
never hangs off the top of the screen. Every layer under the header reads
the variable; nothing repeats the number. The header height is never
keyed on the width: a phone held sideways is 844 px wide and is not a
tablet. Under the header, GameShell renders one play box
(`[data-play-box]`, `PLAY_BOX_CLASSES` in `GameShell.tsx`). The box is
the rest of the screen, in `dvh`: `calc(100dvh - 3rem)` and
`short:calc(100dvh - 2.5rem)`. On an iPhone, `100vh` is the height with
the Safari toolbars hidden, so a page in `vh` was taller than the screen
and every route scrolled. The page is exactly one screen tall; when a
module is taller, the box scrolls, not the page. While a bottom sheet
shows (the install tip on an app page, `bottomSheetSpace.ts`), the body's
padding gives the sheet its room and the shell root leaves that much out
(`min-h-[calc(100dvh-var(--bottom-sheet-space,0px))]`), so the page is
still one screen and the box ends above the sheet. Nothing in the box can
be selected or long-pressed into the iOS callout; a text field keeps its
selection. A game must not read `window.innerHeight` or use `100vh`,
`min-h-screen` or `calc(100vh - 3rem)`. It sizes to the box:

- `usePlayBox()` (`src/shared/hooks/usePlayBox.ts`) gives the size of the
  box, live: before the first paint, then on each change of the box, the
  window or the visual viewport (the on-screen keyboard). `visibleHeight`
  is the part of the box above the keyboard.
- `usePlayBox({ fit: true })` makes the box fitted while the game fills
  it: the box does not scroll, and a touch on it goes to the game
  (`touch-action: none`), not to the browser.
- `fitCanvas(box, canvasWidth, canvasHeight, reserved)` gives the largest
  size of a canvas or a board that fits the box on both axes with one
  scale. `reserved` keeps room for the controls: a number keeps height (a
  control row), an object keeps width and height (gutters beside the
  canvas on a phone held sideways). Nine canvas games scaled by width
  only, so a phone held sideways put the paddle below the screen.
- A game root uses `h-full` or `min-h-full`, never `min-h-screen`. A
  layer under the header uses `top-[var(--shell-header-h)]`, never a
  fixed number and never `md:`. A page with no shell (the home page,
  the profile) uses `min-h-dvh`. `src/__tests__/play-box-roots.test.ts`
  reads every game, app, route and shared component and fails on a
  screen-height class or an `md:top-14` offset.

Every button on the site has `touch-action: manipulation` (globals.css),
so a fast double tap on a game button never zooms the page.

---

## Audio

All game and app sound goes through one shared audio bus. The bus is in
`src/shared/lib/audio/gameAudio.ts`. Call `getGameAudio()` to get it.

**Why one bus.** A gameplay clip must record the game sound. A recorder
can only hear a sound that goes through a node that it can reach. A sound
that goes directly to `ctx.destination` does not get into a clip.

**The graph:**

```
channel.input  (one for each channel() call)
  |-> master -> tap point   (the recording branch; a clip recorder
  |                          connects here)
  |-> app speaker gain      (one for each app; the sound switch of
        |                    that game sets it to 0 or 1)
        -> limiter          (a DynamicsCompressorNode that stops clipping)
        -> destination      (the speakers)

uiOutput -> limiter  (site sounds; they never get to the tap point)
```

Each channel goes to two places: the tap point, and the speaker gain of
its app. The sound switch sets only the speaker gain. Because of this, a
clip keeps the game sound when the kid turns the sound off. Read-aloud
speech does not use the bus, and it does not get into a clip.

The app of a channel is the part of its id before the first ":". The
channels `"monster-truck:engine"` and `"monster-truck:music"` both use
the speaker gain of `"monster-truck"`. Each app has its own speaker gain.
Thus a mute in one game has no effect on a different game, also when a
game keeps its channel for the full page visit.

Nothing pulls the tap point until a recorder connects to it. Thus the
recording branch has no cost before then. A recorder must be a node that
the browser pulls (an `AudioWorkletNode` or a
`MediaStreamAudioDestinationNode`). Or, the recorder must connect to the
destination through a gain of 0.

**Rules for a game or an app:**

- When the game plays its first sound, get a channel with
  `getGameAudio()?.channel("<app id>")`. Do not get it on page load: an
  AudioContext that starts before a gesture makes the browser log a
  warning. For a sub-mix, use `"<app id>:<name>"`.
- Connect each sound to `channel.input`.
- Make nodes with `channel.context`. Its type is `BaseAudioContext`, so
  a game cannot close it.
- Call `channel.dispose()` when the game unmounts. If the browser closes
  the context, each channel shows `disposed === true`. Then get a new
  channel.
- Add `useEffect(() => wantGameAudio(), [])` to the main component of the
  game.
- Connect the sound switch to `setGameSpeakerEnabled("<app id>", enabled)`.
  Call it after the saved setting loads, and on each tap of the switch.
  This function does not make an AudioContext, so it is safe on page load.
- Make each sound a no-op when `getGameAudio()` returns `null`. It
  returns `null` on the server, in a browser with no Web Audio, and in a
  test without the audio mock.
- Connect a site sound (not a game sound) to `uiOutput`.
- Do not use three.js or drei audio (`Audio`, `AudioListener`,
  `PositionalAudio`, `AudioLoader`). They make a different AudioContext.
  Play the sound on a channel of the bus.

**Unlock.** A browser keeps a new AudioContext silent until a user
gesture calls `resume()`. When the module is first imported, it adds a
capture-phase listener to `document`. The listener runs on
`pointerdown`, `pointerup`, `touchend`, `keydown` and `click`:

- If the bus exists, the listener calls `unlock()`.
- If the bus does not exist, and a mounted game called `wantGameAudio()`,
  the listener makes the bus in the gesture and starts it. The listener
  waits for a gesture that can start sound. On a touch screen, this is
  `pointerup` or `touchend`, not `pointerdown`.
- If no game wants sound, the listener does not make an AudioContext.

The listener stops when the context runs. It starts again after an
interruption, for example a phone call on iOS. The Play button of
`GameStartOverlay` calls `unlockGameAudio()` in the tap, before the game
starts. Each `GameStartOverlayButton` (a level or difficulty choice) does
the same.

**For the clip service.** `getGameAudioTapPoint()` gives the tap point,
or `null` when no bus exists. It does not make an AudioContext.
`onGameAudioCreated(listener)` calls the listener with the bus that
exists now, and again with each new bus.

**Iframe games.** An iframe has its own JavaScript realm. Web Audio cannot
connect nodes from two realms. `buildAudioShimSource()` in `audioShim.ts`
returns a script for the iframe. Put this script first in the iframe
document, before the game scripts. The script wraps `AudioContext` in that
realm. The `destination` of each new context becomes a GainNode bus, and
the bus connects to the real speakers. The script puts each context and
its bus on `window.__hhAudioBus`. It also resumes a suspended context when
the kid taps in the iframe.

**Enforcement:**

- ESLint (`no-restricted-syntax`) blocks these forms in `src/games/**`
  and `src/apps/**`: `new AudioContext()`, `x.AudioContext` on any object
  (also `(window as any).AudioContext`), `x["AudioContext"]`,
  `webkitAudioContext`, `.destination`, `const { destination } = ctx`,
  `new Audio()`, `createElement("audio")`, `<audio>`, and three.js or
  drei audio. Tests are exempt.
- `src/shared/lib/audio/audioBusRule.mjs` holds the rule and the
  `LEGACY_AUDIO_SITES` list. The list names the files that still make
  their own sound. Each file has a ceiling: the number of bypasses in it
  now. Each migration PR removes its own files from the list. Do not add
  a file to the list, and do not increase a ceiling.
- A source-scan test (`src/shared/lib/audio/__tests__/audioBusSources.test.ts`)
  checks the same rule. It also reads the HTML games in `public/`. ESLint
  does not examine a file on the list, so this test is the only check for
  these files. The test fails in these conditions:
  - A file that is not on the list breaks the rule.
  - A file on the list has more bypasses than its ceiling.
  - A file on the list has fewer bypasses than its ceiling. Decrease the
    ceiling.
  - A file on the list no longer breaks the rule, or does not exist.
    Remove the entry.
- `SHIMMED_REALM_DOCUMENTS` in the same file names each HTML game whose
  host adds the iframe shim. The test checks that the host calls
  `buildAudioShimSource()`.

**Tests.** Use `installAudioMock()` from `src/__tests__/audio-mock.ts`. It
is the only fake Web Audio API. It resets the bus, so each test starts
with a new bus. `removeAudioMock()` also resets the bus.

---

## Touch input

Each control has one input path. A tap runs its action one time.

**Why one path.** React registers `onTouchStart`, `onTouchMove` and
`onTouchEnd` as passive listeners. A `preventDefault()` call in one of
these handlers does nothing. The browser logs "Unable to preventDefault
inside passive event listener" and then sends the compatibility mouse
events and a click. An element with `onTouchStart` and `onClick` runs its
action two times for one tap. The 2026 phone audit found this in ten
games: Hextris turned 120 degrees for one tap, the Oregon Trail hunt spent
two bullets, Bomberman placed two bombs. A handler that reads
`e.touches[0]` reads the oldest finger, not the finger that moved.

**The three helpers.** All three are in `src/shared`:

| Helper | Module | Use it for |
|---|---|---|
| `usePointerTap(onTap)` | `@/shared/lib/input` | One action per tap on a button or a canvas (rotate, shoot, launch, drop). It acts on `pointerdown` and ignores the compatibility click. A click with no pointer (Enter on a focused button) still acts one time. |
| `usePointerHold(onPress, onRelease)` | `@/shared/hooks` | A button that stays pressed while the finger is down (a pedal, a d-pad key, FIRE, DUCK). It captures the pointer, so a thumb that slides off still releases. It releases on `pointercancel`, on window blur, when the page is hidden, and on unmount. `usePointerHolds(keys, onChange)` makes one hold for each key of a pad. |
| `useTouchInput(ref, handlers)` | `@/shared/hooks` | A play surface: zones, swipes, drags and taps on a canvas. It registers native `touchstart`, `touchmove`, `touchend` and `touchcancel` listeners with `{ passive: false }`. It reads every touch in `changedTouches` and tracks each finger by its identifier. `onStart`, `onMove`, `onEnd` and `onCancel` get a `TouchPoint` with the start point, the newest point and a `tag` slot for the zone. `createTouchInput(target, config)` is the same code for a target outside React, for example `window`. |

**Rules for a game or an app:**

- Use one helper for each control. Do not put `onTouchStart` together
  with `onClick` or `onMouseDown` on one element. Do not call
  `preventDefault()` in a React `onTouch*` handler.
- Give a hold button `touch-action: none` (Tailwind `touch-none`). Give a
  tap button `touch-action: manipulation` (`touch-manipulation`). Without
  this, the browser can take the touch for a scroll or a zoom and cancel
  the press.
- Give a hold button `select-none` and `[-webkit-touch-callout:none]`, so
  a long press does not select text or open the iOS menu.
- A surface with `useTouchInput` prevents the default of each tracked
  touch. Thus the page does not scroll under a drag, and the browser
  sends no click. A `canvas` may keep `onClick` for the mouse. Set
  `ignore` to a selector for the buttons over the surface, so they keep
  their taps.
- A drag is not a tap. On a surface where a drag steers (Breakout), act
  only on a finger that lifts within a few pixels of where it landed.
- A decision about where a pointer let go reads
  `createPointerTrail().release(event)` from `@/shared/lib/input`. It
  never reads the position of the `pointerup` event. Reason: iPhone Safari
  can send a `pointerup` at (0, 0). On an iPhone SE (iOS 27) on
  2026-10-01, one tap on the clip button gave `pointerdown` at (585, 22),
  `pointerup` at (0, 0), and `touchend` and the click at (585, 22). The
  clip button took each tap for a drag off and did nothing. Call
  `trail.down` on `pointerdown`, `trail.move` on `pointermove`,
  `trail.release` on `pointerup`, and `trail.forget` on `pointercancel`.
  The browser captures a touch to its `pointerdown` target, so that
  element gets each move of the finger. On a React Three Fiber object, use
  `onClick` or `onPointerDown`, not `onPointerUp`: R3F finds the object
  from the position of the `pointerup`. To end a drag on an R3F object,
  capture the pointer in `onPointerDown`
  (`e.target.setPointerCapture(e.pointerId)`). A captured object gets its
  `pointerup` at any position. In that `onPointerUp`, do not read
  `point`, `pointer`, `ray`, `unprojectedPoint` or `intersections`: they
  come from the `pointerup` position or from the `pointerdown`. Keep the
  last point from `onPointerMove`.
- Show a touch control when `useCoarsePointer()` is true, never behind a
  width breakpoint such as `md:hidden`. A phone held sideways is 667 to
  932 px wide and has no keyboard. Branch each keyboard phrase ("Press
  Space", "press E", "Click", "WASD", "Escape") on the same value.
  `isCoarsePointer()` gives the same answer outside a render.

**Enforcement:**

- ESLint (`no-restricted-syntax`) blocks these forms in `src/games/**`
  and `src/apps/**`: a JSX element with `onTouchStart` and `onClick`, a
  JSX element with `onTouchStart` and `onMouseDown`, and a
  `preventDefault()` call written inside an inline `onTouch*` handler.
  `src/shared/lib/input/touchInputRule.mjs` holds the selectors. Tests
  are exempt.
- The local ESLint rule `hanks-hits/no-pointerup-position` blocks a read
  of a `pointerup` position in all of `src`.
  `src/shared/lib/input/pointerReleaseRule.mjs` holds the rule. It is a
  plugin rule, not `no-restricted-syntax`, so the audio and touch blocks
  cannot replace it. Tests are exempt.
  - Bindings that it finds: a JSX `onPointerUp` or `onPointerUpCapture`;
    an object key or a class member `onPointerUp`;
    `addEventListener("pointerup", ...)` (also with a template literal);
    an `onpointerup` property.
  - Handlers that it follows: an inline function; a name bound to a
    function, a `useCallback` or a `useMemo` in the same file; a member
    of an object literal or of the class (`this.handleUp`); both sides of
    a `?:` or `&&`. It also checks a function with a release-handler name
    (`handlePointerUp`, `onSurfacePointerUp`, `onPointerEnd`,
    `endPointer`), for a handler that another module binds.
  - Reads that it blocks, on the event parameter with any name:
    `clientX`, `clientY`, `pageX`, `pageY`, `screenX`, `screenY`,
    `offsetX`, `offsetY`, `layerX`, `layerY`, `x` and `y`. It also blocks
    the same reads on `nativeEvent`, on an alias of the event, in a
    destructuring, and in a function of the same file that gets the
    event as an argument.
  - React Three Fiber: it blocks `onPointerUp` on a three.js element
    (`mesh`, `group`, `sprite` and others) and on a component from
    `@react-three/drei` or `@react-three/fiber` (not `Canvas`), unless the
    element's `onPointerDown` calls `setPointerCapture`. In such a
    handler it also blocks `point`, `pointer`, `ray`, `unprojectedPoint`
    and `intersections`.
  - Limits: the rule does not follow the event into another module (for
    example the `onRelease` callback of `usePointerHold`), into a stored
    event, or through an event name in a variable. It does not see an R3F
    component that another file wraps. ESLint does not read the static
    HTML games: the second-finger script in
    `public/games/four-wheeler-adventure/index.html` obeys the rule, and
    `secondFingerClicks.test.ts` in that game's tests checks it.
- `src/shared/lib/input/__tests__/keyboardCopySources.test.ts` reads every
  file in `src/games` and `src/apps`. It fails on a keyboard phrase that
  is not inside a branch on a coarse-pointer value, or inside a
  `keyboardHints` slot of the start overlay.

**Tests.** Use the finger double in `src/__tests__/finger-mock.ts`:
`fingerDown`, `fingerMove`, `fingerUp`, `fingerCancel` and `fingerTap`.
It sends what a phone browser sends for one finger, in the browser's
order: the pointer event, then the native touch event, then (on
`fingerUp`) the compatibility mouse events and the click, but only when
no touch event was default-prevented. A test that taps an element with
`fingerTap` and expects one action fails on the old double path.
`fingerUp(element, finger, { pointerUpAt: { x: 0, y: 0 } })` sends the
`pointerup` at that point, and the `touchend` and the click at the real
point, as the iPhone SE did.

---

## Store reads in hooks

A hook runs again only when the value it uses changes.

**Why.** `const store = useXStore()` with no selector gives the whole
Zustand state. That object is new after every `set()`. A hook that lists
`store` in its dependency array runs again on every state change. A game
loop restarts every frame, so its `deltaTime` and its timers reset. An
interval or a key listener is removed and added again on every tick. A
`useCallback` is a new function after every `set()`, so each effect that
depends on it runs again too. In Weather, this made the city search ask
the geocoding service again about every 300 ms for as long as a query
stayed in the box (issue #56).

**Rules for a game or an app:**

- In a handler, an effect, a loop or a timer, read the state when the
  code runs: `useXStore.getState().tick()`. Do not put `store` in the
  dependency array.
- For a value that the render shows, subscribe to that field with a
  selector: `useXStore((s) => s.score)`. A field such as `store.level`
  in a dependency array is also correct.
- A component can keep `const store = useXStore()` for the values that
  it shows. Do not put that `store` in a dependency array.

**Enforcement:**

- ESLint rule `hanks-hits/no-whole-store-deps` reports a variable that
  holds `useXStore()` (called with no arguments) in the dependency array
  of `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useCallback`,
  `useMemo` or `useImperativeHandle`. It applies to all of `src/**`.
  Tests are exempt. `src/shared/lib/wholeStoreDepsRule.mjs` holds the
  rule.
- A store hook is a name that ends in `Store`, or a name in
  `OTHER_STORE_HOOKS`. `src/shared/lib/__tests__/wholeStoreDepsRule.test.ts`
  reads every Zustand `create()` in `src`. It fails when a store hook has
  a name that the rule cannot see. Give a new store a name that ends in
  `Store`.

---

## Progress saves and leaderboards

`POST /api/progress/[appId]` writes the player's save (`app_progress`).
Then it writes the player's board row (`leaderboard_entries`) from a
number in that save.

**The save comes first.** The board row is a copy of a number that is
already in the save. A failure of the board write must never lose the
save.

- The route writes the board row in a savepoint (a nested
  `tx.transaction`). If the board write fails, Postgres rolls back to the
  savepoint, and the save commits.
- Do not replace the savepoint with a bare `try`/`catch`. A failed
  statement aborts the Postgres transaction. The `COMMIT` of an aborted
  transaction is a `ROLLBACK`, so the save is lost and the route still
  sends 200.
- The next save writes the board row again, because the route reads the
  score from the full saved blob.

**Optional revision protocol (server foundation).** GET includes `protocol: 1`
and an opaque `revision` for the returned canonical row, or `null` when no row
exists. A conditional POST includes that exact `baseRevision` and the mounted
account's `expectedOwnerId`. Before a game has been deleted, legacy clients may
omit `baseRevision`. Explicit `null` means create only if the row has never been
saved or deleted. Invalid revisions are rejected, never treated as a legacy save.

- All POSTs, including old clients, and DELETE take the same per-owner/app
  transaction advisory lock before reading the row. The lock is a separate SQL
  command so a waiting transaction reads the winner's committed state. This
  serializes writes without adding a save timeout or rejecting concurrent saves.
- A matching revision makes the incoming blob the continuation base, including
  idle progress with an unchanged player timestamp. The field rules and final
  schema validation still apply. The success response contains the canonical
  stored `data` and new `revision`, read back inside the transaction.
- An explicit recovery choice adds `resolution: true`. Only literal true is
  accepted, and both revision and owner assertions are required. After the same
  locked revision check, the selected validated snapshot replaces the stored
  snapshot without ordinary record folding. Word projection and transactional
  preservation of the old word source still apply. The runtime derives this
  mode from its persisted `forceWrite` choice, retains it on uncertain retries,
  and removes it only after acknowledgement. An unchanged choice still advances
  the revision. Older clients omitting this field retain normal merge behavior.
- A stale revision returns 409 `revision_conflict` with current canonical data
  and revision, without writing either progress or leaderboard. A changed owner
  returns 409 `owner_changed` without revealing the current account's data.
- Revisions hash owner, app, row id and driver-visible update time. Every
  cooperating write advances that time by at least one millisecond, even for a
  no-op or a backward wall clock. DELETE retains a metadata-only row with JSONB
  null data and an advanced revision, including when no save existed yet. SQL
  NULL is not used. Repeated deletion advances the fence again.
- DELETE atomically clears transaction logs, legacy word archives, and the game's
  leaderboard entries. Aggregate progress excludes metadata-only rows; a per-game
  GET returns null data with the deletion revision. Account deletion still removes
  the whole row through the owner cascade.
- Migration `0004_progress_deletion_fence` adds `revision_required` with a false
  default. DELETE sets it true; recreation preserves it. Once set, every save must
  include the exact revision. Otherwise an old unconditional request could arrive
  after deletion and a legitimate restart, silently restoring the deleted game.
- Apply the additive migration before new server instances start. Drain all old
  server instances and their requests before relying on deletion fences. An old
  server ignores revisions and can physically erase the fence. After activation,
  rollback is only safe to a tombstone-aware server that preserves this flag.
- All-client revision integration and explicit recovery choices must ship before
  activating this deletion behavior. Legacy browser clients are rejected after
  deletion, even after another client restarts the game; they must reload to a
  revision-capable client. Never downgrade such retries to unconditional saves.
- Client integration is separate. It must retain the acknowledged canonical
  base, immutable sent snapshot and later local edits independently. A lost
  acknowledgement is not permission to overwrite a new revision: fetch and
  reconcile, retain both alternatives on a real conflict, and never retry as a
  legacy unconditional write. A beacon is not an acknowledgement.

The deletion fence and local journal primitives do not complete #69 or #70.
Generic runtime integration, conflict choices, recovery verification and the full
release gate remain required. Cookie's compatibility session accepts null-data
revisions and never rebases an initial save automatically onto a deletion fence.

**How the legacy server merge works.** The client (`useAuthSync`) sends
`merge: true` with each save after the first sync. The route merges the
save with the stored row in `src/lib/progress-merge.ts`.

- The newer blob is the base. The route compares the `lastModified` value
  of each blob (last write wins). The row's `updatedAt` is used only when a
  blob has no time.
- Each field then follows the reviewed table of its game in
  `src/lib/progress-field-rules.ts`:
  - `max`: keep the larger value. Use it for a field that only grows (a
    high score, a total, a level reached, an upgrade level). A flag that
    only turns on (a level completed) keeps `true`.
  - `minPositive`: keep the smaller value that is more than zero. Use it
    for a best time or a fewest-moves win. Zero or `null` means "no record".
  - `earliest`: keep the earlier time (a trophy unlock).
  - `union`: keep the items of both lists (things that the kid unlocked).
  - `neither`: keep the value of the base. Use it for a wallet that the
    kid spends, a value that goes down in play, a setting, a time, text,
    and a list that the kid edits.
- A record (a key such as a level id or a stage id) that only the older
  blob has is copied into the result.
- A list of objects (saved drawings, beats, wishes) is one field with
  `neither`. A merge of list items by id is part of the conflict protocol
  (#69i).

**Add a field or a game.** Add an entry for each schema field to
`progress-field-rules.ts`. Read the store first. Use `max` only when no
code path makes the field smaller, except a full reset. Cite the store
line (`file:line` and the code in backticks).
`src/lib/__tests__/progress-field-rules.test.ts` fails when a schema field
has no entry, when an entry has no schema field, when a cited file no
longer has its code, and when a field that the profile page or a
leaderboard reads has no entry.

Oregon Trail's `currentEvent` is a bounded event snapshot: it preserves authored
events, choices, effects, and generated river results, while rejecting unknown
fields and arbitrary nested JSON (#72). The merge keeps the newer event as a
whole. Validation messages omit unknown property names so rejected body content
is not copied into logs.

**A merged blob that breaks the schema.** The route checks the merged blob
with the schema again (two valid blobs can make a list that is too long).
When the check fails:

1. The route starts again from the newer blob alone. Then it adds the
   merged fields one at a time, and keeps each field only when the blob
   still passes. An older save never replaces a newer row.
2. When the newer blob is the stored row and the schema of today refuses
   the row itself, the route stores nothing and sends 409. The client
   keeps its save on the device. Its next change is newer than the row, so
   the next save is stored.

The route logs the fields that it left out and the reason, with no values.

**The schema must take every value that the client makes.** The server
sends 400 for a save that its schema refuses, and the client does not
send that save again. `src/lib/__tests__/progress-schema-types.test.ts`
compares the type of each store's `getProgress()` with the type of its
schema. It fails to compile when the schema refuses a value that the
store's type allows (an age in a picker) or drops a field that the store
sends (z.object() removes an unknown field). Change the SCHEMA, not the
test. The types do not show number limits, so check a limit against the
store's code before you set it.

**Board scores are whole numbers.** `leaderboard_entries.score` is a
Postgres `bigint`. Some games keep fractions (the Hill Climb distance,
the Cookie Clicker cookie count).

- An extractor in `src/lib/leaderboard-extractors.ts` returns the raw
  value. Do not round in an extractor.
- `toBoardEntry()` makes the whole number for all games. It rounds
  `high_score` and `wins` down, and `fastest_time` up, so a board never
  shows a better result than the player got. It gives no entry for a
  value that is negative, not finite, or more than 1e12.
- `leaderboardEntrySchema` accepts only whole numbers.

**Logs.** Do not log a raw error from a database call. The message of a
drizzle error holds every query parameter: user ids, emails, password
hashes, and progress blobs with names that kids type. Log
`describeError(error)` from `src/lib/describe-error.ts`. It keeps the
error classes, the SQLSTATE, the names of the table and the constraint,
and the stack frames.

**Tests.**

- `src/app/api/progress/[appId]/__tests__/route.test.ts` runs the route
  on an in-memory stand-in for Postgres. It runs every time.
- `route.pg.test.ts` in the same folder runs the route on a real
  Postgres. It runs only when `TEST_DATABASE_URL` names a server on this
  computer, for example `postgres://localhost:5432/postgres`. The test
  makes its own database, applies the migrations in
  `packages/db/drizzle`, and drops the database. It refuses a server on
  a different computer.
- The pre-push hook sets `TEST_DATABASE_URL` when a local Postgres
  answers. To run the test by hand:
  `TEST_DATABASE_URL=postgres://localhost:5432/postgres pnpm --filter web test`.

---

## Progress time (cloud sync)

The time in synced progress (`lastModified`, or `updatedAt` in Memory
Match) marks the last change that a player made. Nothing else sets it.

**Why.** `useAuthSync` merges the progress of a device and the progress of
the account by this time: the newer progress wins
(`src/lib/progress-merge.ts`). Before this rule, most stores put the
page-load time into their default progress, and three stores returned
`Date.now()` from `getProgress()`. Untouched progress then looked newer
than the account. At sign-in, or on a second device, the defaults replaced
the account's pet, beats, wishlist, journey and coins (issue #26i).

**Rules for a store that syncs:**

- The default progress has time `0`. A time of `0` means "untouched".
- `getProgress()` returns the stored time. A read never stamps.
- `setProgress()` keeps the time of the progress that it gets.
- A player action that changes progress stamps `Date.now()`. An action
  that changes nothing keeps the time. Use `stampIfChanged()` from
  `src/shared/lib/progressStamp.ts`.
- A store that keeps its synced fields at the top level of its state can
  use `progressStamp()` instead (Hill Climb, Monster Truck, Oregon
  Trail).
- An automatic change that a page makes once (a page load, the catch-up
  for the time away, a visit on a new day) uses
  `automaticStamp(time, synced)`. It stamps only progress that a player
  already changed, and only when `synced` from `useAuthSync` is true (the
  store holds the account's progress).
- A continuous change never stamps: a clock that runs while the page is
  open (Cookie Clicker's bake, the Four-Wheeler world clock, the pet's
  needs). A stamp there makes an idle page newer than what the kid did on
  another device, and its saves replace that. Equal-time saves retain
  the stored row, with only the reviewed field reconciliation applied.
  Cookie Clicker opts into revision-based continuation after initial sync;
  other games' lineage-aware automatic progress remains part of B2.
- A page that changes progress by itself waits for `ready` from
  `useAuthSync`. Then the change applies to the account's progress, not to
  an old copy on the device. When the account cannot be reached for
  `READY_FALLBACK_MS` (10 s), `ready` turns true and the page runs on the
  device's progress, as a guest's page does. `synced` stays false until the
  first sync is done, so no automatic change stamps that old copy. When the
  sync ends later, run the automatic change again on the account's
  progress (Cookie Clicker bakes the time away in `onSyncComplete`).
- Define the untouched rule of the store with `defineUntouchedProgress()`
  (`src/shared/lib/untouchedProgress.ts`). Put every setting (sound,
  difficulty, a picked vehicle) and every clock in `ignore`: settings are
  not progress. A counter that a page load changes by itself goes in
  `within`, with the value that one load can reach.
- In the persist options, keep the `version` of the store. Use
  `merge: settleOnLoad(UNTOUCHED)` and wrap the `partialize` result in
  `markSaved()`. The marker key tells a save of this code from a save of
  the old code, which gets its real time on load. Do not raise the
  version for this: the old code loads the defaults for a higher version,
  so a rollback would lose progress.
- A store whose old saves have no time (Hill Climb, Monster Truck, Oregon
  Trail) calls `persistSettledSave(store, UNTOUCHED)` after `create()`. It
  writes the settled save once, so the next load does not give the old
  progress a newer time again.
- A store whose old code keeps keys that it does not know (Oregon Trail
  saves its whole state) uses `markSavedWithSum(UNTOUCHED, ...)`. After a
  rollback, that code keeps the marker and the old time while the kid plays
  on. The sum of the progress tells such a save, and it loads with the old
  rule's time.
- Put the lists of items that a player makes (a beat, a drawing, a wish)
  in `lists`, with the key of an item and the schema's bound.
- Do not set progress from a component with `setProgress()`. Put the
  player action in the store, so that it stamps the time.

**What the first sync does (`useAuthSync`):**

- An untouched device (time `0`, or only settings and clocks changed)
  takes the account's progress. What time alone earned on the device (an
  unlocked pet species, a visit streak) is folded in.
- An account row of untouched progress gives way to the device's real
  progress, and keeps its records. The new code never uploads untouched
  progress, so such a row is a row of the old code, whatever its time (a
  tab that still runs the old code, a rollback, a wrong clock).
- Every touched device sends its progress with `merge: true`. The server's
  last-write rule decides, including guest play. There is no guest/lineage
  classifier in B1. Cookie's durable recovery records are an explicit exception
  before this first-sync selection; per-store guest merging remains #69i.
- After the first GET, the hook reads live progress again. If an untouched
  device was played during that request, its live snapshot follows the
  touched rule. New account list items join that snapshot using the store's
  recency and eviction rules, preserving drawings or beats made during GET.
- A refusal from the server's schema keeps the device's progress and makes
  the page ready. A retryable network/server failure keeps trying; an
  unchanged schema-refused payload is not repeatedly sent.
- No save sends progress that the store's rule calls untouched. A change
  to a setting alone reaches the account with the kid's next real change.
- Another tab that saves newer progress for the same key: the tab takes it
  before its next change, and folds in its own records that the other tab
  does not hold. Only this tab's unsaved new list items join the other tab's
  list; a previously shared item deleted there stays deleted. Any addition
  stays pending for upload. Lists use their store's own recency and bounds,
  and each eviction is logged without values. A page restored from the
  back-forward cache checks ownership before taking the saved progress.
- Every save path requires the completed first-sync owner to match the
  session. Account changes during or after the first sync lock uploads,
  clear foreign saves, and reload. Debounce, force-sync, unload, and unmount
  all use the same ownership check.
- Equal-time saves keep the stored row under master's existing conflict
  ordering. Equal timestamps do not establish shared lineage.

**Cookie continuation and recovery.** Cookie Clicker alone supplies the optional
`ProgressContinuation` adapter to `useAuthSync`. A canonical revision is paired
with its exact data before offline baking starts. Retained local progress that
did not adopt the returned canonical row requires a choice; it cannot borrow
that row's revision. Every subsequent send, including beacons, uses conditional
POSTs. The server foundation must already be deployed with old server writers
drained before this client is released.

The Cookie session keeps acknowledged, immutable sent, and live snapshots
separately. It retries an unknown outcome with the same sent snapshot. A 409
can recover automatically only when canonical data equals the expected sent
result (lost acknowledgement) or the old base (an intervening no-op). Otherwise
the game presents both alternatives. Cookie balances and overlapping offline
earnings are never added together. Successful acknowledgements preserve later
local edits and transient frenzy/golden-cookie state.

Each writer uses a separate `cookie-clicker-sync-<uuid>-storage` journal. The
suffix is cleared on sign-out and foreign-owner purge. Recovery includes all
unresolved same-owner journals and pre-choice backups. A choice folds reviewed
records from every offered alternative, while its wallet comes only from the
selected copy. Original copies remain actionable until acknowledgement. Exact
writer-key/serial receipts retire incorporated copies without deleting another
tab's concurrently changed record. Failed storage remains in memory and is
reported visibly. Account/lifecycle checks reject late responses and prevent
recreating data after sign-out. Cookie storage events retain the current writer's
progress instead of treating another tab's timestamp as a canonical revision.

The shared hook's existing behavior remains for games without this adapter.
This does not complete the all-game reconciliation and two-device proof in #69.

The shared runtime's compatibility importer is prepared but not active in this
hook yet. `import-progress-journals.ts` inventories durable owner-scoped and
legacy Cookie journals, retaining exact source bytes inside generic journals.
Sent requests, backup alternatives, guest IDs and old retirement evidence stay
recoverable. Pending imports require an explicit choice; legacy retirement
receipts do not suppress them automatically. Failed enumeration or malformed
same-owner data blocks recovery. The repository includes these read-only sources
in every inventory, archives them before adoption/choice, and suppresses only
exact source identities covered by a later generic acknowledgement and receipt.
Legacy keys are never rewritten or deleted by this importer.

**Enforcement:**

- `src/__tests__/store-default-timestamp.test.ts`: every store that
  `useAuthSync` syncs is in `src/__tests__/synced-stores.ts`, starts at
  time 0, keeps the server's time, keeps the persist version of the old
  code and marks its saves.
- `src/__tests__/progress-stamp-fuzz.test.ts`: about 6,000 seeded random
  actions over all synced stores. A player action that changes progress
  stamps the time, an action that changes nothing keeps it, a continuous
  change never moves it, and progress that a save sends passes the
  server's schema. Every action of a store needs a driver step or a skip
  reason.
- `src/__tests__/page-load-untouched.test.tsx`: a page load keeps an
  untouched store untouched.
- `src/__tests__/legacy-save-migration.test.ts`: the saves of the old
  store code (`src/__tests__/fixtures/legacy-saves.json`, made by
  `apps/web/scripts/legacy-saves/generate.sh`) load with their real time.
- `src/__tests__/rollback-safety.test.ts`: the old store code loads the
  saves of this code with their progress
  (`apps/web/scripts/legacy-saves/rollback.sh` makes the fixtures; run it
  again after a change to a store's save).
- `src/shared/hooks/__tests__/useAuthSync.roundtrip.test.tsx`,
  `useAuthSync.review4.test.tsx` and `useAuthSync.noLoss.test.tsx`:
  sign-in, a guest who signs in, a second device, an outage, other tabs and
  the deploy, with the real stores, the real pages of Cookie Clicker and
  Virtual Pet, and the server's real merge.
- `src/__tests__/no-worse-than-master.test.tsx` compares every deploy,
  guest, outage, in-flight, tab and owner cell with the rollback build.
  Every cell must lose no value that master keeps, except the four
  explicitly approved legacy load decisions below. Devices still untouched
  at synchronization and second-tab cases must improve where master loses
  progress. A device played during GET is touched and follows normal LWW.
  No general conflicting-value exemption is permitted.
- **Approved legacy load difference (2026-10-02):** Monster Truck and
  Oregon Trail old saves contain no timestamp. B1 assigns one on load;
  master kept assigning a later one on each read. At the equal-row boundary,
  two legacy formats select the account wallet/journey where master selected
  the device wallet/journey. Jack approved this behavior with the differences
  documented. `approved-legacy-load-differences.json` records only the exact
  four cases (18 differing values); additional differences still fail.

**Deferred to #69i.** Per-store client record rules, weight-based base
selection, refused guest-fold recovery, lineage/base-version handling outside Cookie,
missing-owner guest classification, the signout-broadcast transition gap,
and broader legacy recovery remain part of B2. Preserve `wip/sync-stamps-full`
until that work is complete.

---

## Request bodies

CAUTION: Do not read a request body with `request.json()`, `request.text()`,
`request.formData()`, `request.arrayBuffer()`, `request.blob()` or
`request.bytes()`. Do not give the request to a library that reads it.
Read the body with `readJson()` or `readBody()` from
`src/lib/read-body.ts`.

**Why.** A Next.js route handler has no body limit of its own. This app
has no middleware. The Railway service domain answers with no Cloudflare
in front of it, so the Cloudflare body limit does not protect the server.
`request.json()` holds the whole body in memory before the route can check
it, also a chunked body with no `Content-Length`. Auth.js read every POST
to `/api/auth/*` in the same way, before its CSRF check and with no
sign-in: one 300 MiB POST raised the memory of the server (RSS) to about
1.1 GB.

**How the reader works.**

- The caller gives the limits as `{ maxBytes, timeoutMs }`, and
  `readJson()` also needs `maxJsonValues`. `timeoutMs` is a number of
  milliseconds, or `null` for no time limit. `maxJsonValues` is a number,
  or `null` for no count. Only `null` turns a limit off. A missing value
  throws, so no default can turn a limit on or off by accident.
- A declared `Content-Length` over `maxBytes` gets 413 at once. The reader
  reads no byte of that body.
- The reader does not trust `Content-Length` for the rest. It counts the
  bytes while they arrive. At the first chunk over `maxBytes`, it cancels
  the stream and the route answers 413. The server holds at most the limit
  and one chunk.
- With `maxJsonValues`, `readJson()` also counts the JSON marks `{ [ , :`
  outside strings while the bytes arrive. Each value or key after the
  first value comes just after one of these marks. `JSON.parse` makes one
  object for each value, so a body of many small values uses much more
  memory than its bytes. A body with more marks than `maxJsonValues` gets
  413 before the parse.
- `readJson()` answers 400 for an empty body or for text that is not JSON.
  The failure never holds the body text.
- The route answers a failed read with `refuseBody()`. It writes one log
  line: the route, the reason (`too_big`, `too_many_values`, `timeout`,
  `bad_json` or `broken`), the declared `Content-Length` and the bytes that
  arrived. The line has no value from the body and no user id. So a refused
  body is never silent, also a save that a phone cut off part-way.

**The limits.**

| Route | Limits | Why |
| --- | --- | --- |
| `POST /api/auth/*` (Auth.js) | `SMALL_JSON_BODY`: 64 KiB in 30 s | A sign-in form is a few hundred bytes. No sign-in is needed, so the 30 s limit ends a connection that is held open. |
| `POST /api/auth/signup` | `SMALL_JSON_BODY` | A form of three fields. No sign-in is needed. |
| `PATCH /api/profile` | `SMALL_SAVE_BODY`: 64 KiB, no time limit | One name. A save of a signed-in player. |
| `PATCH /api/gaming-profile` | `SMALL_SAVE_BODY` | One switch. A save of a signed-in player. |
| `POST /api/progress/[appId]` | `PROGRESS_SAVE_BODY`: 100 MiB, 12,000,000 JSON marks and 1,000,000 allocation units, no time limit | Over the largest valid save (see below). |

**Auth.js.** `src/app/api/auth/[...nextauth]/route.ts` exports Auth.js's
GET as it is (Next.js gives a GET handler no body). Its POST reads the body
with `SMALL_JSON_BODY`, then gives Auth.js a new request with the same
bytes and the same headers. An empty body stays an empty body (not `null`),
so Auth.js answers an empty JSON sign-in with its own 400, as before. CSRF,
sign-in, sign-out and the callbacks work as before. The test runs the real
Auth.js.

**Auth.js logs.** The default Auth.js logger printed `error.message`. For a
JSON body that does not parse, that message is V8's `SyntaxError` text,
and it quotes the body near the bad token (part of a password). The app's
logger (`src/lib/auth-logger.ts`) logs the Auth.js error type and kind and
`describeError()` of the error and its cause. It logs no message.

**Saves have no gates.** A save (a progress save, a name, the leaderboard
switch) has limits that no valid save can reach, and nothing more. It has
no time limit of its own, no speed floor, no limit on the saves of one
account at the same time, and no memory budget for the process. A first
design had all four. Review found that each one refused or lost real
saves:

- A limit on saves in flight answered 429 to the overlapping saves of a
  drawing gallery, and the kid lost the drawings.
- A time limit answered 408 to a phone that paused for 30 s.
- A memory budget let one slow account make every save answer 503.

The byte limit and the JSON value count are not gates of this kind. Each
one is over the largest valid save of every game, and the test of the
largest save (below) proves it.

Node's own `requestTimeout` (300 s) still ends a request that does not
finish in time, as before this change. At 1 Mbit/s, 300 s carries about
37 MB. Measured on the standalone server (2026-10-02):

- The largest drawing save (60 MB) at 2 Mbit/s got 200 after 243 s.
- A save of 11 drawings (33 MB) at 1 Mbit/s got 200 after 267 s.
- A small save that paused for 35 s in the middle got 200.
- The largest drawing save at 1 Mbit/s got Node's own 408 after 310 s, at
  38 MB. The server on master does the same, because the limit is Node's.

**Largest game-produced saves.** The test "the largest valid save of every game
passes" (`src/app/api/progress/[appId]/__tests__/route.test.ts`) builds the
upper-bound payloads from the schema (`largestSave.ts` in
the same folder). Typed text uses a 3-byte character, and image data URLs
use 1 byte a character (base64). Each save goes through the route and gets
200. The expanded Drum Machine schema now produces the largest fixture,
with 10,261,528 JSON marks (mostly booleans), below the 12,000,000-mark
budget. The Drawing App gallery still contributes about 60 MB of base64
image data. A separate streamed budget counts containers and strings,
including object keys, and stops at 1,000,000 units. The maximum fixture
of every schema must fit both budgets. This retains the former
empty-object ceiling while admitting long boolean patterns; wide objects
and arrays of strings also consume allocation units.

Oregon Trail events are now bounded; the route also accepts every authored
event and the generated river result. Image fields still accept arbitrary
Unicode at the schema level, so the byte proof applies to the base64 that
the game produces, not every Unicode value accepted by Zod.
Route exports must be explicit
functions; the inventory rejects factory results whose body handling
cannot be inspected. Dynamic evaluation is forbidden in server code.

**Residual risk.** A signed-in account can still send several 100 MiB
bodies at the same time. Each one holds up to 100 MiB of bytes, and more
while the route decodes, parses, validates and writes it. The budgets bound
inputs, not exact peak memory. Historical measurements below used the
original 2,000,000-mark limit before B0 widened Drum Machine saves; the
byte/timer results remain relevant, while count-specific byte and memory
measurements are not measurements of the new allocation budget:

- A 300 MiB chunked POST to the save route from one account stopped at
  100 MiB (413). The RSS of the server went from 106 MiB to 295 MiB until
  the garbage collector freed it.
- A 60 MB save and a 33 MB save that ended 25 s apart raised the RSS from
  about 120 MiB to 753 MiB.
- Before the JSON value count, ONE save body of 100 MiB of empty objects
  (`[{},{},...]`, 35 million values) raised the RSS from 827 MiB to
  3,761 MiB, and a GET of another player waited 3.4 s. With the count, the
  route refuses that body with 413 after 3,036,208 bytes (69 ms), and the
  RSS went from 80 MiB to 115 MiB. A body of 100 MiB of zeros
  (`[0,0,...]`, 52 million values) gets 413 after 4,062,288 bytes. The
  largest valid Drum Machine save (661,328 marks) still gets 200.
- For comparison, a 300 MiB chunked POST to `/api/auth/callback/credentials`
  with no sign-in raised the RSS of the server on master from 123 MiB to
  1,128 MiB. With the wrapper, it gets 413 after the limit and one chunk
  (130,885 bytes), and the RSS does not grow (50 MiB before, 50 MiB at the
  peak).

The real fix is to make the saves small. Part C of #26i (planned,
`design/LOCAL_WORDS.html` on branch `fix/coppa-accounts`) keeps drawings
and typed words on the device and out of the synced progress. After part
C, lower `PROGRESS_SAVE_BODY.maxBytes` and `maxJsonValues` to the new
largest valid save. The test of the largest save shows the new numbers.

**The checks.**

- The ESLint rule `hanks-hits/bounded-request-body`
  (`src/lib/boundedBodyRule.mjs`) covers `src/app`, `src/lib`, and a
  `src/middleware.ts` or `src/proxy.ts` file if one is added. It finds
  the request (the first parameter of a route handler, also out of line or
  in a wrapper; a value typed `Request` or `NextRequest`; a name of a value
  that ends in "request" or "req"). It follows the request through
  aliases, casts, destructuring, arrays and objects, the functions of the
  file and the constructors of its classes. It reports a body member. It
  fails closed: it reports every other use of a request that is not on its
  list of safe uses (a member that is not a body member, a test, a
  comparison, an untagged template). So it reports a request that goes to
  code outside the file (a package, another module, a global such as
  `fetch`, a callback, or a method of another object), a request that a
  function returns or throws, and a request that goes into a member, a
  class field or a default value. Only `@/lib/read-body` and the helpers in
  `REQUEST_HELPERS` can get the request. The inventory test checks that
  each helper takes the request in a parameter typed `Request`, so the rule
  checks the helper in its own file.
- The rule's test fails on an `eslint-disable` comment that turns the rule
  off in its files (also a comment with no rule list, which turns every
  rule off). The one exception is the bounded reader itself, in
  `src/lib/read-body.ts`.
- The route inventory test (`src/app/api/__tests__/body-inventory.test.ts`)
  lists every route file with its body methods and the limits that it
  reads with. A new route fails the test until it is in the list. These
  fail the test:
  - a POST, PUT, PATCH, DELETE or OPTIONS that is not a function of the
    route file (an export of a library's handler, such as
    `export const { POST } = handlers`);
  - an `export let` or `export var` handler, and a handler whose name the
    file assigns again (`POST = handlers.POST`);
  - limits that are not a preset imported from `@/lib/read-body` (a
    constant of the route with the name of a preset);
  - a Pages Router folder (`src/pages` or `pages`), or an `app` folder
    outside `src`. Their API routes are outside the rule and the inventory.

---

## Gameplay Clips

**Live check.** `pnpm e2e:clips-games <base-url>` (`e2e/clips-games/`) makes
a clip in every game whose `metadata.ts` has `clips: true`. It plays each
game by touch, taps the clip button (or the result chip), saves the clip
from the viewer, and checks the MP4: the game area is not blank, the
picture never stands still for more than 2 s, the file decodes with no
error, the viewer plays it to the end, and a game with a sound switch has
sound. Run it against production after a deploy that changes clips or a
clip game. `E2E_ROUTES=/games/asteroids` runs one game.

A kid taps the clip button in the header, and the game keeps the last 30
seconds as a video. A hold of 500 ms opens the Capture menu. A press that
the kid drags more than 48 px off the button before letting go makes no
clip, like a native iOS button. The code is in `src/shared/clips/`. Import
clip features only from the barrel `@/shared/clips`.

**Turn clips on for a game.** Put the plain literal `clips: true` in the
game's `metadata.ts`. Then give the game's canvas to the clip service with
one hook call after the canvas exists:

```tsx
useClipSource(canvasRef, { isPlaying: status === "playing" });
```

`isPlaying` is false on every break (a wave card, the game's own pause, the
game-over card). A game reports runs and moments through
`useAttachedGame()`: `runPhase("start" | "end")` and
`markMoment({ kind, label, emoji, priority })`. Report each run: the result
chip clips only the run between `runPhase("start")` and `runPhase("end")`,
and it shows no clip button for a game that reports no run. At game over,
mount the shared `ResultChip`. The chip then shows the clip buttons by
itself: "Watch the whole run (m:ss)" for a run of 30 seconds or less, and
"Watch the end" and "Make the whole run a video (m:ss)" for a longer run.
Record a video and Take a picture are in the Capture menu (a hold on the
clip button). Asteroids is the first game with clips
(`src/games/asteroids/lib/useAsteroidsClips.ts`). The clip records only the
sound that goes through the shared audio bus (see "Audio").

A game does nothing more for the clip UI. Do not mount a clip part (the
clip button, the toast slot, the pause-menu entry or the result-chip clip
buttons) yourself. GameShell and `ResultChip` put each part in its place.

**What GameShell does.** For a module with `clips: true`, GameShell wraps
the header, the game and the pause menu in `ClipShellScope`:

- `ClipProvider` reads the clips flag once per tab (`GET /api/clips-config`).
  When the flag turns capture on, it loads the clip service with a dynamic
  import and attaches the game.
- `ClipUiMount` (`src/shared/clips/shell/ClipUiMount.tsx`) loads the clip UI
  (`src/shared/clips/ui/shellParts.ts`) with a dynamic import, only when
  the service exists. It holds the UI contexts from the first render, so
  the game does not remount when the UI arrives. If the load fails, it
  tries again after 2 s, 10 s and 60 s, then each time the page becomes
  visible. There is no capture without a clip button: until the UI runs,
  `useAttachedGame()` gives null under the mount, so the game registers no
  canvas and the capture engine does not start.
- The loaded `ClipUiRuntime` (`src/shared/clips/ui/ClipUiRuntime.tsx`)
  makes the page's clip UI controller and renders the clip sheets. It is
  the only way that the clip UI gets onto a page.
- GameShell then puts the clip button in the header clip slot, the in-play
  confirmation in the title region, the toast slot under the header, and
  the "Clips" entry in the pause menu (the menu reads it out loud).
  `ResultChip` shows the run's clip buttons and reads them out loud (each
  length in words). Both clip bounds come from the run's own start and end
  on the clip timeline, so a clip never holds an earlier run.

A module without `clips: true` gets no clip code, no request and no
header slot. A clip-enabled module with the flag off reads the flag and
loads nothing else. The barrel test (`src/shared/clips/__tests__/barrel.test.ts`)
walks the static imports and fails when a page can reach the workers, the
engine, mediabunny, WASM or the clip UI without a dynamic import.

**The flag.** `CLIPS_MODE` is read on each request: `on`, `dogfood` or
`off`. In development the default is `on`, and in production it is `off`.
An unknown value means `off`. `dogfood` turns capture on only for the
signed-in ids in `CLIPS_DOGFOOD_USER_IDS` that have the signed dogfood
cookie (`POST /api/clips-config/dogfood`, signed with `AUTH_SECRET`).
Both variables are declared with `preserve()` in `.railway/railway.ts`, so
`railway config apply` keeps their Railway values. Never declare
`CLIPS_LAB` there.

**The clips lab.** `/clips-lab` answers 404 unless `CLIPS_LAB=1` is set at
run time. It plays a flash and a 1 kHz beep each second and makes clips
with the real service. `pnpm clips:e2e` (from the repo root) drives it in
Chrome and checks the files with ffmpeg and AVFoundation
(`scripts/clips/analyze-sync.mjs`).

---

## Next.js Configuration

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['three'],
  experimental: {
    // May need for R3F
  },
};

export default nextConfig;
```

---

## Performance Considerations

### Mobile WebGL

From [WebGL Mobile Challenges](https://blog.pixelfreestudio.com/webgl-in-mobile-development-challenges-and-solutions/):
- Mobile GPUs less powerful than desktop
- Complex 3D can crash browsers
- Need aggressive optimization

**Optimizations:**
1. LOD (Level of Detail) for distant objects - use drei's `<Detailed>`
2. Limit draw calls by merging objects
3. Cap frame rate on weak devices (30fps)
4. Use `<PerformanceMonitor>` from R3F
5. Reduce shadow resolution on mobile
6. Simple low-poly models for vehicles

### Terrain

From [THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain):
- Procedural generation (Perlin/Simplex noise)
- Chunk loading for large worlds
- GPU shaders for performance

---

## Implementation Phases

### Phase 1: Drivable Truck (MVP)
- [ ] Set up React Three Fiber scene
- [ ] Create ground plane with basic texture
- [ ] Build truck with Rapier physics
- [ ] Third-person camera following truck
- [ ] Keyboard controls (WASD)
- [ ] Basic lighting and skybox

### Phase 2: Mobile Controls
- [ ] Touch pedals overlay (gas/brake)
- [ ] DeviceOrientationEvent for tilt steering
- [ ] iOS permission request flow
- [ ] Fallback: on-screen steering buttons

### Phase 3: Terrain & World
- [ ] Procedural terrain with hills/valleys
- [ ] Ramps and jumps
- [ ] Boundaries

### Phase 4: Collectibles & Fun
- [ ] Stars scattered around (50-100)
- [ ] Star counter UI
- [ ] Particle effects on collection
- [ ] Sound effects (engine, horn)
- [ ] Destructible crates/barrels

### Phase 5: Polish & Expand
- [ ] Better truck model (GLTF)
- [ ] Multiple truck options
- [ ] Save progress
- [ ] Themed zones

---

## Current Status

The platform runs on Railway (auto-deploys on push to `master`) and is well past the original monster-truck MVP. The monster-truck design sections above are realized as a real game, and the platform has since generalized into many self-contained game/app modules — see **Project Structure** above and `CLAUDE.md` for the authoritative "add a new game" pattern, and `design/FRAMEWORK_ROADMAP.md` for where it's heading.

- [x] Turborepo + pnpm workspace
- [x] Next.js 16 + React 19 app, DaisyUI kid theme ("Hank's Hits")
- [x] Home page that auto-discovers games from their `metadata.ts`
- [x] Monster-truck 3D game (R3F + Rapier) plus a full library of games and fun-apps (2048, Snake, Asteroids, Hill Climb, Cookie Clicker, Chess, weather, jokes, drawing, virtual pet, …)
- [x] Auth (next-auth) + cloud progress save (PostgreSQL via Drizzle) with Zod-validated writes
- [x] Leaderboards + profile stats
- [x] One-file site rebranding (`apps/web/src/config/site.json`)
- [ ] **Ongoing:** more games/apps as kids dream them up, plus platform polish

---

## Key References

- [pmndrs racing-game](https://github.com/pmndrs/racing-game) - Open source R3F racing game
- [ecctrl](https://github.com/pmndrs/ecctrl) - Vehicle controller with joystick
- [react-three-rapier car example](https://github.com/pmndrs/react-three-rapier/blob/main/demo/src/examples/car/CarExample.tsx)
- [DeviceOrientationEvent MDN](https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events)
- [sbcode Car Physics](https://sbcode.net/threejs/physics-car/)
- [Offroad Outlaws](https://play.google.com/store/apps/details?id=com.battlecreek.offroadoutlaws) - Design inspiration
