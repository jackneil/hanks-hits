# Retro Arcade - Design Document

## Overview

**Retro Arcade** is an emulator hub for Hank's Hits that lets kids play classic console games directly in the browser. Using EmulatorJS, we'll embed emulators for NES, SNES, Game Boy, GBA, Genesis, and N64 - pre-loaded with **legal homebrew games only** (no commercial ROMs).

**Target Player**: Hank Neil, age 8 (and kids 6-14)
**Platform**: Web (mobile + desktop)
**Key Feature**: Pick a console, pick a game, play instantly - no downloads, no setup

This scratches the "retro gaming itch" without any legal trouble. The homebrew scene has created some genuinely fun games that rival commercial titles - puzzle games, platformers, shooters, and even RPGs - all 100% free and legal.

---

## Core Experience

### User Flow

```
LAND on Retro Arcade page
    |
SELECT a console (big colorful tiles)
    |
BROWSE games for that console (grid of game cards)
    |
CLICK a game to start
    |
PLAY with on-screen controls (mobile) or keyboard (desktop)
    |
SAVE progress (save states stay on this device in IndexedDB)
    |
RETURN later and continue where you left off
```

### What Makes It Fun

1. **Instant gratification** - Click and play, no waiting
2. **Discovery** - Homebrew games are new to most kids (hidden gems!)
3. **Variety** - Six different consoles, dozens of games
4. **Nostalgia** - Pixel art aesthetic is cool again
5. **Persistence** - Save states mean never losing progress

---

## Supported Systems

| Console | EmulatorJS Core | Notes |
|---------|-----------------|-------|
| **NES** | `nes` | 8-bit Nintendo, great homebrew scene |
| **SNES** | `snes` | 16-bit, more complex games |
| **Game Boy** | `gb` | Portable classic, massive homebrew library |
| **Game Boy Advance** | `gba` | 32-bit handheld, excellent homebrew |
| **Genesis/Mega Drive** | `segaMD` | Sega's 16-bit powerhouse |
| **Nintendo 64** | `n64` | 3D era, limited but interesting homebrew |

### Why These Six?

- **Best homebrew availability** - These systems have the most active homebrew communities
- **Performance** - All run smoothly on mobile browsers (N64 is the most demanding)
- **Familiarity** - Hank has seen these at retro game stores, knows the aesthetic
- **EmulatorJS support** - Stable, well-tested cores for all of them

---

## Controls

### Mobile (Virtual Gamepad Overlay)

EmulatorJS provides built-in virtual gamepad support. The overlay adapts to each console:

```
┌─────────────────────────────────────────┐
│                                         │
│           GAME DISPLAY                  │
│           (fullscreen)                  │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│   [D-PAD]              [A] [B]          │
│   ┌───┐              [SELECT][START]    │
│   │ ▲ │                                 │
│ ◄ │ ● │ ►                               │
│   │ ▼ │              (SNES: +X, Y, L, R)│
│   └───┘              (N64: +Analog, Z)  │
│                                         │
└─────────────────────────────────────────┘
```

**Touch targets**: 60x60px minimum (kid fingers)
**Haptic feedback**: Vibrate on button press (if supported)
**Opacity**: Semi-transparent (70%) so game is always visible

### Desktop (Keyboard)

Default keyboard mapping (can be customized):

| Key | Action |
|-----|--------|
| **Arrow Keys** | D-Pad |
| **Z** | A Button |
| **X** | B Button |
| **A** | X Button (SNES/GBA) |
| **S** | Y Button (SNES/GBA) |
| **Q** | L Shoulder |
| **W** | R Shoulder |
| **Enter** | Start |
| **Shift** | Select |
| **Space** | Quick Save State |
| **Backspace** | Quick Load State |
| **F** | Fullscreen Toggle |
| **Esc** | Exit/Pause Menu |

### N64 Special Controls

N64 has analog stick and unique layout:

| Key | Action |
|-----|--------|
| **WASD** | Analog Stick |
| **Arrow Keys** | C-Buttons |
| **Z** | A Button |
| **X** | B Button |
| **C** | Z Trigger |
| **Q/W** | L/R Shoulders |

---

## Features (Priority Order)

### MVP (Phase 1) - Get It Working

1. **Console selection screen** - 6 big tiles for each system
2. **Game browser per console** - Grid of available games with box art
3. **EmulatorJS integration** - Load and run games in an iframe
4. **Basic virtual controls** - Built-in EmulatorJS gamepad
5. **Fullscreen mode** - One-tap to go fullscreen
6. **5-10 curated homebrew games per system** - Pre-loaded, tested, fun

