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
