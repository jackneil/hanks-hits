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
right of the body. A nudge such as the iOS install tip shows in a break slot
outside the card (below it, or beside it on a short screen), never in the
card. The slot shows only while the whole card still fits next to it. If it
does not fit, the tip waits for the pause menu. The body shows a soft shadow
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

- 60 or less: game HUDs, touch controls and game modals.
- 90: GameStartOverlay, and the own start screen of a module with its own
  launcher (four-wheeler). It covers the viewport, so it must be above
  every game layer.
- 100: OrientationWarning (phone-width portrait only).
- 200: the install sheet that shows by itself on a page with no play.
- 1000: the GameShell header. The clip confirmation (`InPlayConfirm`) lies
  in the title region of the header, at the same level.
- 1050: toasts. The clip toast slot (`ToastSlot`) and the short notes of a
  game (for example "Saved!") use this level.
- 1100: the full-screen Retro Arcade emulator view. It covers the header
  and the toasts. Its own top bar has the Back button.
- 1150: AchievementCelebrations. A trophy that the kid earns while a retro
  game runs shows over the emulator view.
- 1200: ResultChip.
- 1500: modals (LeaderboardModal, tutorials).
- 2000: PauseMenu.
- 2500: sheets that the kid opens: the clip sheets (Capture menu, viewer,
  settings) and the install steps that the 📲 button opens (in the header
  or in the pause menu).
- 3000: dialogs (RestartConfirmationDialog).

Every layer above 1000 portals to `document.body` or mounts in the root
layout, so no game container can trap it (gameplay clips plan, section
11.4). The emulator view is `fixed` in the game content, which makes no
stacking context, so it does not need a portal. The celebration layer is
`pointer-events-none`, so it takes no tap except on its own dismiss
button. It stays below the result chip, the modals, the sheets and the
dialogs, so it never covers a question that the kid must answer. The
comment in `AchievementCelebrations.tsx` holds the same list.
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
bottom sheet must use the same hook.

**Layout under the shell:** content is offset by the header
(`pt-12 md:pt-14`); full-height modules size against
`calc(100vh - 3rem)` / `md:calc(100vh - 3.5rem)`, never `100vh`.

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

## Gameplay Clips

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