### Important (Phase 2) - Make It Good

1. **Save states** - Auto-save on exit, manual save/load slots
2. **Favorites system** - Star games you like, quick access list
3. **Recently played** - Last 10 games for quick resume
4. **Game descriptions** - Brief summary, controls hint per game
5. **Search/filter** - Find games by name or genre
6. **Volume control** - Slider in HUD, mute button

### Nice-to-Have (Phase 3) - Polish

1. **Custom ROM upload** - Let users add their own ROMs (stored in browser)
2. **Control remapping** - Customize keyboard bindings
3. **Rewind feature** - Go back in time (EmulatorJS supports this)
4. **Screenshot capture** - Save moments to gallery
5. **Achievement stickers** - "Beat your first NES game!" etc.
6. **Game ratings** - Users rate games, sort by rating
7. **Cheat codes** - Built-in cheat database for homebrew
8. **Multi-save slots** - 3 save slots per game

---

## Technical Approach

### EmulatorJS Integration

EmulatorJS is designed as a plugin that runs in a container element. **Critical for Next.js/React**: We must use an **iframe** approach because EmulatorJS manipulates the DOM directly and conflicts with React's virtual DOM.

#### Self-Hosted EmulatorJS Files

```javascript
// Base configuration
EJS_pathtodata = "/emulator/ejs/4.2.3/";
```

The site serves its own copy of EmulatorJS 4.2.3 from `apps/web/public/emulator/ejs/4.2.3/`. Do not load EmulatorJS from the EmulatorJS CDN. The emulator page runs in the same origin as the clip library (IndexedDB `hh-clips` and OPFS `lib/`). A script from another site in that origin can read every clip on the device.

- The files come from the official release asset `4.2.3.7z` on GitHub. `manifest.json` in the folder records the source URL, the size and the SHA-256 of each file.
- The folder holds the loader, the bundle and its CSS, the decompression helpers, the localization files, and the cores for each console in `lib/constants.ts`. Each core has a WebGL 2 build and a legacy (WebGL 1) build.
- The emulator CSP (in `public/emulator/index.html` and in `next.config.ts`) allows no other host in `connect-src`. When a core file is missing, EmulatorJS downloads the core from its CDN and runs it. The CSP blocks that download.
- The emulator page accepts only the systems of Retro Arcade and ROMs from this site (`/api/roms` or a `blob:` URL of this site).

Three tests check this: `emulator-pin.test.ts` (paths and CSP), `emulator-selfhost.test.ts` (the SHA-256 of each file and the core list) and `emulator-page.test.ts` (the page script).

To change the version:

1. Run `node scripts/vendor-emulatorjs.mjs <version>` in `apps/web`.
2. Change the two paths in `public/emulator/index.html`.
3. Change the version in the three tests.
4. Play a game on each console.

#### Iframe Approach (Required for React/Next.js)

Create a standalone HTML template that loads EmulatorJS:

```html
<!-- public/emulator/index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    #game { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="game"></div>
  <script>
    // Configuration passed via URL params
    const params = new URLSearchParams(window.location.search);

    EJS_player = "#game";
    EJS_core = params.get('core') || 'nes';
    EJS_gameUrl = params.get('rom');
    EJS_gameName = params.get('name') || 'Game';
    EJS_pathtodata = "/emulator/ejs/4.2.3/";

    // Kid-friendly defaults
    EJS_volume = 0.5;
    EJS_startOnLoaded = true;
    EJS_fullscreenOnLoaded = false;
    EJS_color = "#3B82F6"; // Blue theme

    // Save state callbacks (postMessage to parent)
    EJS_onSaveState = function(data) {
      window.parent.postMessage({ type: 'saveState', data: data }, '*');
    };

    EJS_onLoadState = function() {
      window.parent.postMessage({ type: 'loadState' }, '*');
    };

    // Notify parent when ready
    EJS_ready = function() {
      window.parent.postMessage({ type: 'ready' }, '*');
    };
  </script>
  <script src="/emulator/ejs/4.2.3/loader.js"></script>
</body>
</html>
```

#### React Component (Parent)

```tsx
// src/games/retro-arcade/components/EmulatorFrame.tsx
"use client";

import { useEffect, useRef, useCallback } from 'react';

type EmulatorFrameProps = {
  core: 'nes' | 'snes' | 'gb' | 'gba' | 'segaMD' | 'n64';
  romUrl: string;
  gameName: string;
  onSaveState?: (data: ArrayBuffer) => void;
  onReady?: () => void;
};

export function EmulatorFrame({
  core,
  romUrl,
  gameName,
  onSaveState,
  onReady
}: EmulatorFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Handle messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'saveState' && onSaveState) {
        onSaveState(event.data.data);
      }
      if (event.data.type === 'ready' && onReady) {
        onReady();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSaveState, onReady]);

  const iframeSrc = `/emulator/index.html?core=${core}&rom=${encodeURIComponent(romUrl)}&name=${encodeURIComponent(gameName)}`;

  return (
    <iframe
      ref={iframeRef}
      src={iframeSrc}
      className="w-full h-full border-0"
      allow="autoplay; fullscreen; gamepad"
      allowFullScreen
    />
  );
}
```

### Core Mapping

| System | `EJS_core` Value | File Extensions |
|--------|------------------|-----------------|
| NES | `nes` | .nes, .zip |
| SNES | `snes` | .smc, .sfc, .zip |
| Game Boy | `gb` | .gb, .gbc, .zip |
| GBA | `gba` | .gba, .zip |
| Genesis | `segaMD` | .md, .gen, .bin, .zip |
| N64 | `n64` | .n64, .z64, .v64, .zip |

### ROM Storage & Hosting

#### Pre-loaded Homebrew (Public Folder)

Store curated homebrew ROMs in the public folder:

```
public/
└── roms/
    ├── nes/
    │   ├── alter-ego.nes
    │   ├── blade-buster.nes
    │   └── ...
    ├── snes/
    │   └── ...
    ├── gb/
    │   └── ...
    ├── gba/
    │   └── ...
    ├── genesis/
    │   └── ...
    └── n64/
        └── ...
```

#### Custom ROM Upload (Phase 3)

For user-uploaded ROMs, use IndexedDB (client-side only):

```typescript
// Store ROM in IndexedDB
async function storeCustomRom(file: File, system: string) {
  const buffer = await file.arrayBuffer();
  const db = await openDB('retro-arcade-roms', 1, {
    upgrade(db) {
      db.createObjectStore('roms');
    },
  });

  const key = `${system}/${file.name}`;
  await db.put('roms', buffer, key);
  return key;
}

// Create blob URL for emulator
async function getRomUrl(key: string) {
  const db = await openDB('retro-arcade-roms', 1);
  const buffer = await db.get('roms', key);
  const blob = new Blob([buffer]);
  return URL.createObjectURL(blob);
}
```

### Save State Management

> This section replaces the first plan (base64 save states in the cloud
> progress). That plan lost every save: the old message code turned the
> EmulatorJS save object into an empty string.

Save states stay on the device. They never go to localStorage and never go to
the cloud progress. A Game Boy state is about 200 KB and a Nintendo 64 state
is about 16 MB. The cloud progress limit is 1 MB, and each upload costs the
server money.

- **Store**: IndexedDB database `hh-retro-arcade-saves`, object store
  `states`, key `[owner, gameId, slot]`
  (`src/games/retro-arcade/lib/saveStates.ts`). Each record holds a binary
  Blob. When WebKit cannot store the Blob ("Error preparing Blob/File data"),
  the store tries once more with an ArrayBuffer.
- **Owner**: "guest", or "u_" + the first 20 hex characters of
  SHA-256("hh-retro-states:v1:" + user id) (`lib/ownerKey.ts`). Every read
  names the owner, so one account on a shared iPad never loads the save of
  another account.
- **Slots**: each game keeps two slots. "manual" is the Save State button of
  EmulatorJS. "auto" is the moment the kid left the game (Back to Games, or
  the page went to the background). A new save replaces the old one in the
  same slot.
- **Load**: the Load State button loads the "manual" slot. When a game
  starts, the "auto" slot loads, so the kid continues where they stopped. The
  restart button in the top bar starts the game again without the "auto"
  slot.
- **Messages**: the emulator page sends the bytes as an ArrayBuffer in the
  postMessage transfer list (no copy, no base64). `lib/emulatorMessages.ts`
  lists each message.
- **Failures**: a quota or write failure shows "Your save did not fit. Try
  deleting an old game save." The message stays until the kid taps OK, and
  it has a read-aloud button. "Your Game Saves" on the console screen lists
  each save with its size and a Delete button.
- **Battery saves**: the in-game save of a cartridge (SRAM) is a different
  thing. EmulatorJS keeps it in its own IndexedDB, and this design does not
  change it.
- **Old data**: localStorage data of version 0 and old cloud progress can
  hold a `saveStates` field. The store migration and `setProgress` drop it.
  The server schema drops it from a save before validation, so old clients
  can still save.

---

## Legal ROM Sources

**IMPORTANT**: We only pre-load **homebrew games** - games created by independent developers and released for free. No commercial ROMs, no piracy.

### Homebrew Sources

#### 1. Homebrew Hub (Primary Source)
**URL**: https://hh.gbdev.io/

- Massive collection of Game Boy and GBA homebrew
- Well-organized with screenshots and descriptions
- Active community, regularly updated
- Games are specifically made to be shared

#### 2. Archive.org RetroPie Homebrew Collection
**URL**: https://archive.org/details/retro-pie-homebrew-collection

- Pre-curated collection across multiple systems
- Public Domain marked
- Systems: NES, SNES, GB, GBA, Genesis, and more
- Single download with organized folders

#### 3. PDRoms
**URL**: https://pdroms.de/

- News site and repository for homebrew
- Covers NES, Game Boy, GBA, SNES, Genesis, N64, and more
- Game reviews and ratings help with curation
- Active since the early 2000s, trusted source

### Initial Curated Game List

**Phase 1 Target**: 5-10 games per system that are genuinely fun

#### NES Homebrew (Targets)
| Game | Genre | Notes |
|------|-------|-------|
| Alter Ego | Puzzle/Platformer | Mind-bending dual character control |
| Blade Buster | Shooter | Polished vertical scrolling shmup |
| From Below | Puzzle | Tetris-like with twists |
| Super Tilt Bro | Fighting | Smash Bros-inspired |
| Micro Mages | Platformer | 4-player co-op, commercial quality |

#### Game Boy Homebrew (Targets)
| Game | Genre | Notes |
|------|-------|-------|
| Deadeus | Horror/Adventure | Atmospheric, great story |
| Tobu Tobu Girl | Platformer | Addictive endless jumper |
| Dangan | Racing | WipEout-style on GB! |
| Retroid | Shooter | Asteroids clone, well made |
| uCity | Simulation | SimCity for Game Boy |

#### GBA Homebrew (Targets)
| Game | Genre | Notes |
|------|-------|-------|
| Goodboy Galaxy | Platformer | Looks like commercial title |
| Inheritors of the Obelisk | RPG | Full JRPG experience |
| Tigermoth | Shooter | Beautiful bullet hell |
| Anguna | Adventure | Zelda-like dungeon crawler |
| Another World | Port | Classic game, legal port |

*Similar lists needed for SNES, Genesis, and N64*

### ROM Licensing Note

Every ROM we include must be verified as:
1. **Created by an independent developer** (not Nintendo, Sega, etc.)
2. **Released for free distribution** (check license/readme)
3. **Not a hack/mod of commercial games** (original creations only)

---

## Kid-Friendly Design

### Console Selection Screen

Big, colorful tiles with console images:

```
┌────────────────────────────────────────────────────┐
│            🎮 RETRO ARCADE 🎮                      │
│        Pick a console to play!                     │
├────────────────────────────────────────────────────┤
│                                                    │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │   NES    │  │   SNES   │  │ GAME BOY │       │
│   │   🎮     │  │   🎮     │  │    📱    │       │
│   │  8 Games │  │  6 Games │  │ 10 Games │       │
│   └──────────┘  └──────────┘  └──────────┘       │
│                                                    │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │   GBA    │  │ GENESIS  │  │   N64    │       │
│   │   📱     │  │   🎮     │  │   🎮     │       │
│   │  8 Games │  │  5 Games │  │  4 Games │       │
│   └──────────┘  └──────────┘  └──────────┘       │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Game Grid

Each game card shows:
- Game thumbnail/box art (if available)
- Game title (large text)
- Genre tag (platformer, puzzle, etc.)
- "Play" button (big, obvious)
- Star icon for favorites

```
┌─────────────────────────────────────┐
│ ◀ Back to Consoles      NES Games  │
├─────────────────────────────────────┤
│ ┌─────────┐  ┌─────────┐  ┌───────┐│
│ │ [image] │  │ [image] │  │[image]││
│ │ ALTER   │  │ BLADE   │  │ FROM  ││
│ │ EGO     │  │ BUSTER  │  │ BELOW ││
│ │ Puzzle  │  │ Shooter │  │Puzzle ││
│ │ [PLAY]  │  │ [PLAY]  │  │[PLAY] ││
│ │ ☆       │  │ ★       │  │ ☆     ││
│ └─────────┘  └─────────┘  └───────┘│
│                                     │
│ [+ Add Your Own ROM]               │
└─────────────────────────────────────┘
```

### In-Game UI

Minimal overlay - let the game shine:

```
┌─────────────────────────────────────┐
│ [Exit] [Save] [Load]   Alter Ego   │
├─────────────────────────────────────┤
│                                     │
│                                     │
│           GAME DISPLAY              │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ [D-PAD]              [B] [A]       │
│                   [SELECT][START]   │
└─────────────────────────────────────┘
```

### Design Principles

1. **Big touch targets** - 60x60px minimum for all buttons
2. **High contrast** - Text readable on any background
3. **Simple labels** - "Play", "Save", "Exit" - not "Execute ROM"
4. **Visual console branding** - Each system has distinct color:
   - NES: Red
   - SNES: Purple
   - Game Boy: Green
   - GBA: Blue
   - Genesis: Black/Gold
   - N64: Rainbow gradient
5. **No scary settings** - Hide advanced options, sensible defaults
6. **Instant feedback** - Loading spinner, "Game starting..." text

### Content Rules (Catalog Blocklist)

Do not put a game with blood, gore, or sexual content in a catalog (Guardrail 1, issue #25).

- The rules are in `apps/web/src/games/retro-arcade/lib/content-blocklist.json`. Each rule has a pattern, a reason, and a source (an ESRB rating or a description of the game).
- The test `__tests__/catalog-content.test.ts` finds each `lib/*catalog*` file. The test fails when a catalog entry matches a rule. A catalog for a new console gets this check with no test change. The test also fails when a catalog file has no catalog array, or when an entry has no string `id`, `displayName` and `filename`. Thus a catalog with a different entry shape cannot pass with no check.
- The ROM proxy (`src/app/api/roms/[...path]/route.ts`) reads the same rules. It returns 404 for a blocked ROM file name before it fetches from the bucket. Thus a title that is removed from a catalog cannot be played from its old URL.
- The catalog generators (`scripts/upload_snes_roms.py`, `scripts/upload_atari_roms.py`) read the same rules through `scripts/retro_blocklist.py`. They do not upload or list a blocked ROM. They do not delete a ROM that is already in the bucket.
- When you remove a title, also delete its ROM object from the bucket. This is a production write, so get approval first. Cloudflare keeps `.bin` ROMs in its cache (`cf-cache-status: HIT`) for up to one year, so also purge each old `/api/roms/...` URL from the Cloudflare cache.
- A rule reads the display name, the ROM file name, and the id. Old ROM dumps often have short names (for example `custerev.bin`), so the display name alone is not sufficient.
- To identify an unclear Atari 2600 ROM, compare its MD5 with the Stella ROM database (`src/emucore/DefProps.hxx` in the Stella source). Examine each ROM in the catalog, not only the ROMs with unclear names. Block every ROM from these adult publishers:
  - Mystique (American Multiple Industries)
  - PlayAround (J.H.M.)
  - Multivision (Harem)
  - Universal Gamex (X-Man)
- Also block the re-releases and hacks of these adult games. Examples are the Dynacom "Beat 'Em & Eat 'Em" and the "Custer's Viagra" hacks.
- To add a rule, add the pattern, the reason, the source, and examples to the JSON file. Then run `python3 scripts/retro_blocklist.py` and the catalog test.

---

## File Structure

Following the compartmentalized structure from CLAUDE.md:

```
apps/web/src/
├── app/
│   └── games/
│       └── retro-arcade/
│           ├── page.tsx           # Console selection
│           └── [system]/
│               ├── page.tsx       # Game grid for system
│               └── [gameId]/
│                   └── page.tsx   # Emulator view
│
├── games/
│   └── retro-arcade/
│       ├── components/
│       │   ├── ConsoleGrid.tsx    # 6 console tiles
│       │   ├── ConsoleCard.tsx    # Single console tile
│       │   ├── GameGrid.tsx       # Game cards grid
│       │   ├── GameCard.tsx       # Single game card
│       │   ├── EmulatorFrame.tsx  # iframe wrapper
│       │   ├── EmulatorControls.tsx # Exit, save, load buttons
│       │   └── VirtualGamepad.tsx # Optional custom gamepad
│       │
│       ├── hooks/
│       │   ├── useGameLibrary.ts  # Fetch/manage game list
│       │   ├── useSaveStates.ts   # Save/load state management
│       │   ├── useFavorites.ts    # Starred games
│       │   └── useRecentlyPlayed.ts # Play history
│       │
│       ├── lib/
│       │   ├── store.ts           # Zustand store
│       │   ├── games.ts           # Game catalog data
│       │   ├── systems.ts         # System definitions
│       │   └── constants.ts       # Core mappings, colors
│       │
│       └── index.ts               # Exports
│
└── public/
    ├── emulator/
    │   └── index.html             # EmulatorJS host page
    │
    └── roms/
        ├── nes/                   # NES homebrew ROMs
        ├── snes/                  # SNES homebrew ROMs
        ├── gb/                    # Game Boy homebrew ROMs
        ├── gba/                   # GBA homebrew ROMs
        ├── genesis/               # Genesis homebrew ROMs
        └── n64/                   # N64 homebrew ROMs
```

---

## User Data & Persistence

### App ID

```typescript
appId: "retro-arcade"
```

**IMPORTANT**: Add `"retro-arcade"` to `VALID_APP_IDS` in `packages/db/src/schema/app-progress.ts`:

```typescript
export const VALID_APP_IDS = [
  "hill-climb",
  "monster-truck",
  "weather",
  "retro-arcade",  // ADD THIS
] as const;
```

### Progress Data Structure

```typescript
interface RetroArcadeProgress {
  // Favorites
  favorites: string[];  // Array of gameIds: ["nes/alter-ego", "gb/tobu-tobu-girl"]

  // Recently played (last 20)
  recentlyPlayed: {
    gameId: string;
    system: string;
    lastPlayed: number;  // timestamp
  }[];

  // Save states are NOT progress. They stay on this device in IndexedDB
  // (see "Save State Management"). Old data can hold a saveStates field;
  // the store and the server schema drop it.

  // Custom ROMs (metadata only - actual ROMs in IndexedDB)
  customRoms: {
    id: string;
    system: string;
    name: string;
    addedAt: number;
  }[];

  // Play statistics
  stats: {
    totalPlayTime: number;       // seconds
    gamesPlayed: number;
    favoriteSystem: string;
    lastPlayedAt: number;
  };

  // Settings
  settings: {
    volume: number;              // 0-1
    autoSaveOnExit: boolean;
    showTouchControls: boolean;  // Force on mobile
    keyboardMapping?: object;    // Custom keybinds
  };
}
```

### localStorage Key

```typescript
const STORAGE_KEY = "retro-arcade-progress";
```

### Zustand Store

```typescript
// src/games/retro-arcade/lib/store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RetroArcadeState {
  favorites: string[];
  recentlyPlayed: { gameId: string; system: string; lastPlayed: number }[];
  customRoms: { id: string; system: string; name: string; addedAt: number }[];
  stats: { totalPlayTime: number; gamesPlayed: number; favoriteSystem: string; lastPlayedAt: number };
  settings: { volume: number; autoSaveOnExit: boolean; showTouchControls: boolean };

  // Actions
  addFavorite: (gameId: string) => void;
  removeFavorite: (gameId: string) => void;
  addRecentlyPlayed: (gameId: string, system: string) => void;
  updatePlayTime: (seconds: number) => void;
  updateSettings: (settings: Partial<RetroArcadeState['settings']>) => void;
}

export const useRetroArcadeStore = create<RetroArcadeState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recentlyPlayed: [],
      customRoms: [],
      stats: { totalPlayTime: 0, gamesPlayed: 0, favoriteSystem: '', lastPlayedAt: 0 },
      settings: { volume: 0.5, autoSaveOnExit: true, showTouchControls: true },

      addFavorite: (gameId) => set((state) => ({
        favorites: [...state.favorites, gameId]
      })),

      removeFavorite: (gameId) => set((state) => ({
        favorites: state.favorites.filter(id => id !== gameId)
      })),

      addRecentlyPlayed: (gameId, system) => set((state) => {
        const filtered = state.recentlyPlayed.filter(g => g.gameId !== gameId);
        return {
          recentlyPlayed: [{ gameId, system, lastPlayed: Date.now() }, ...filtered].slice(0, 20),
          stats: {
            ...state.stats,
            gamesPlayed: state.stats.gamesPlayed + 1,
            lastPlayedAt: Date.now()
          }
        };
      }),

      updatePlayTime: (seconds) => set((state) => ({
        stats: {
          ...state.stats,
          totalPlayTime: state.stats.totalPlayTime + seconds
        }
      })),

      updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      }))
    }),
    {
      name: 'retro-arcade-progress'
    }
  )
);
```

### useAuthSync Integration

```typescript
// src/games/retro-arcade/hooks/useRetroArcadeSync.ts
import { useAuthSync } from '@/shared/hooks';
import { useRetroArcadeStore } from '../lib/store';

export function useRetroArcadeSync() {
  const store = useRetroArcadeStore();

  return useAuthSync({
    appId: 'retro-arcade',
    localStorageKey: 'retro-arcade-progress',
    getState: () => ({
      favorites: store.favorites,
      recentlyPlayed: store.recentlyPlayed,
      customRoms: store.customRoms,
      stats: store.stats,
      settings: store.settings,
    }),
    setState: (data) => {
      // Hydrate store from server data
      useRetroArcadeStore.setState(data);
    },
    debounceMs: 3000,
  });
}
```

---

## Implementation Phases

### Phase 1: MVP (Get It Working)

- [ ] Create file structure under `src/games/retro-arcade/`
- [ ] Add `"retro-arcade"` to `VALID_APP_IDS`
- [ ] Create emulator host HTML in `public/emulator/index.html`
- [ ] Build `ConsoleGrid` and `ConsoleCard` components
- [ ] Build `GameGrid` and `GameCard` components
- [ ] Build `EmulatorFrame` component with postMessage communication
- [ ] Create game catalog data file with 5 games per system
- [ ] Download and add homebrew ROMs to `public/roms/`
- [ ] Set up routing: `/games/retro-arcade/[system]/[gameId]`
- [ ] Basic Zustand store for favorites and recent games

**Deliverable**: Can browse consoles, see games, launch and play them

### Phase 2: Persistence (Make Progress Stick)

- [ ] Implement save state capture via postMessage
- [ ] Save states in IndexedDB, on this device only (never in cloud progress)
- [ ] Save/Load UI buttons in emulator view
- [ ] Auto-save on exit feature
- [ ] `useAuthSync` integration for cloud sync
- [ ] Favorites system (add/remove, filter view)
- [ ] Recently played tracking

**Deliverable**: Progress persists, syncs to account

### Phase 3: Polish (Make It Great)

- [ ] Custom ROM upload (IndexedDB storage)
- [ ] Game descriptions and control hints
- [ ] Search and filter in game grid
- [ ] Volume control slider
- [ ] Fullscreen toggle button
- [ ] Loading states and error handling
- [ ] Mobile-specific touch control improvements
- [ ] Game thumbnails/box art for all games

**Deliverable**: Polished, feature-complete experience

### Phase 4: Extras (If Time Permits)

- [ ] Rewind feature integration
- [ ] Screenshot capture to gallery
- [ ] Achievement stickers
- [ ] Control remapping UI
- [ ] Game ratings and sorting
- [ ] Multi-save slots UI
- [ ] Cheat code database

---

## Success Metrics

1. **Hank can pick a console and play a game** in under 30 seconds
2. **Save states work** - Hank can quit and come back to the same spot
3. **Mobile works** - Touch controls are usable on phone
4. **No crashes** - EmulatorJS runs stable across all 6 systems
5. **Hank discovers homebrew gems** - "This game is actually cool!"
6. **Legal compliance** - All ROMs are verifiably homebrew

---

## References

- [EmulatorJS GitHub](https://github.com/EmulatorJS/EmulatorJS) - Source and documentation
- [EmulatorJS 4.2.3 release](https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.2.3) - The source of the self-hosted files
- [EmulatorJS Docs](https://emulatorjs.org/docs/) - Configuration options
- [Homebrew Hub](https://hh.gbdev.io/) - Game Boy homebrew collection
- [PDRoms](https://pdroms.de/) - Multi-system homebrew news and files
- [Archive.org RetroPie Homebrew](https://archive.org/details/retro-pie-homebrew-collection) - Curated collection
- [NESdev Homebrew](https://www.nesdev.org/) - NES development community
