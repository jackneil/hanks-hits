# Four-Wheeler Adventure 3D Design Document

## Overview
Four-Wheeler Adventure 3D is a full 3D rewrite of Hank's 2D open-world sandbox
(`apps/web/public/games/four-wheeler-adventure/index.html`). The player rides an ATV
inside the world: a chase camera sits behind the seat, hills rise in front of you,
trees are taller than you, and the horizon is real. Every feature of the 2D game
comes along: driving, hopping off to walk with your dog, buying vehicles, racing a
rival, hunting, fishing and boats, planes, the train, the rocket and planets, home
life and the farm, and My Land. The 2D original stays in the catalog untouched.

The fun is the feeling of being there. A 2D map shows you the world. A 3D chase
camera puts you in it. Kids who play GTA-style games expect to climb a hill and see
the lake below. This game gives them that with the same cartoony, forgiving rules
Hank already loves.

Behavior spec: `design/games/four-wheeler-3d-behavior-spec.md` holds one row per
feature of the 2D game, with the source function and line, the expected observable
behavior, the 3D milestone that ports it, and its verification status.

## Core Loop
Ride. See something. Go to it. Use it. Earn money. Buy the next thing. Repeat.

1. Ride the ATV across real terrain. Jump ruts, climb hills, slide on snow.
2. Spot a glowing thing (a store, a stand, a dock, a boat, a friend). Drive up to it.
3. Press the one big prompt button. A panel opens or you enter a mode.
4. Do the activity (race, hunt, fish, fly, build). Earn money or a trophy.
5. Spend at a dealer or on your land. Show it off in your garage and trophy room.

## Progression System
- **Money** from races, fish, hunting trophies, milking, phone games, and helper tasks.
- **Vehicles** in price tiers: ATV (owned) up to the Lambo, the jet, and the yacht.
- **Land** in six plots, each with two build slots and upgrade tiers, up to a huge
  house with three bedrooms and a bonus room.
- **Trophies**: skulls on the trophy wall, biggest fish, best race time, air points.
- **Time**: a 24-minute day. Night brings bats and headlights. Weather rolls each day.

## Engagement Hooks
- **Being there** (presence): third-person chase camera with lag, FOV that widens
  with speed, camera shake on landings. Presence is the single biggest lever a 3D
  camera adds over a map view.
- **Numbers go up**: money, trophies, fish counts, best times. Leaderboard on best
  race time. Profile page shows money and trophies.
- **Discovery**: the world has landmarks at the same proportional places as the 2D
  game, so Hank can find them, and the radar minimap and GPS waypoint show the way.
- **Forgiving**: a flipped ATV rights itself in 1.5 seconds. Wolves knock you out and
  you wake at home. Off-track in a race gives strikes, not a loss. Hunger costs only
  carried cash, never vehicles or land.
- **Ownership**: buy land, build a house, park in your own garage.
- **Companions**: the dog follows, sits, barks, and retrieves. The helper buddy does
  chores from the phone.

## Features (Priority Order)
Each number is a milestone. Each milestone is verified before the next starts.

1. Design doc and behavior-spec workbook (this file and the spec beside it).
2. Scaffold and registration: metadata, store, schema, extractors, route, tests.
3. World foundation: terrain, roads, lake, trees, sky, sun, day and night, weather,
   chunk streaming.
4. The ATV: raycast vehicle, chase camera, keyboard, touch, tilt, dust, tracks,
   engine sound, speedometer.
5. On foot, the dog, the interaction system, the HUD, the minimap, the phone apps.
6. Economy, dealerships, garage, the full vehicle roster, towing, mud, car wash.
7. Racing with the rival, checkpoints, NOS, strikes, best time.
8. Hunting: animals with flee AI, stands, feeders, scent, calls, camo, aim mode,
   the dog retrieves, trophies, wolves.
9. The lake: water, buoyancy, boats, fishing, nets, the yacht.
10. Air, rail, space: planes, the train, the rocket and planets.
11. Home life, farm, fun stuff, the helper buddy, the snow wonderland.
12. My Land: plots, build shack, houses, upgrade land.
13. Persistence, read-aloud copy, restart cleanup.
14. Docs.
15. Recursive 10/10 hardening with three kid personas.

Features the behavior spec found that the milestone list above does not name by
itself. Each one belongs to the milestone shown and ships with it:
- Bike shop with 8 bikes and its own speed formula (milestone 6).
- Customizing garage: 12 paint colors and buy or sell top speed at $1 per mph
  (milestone 6).
- Mud that slows you and splatters the vehicle and the trailer; the car wash, the
  nozzle, and the fire truck hose all clean it (milestone 6).
- Smash-through: above a speed threshold you break trees and rocks instead of
  bouncing off them (milestone 4 for the rule, milestone 3 for breakable props).
- Sky track: a driveable elevated loop reached with the In Air toggle (milestone 10).
- Dressing room: shirt colors and words drawn on the rider (milestone 11).
- Vehicle preview cards in every store: a render-to-texture thumbnail of the real
  model (milestone 6).
- Trampoline, seesaw, and the auto-placed yard props (milestone 11).
- Race strikes: the 2D game counts off-track strikes but never enforces a wreck-out.
  The 3D game keeps the count visible and respawns you at the last checkpoint after
  three, with no loss of the race, so the rule is forgiving and legible.

## Technical Approach

### Stack
- `three@0.182`, `@react-three/fiber@9.6.1`, `@react-three/drei@10.7.7`,
  `@react-three/rapier@2.2.0` (pins `@dimforge/rapier3d-compat@0.19.2`, which ships
  `DynamicRayCastVehicleController`).
- No new packages or external runtime media. Locally vendored CC0 assets are allowed
  for the September graphics pass; see `four-wheeler-graphics.html`. Models use
  detailed batched geometry and the ground uses local scanned textures. All sounds are procedural WebAudio (the monster-truck `SoundManager`
  pattern).

### Module layout
All code lives in `apps/web/src/games/four-wheeler-3d/`.

```
four-wheeler-3d/
  Game.tsx                 "use client"; Canvas, overlay, HUD, panels, useAuthSync
  GameShell.tsx            wraps <GameShell> with restart (remount) like monster-truck
  index.ts                 exports default, store, Progress type
  metadata.ts              home page discovery, madeByKid: true
  components/
    World.tsx              Sky, sun, fog, ChunkStreamer, water, props
    ChunkStreamer.tsx      loads 128 m chunks around the player, disposes far ones
    TerrainChunk.tsx       one chunk: mesh + fixed heightfield collider
    Water.tsx              lake plane with animated shader
    Props.tsx              instanced trees, rocks, grass, fences (LOD)
    Vehicle.tsx            raycast vehicle body + procedural model by type
    models/*.tsx           one procedural model per vehicle, animal, building
    ChaseCamera.tsx        spring follow camera, helmet cam, spherecast clearance
    Player.tsx             on-foot kinematic character
    Dog.tsx                companion state machine
    Animals.tsx            instanced flocks driven by lib/animals
    Buildings.tsx          hub, dealers, stores, garage, house, plots
    Race.tsx               track, rival, checkpoints, item boxes
    Boats.tsx, Aircraft.tsx, Train.tsx, Space.tsx
    Effects.tsx            dust, tire tracks, confetti, poof
    hud/                   Hud.tsx, Speedo.tsx, Minimap.tsx, Phone.tsx, panels
    MobileControls.tsx     pedals, steer arrows, JUMP, HORN, prompt button
  hooks/
    useControls.ts         keyboard + touch + tilt -> ControlValues
    useTimeOfDay.ts        the 24 minute clock and weather roll
  lib/
    constants.ts           WORLD, SCALE, prices, timers, palette
    terrain.ts             heightAt(x, z), roads, lake basin, chunk sampling
    dayNight.ts            sun position, light color, fog by hour, weather roll
    vehicles.ts            tuning table derived from the 2D SPEEDS table
    camera.ts              spring math, FOV by speed
    controls.ts            pure reducer: inputs -> ControlValues
    interactables.ts       registry + nearest-within-radius resolver
    economy.ts             buy, sell, paint, money guards
    race.ts                progress, checkpoints, strikes, lap timing
    rival.ts               centerline follower with lookahead and rubber band
    animals.ts             state machine, detection thresholds, corn decay
    fishing.ts             cast power, bite probability, fish types, payouts
    buoyancy.ts            float forces for boats
    flight.ts              lift, stall, stunts
    train.ts               loop routing to a station
    space.ts               planet gravity, meteor timing
    home.ts                hunger, sleep, the loss rule
    land.ts                plots, slots, prices, upgrade, room counts
    towing.ts              hitch joint math, mower cells, plow load
    phone.ts               dice, spin, coin, calculator, GPS landmarks
    sounds.ts              procedural engine, horn, thud, jingles, fanfare
    store.ts               Zustand persist store + Progress type
  __tests__/               one test file per lib module + Game/store/no-external-media
```

Registration outside the module (the only shared files touched):
`packages/db/src/schema/app-progress.ts` (`VALID_APP_IDS`),
`apps/web/src/lib/progress-schemas.ts`, `apps/web/src/shared/lib/gameStatExtractor.ts`,
`apps/web/src/lib/leaderboard-extractors.ts`, the route
`apps/web/src/app/games/four-wheeler-3d/page.tsx`, and `design/ARCHITECTURE.md`.

### Units and the scale factor
Units are meters and seconds. The 2D world is 72,000 x 72,000 units. The 3D world is
4,000 x 4,000 m. Positions convert by `SCALE.POS = 4000 / 72000 = 1/18`. Every
landmark keeps its proportional place: lake at the center, treestands to the east,
six plots on spokes about 780 m out (2D: 14,000 units), the hub between them.

Ground speeds do not convert by the position factor. The 2D game runs in units per
frame with joke labels (the tractor's 7.14 is labeled "exactly 100 mph"). A literal
conversion makes the ATV 190 m/s, which is unplayable in third person. Instead
`SCALE.SPEED = 0.38` converts the 2D `max` (units per frame) to meters per second,
which keeps the ORDER and the RATIOS of the whole roster: ATV 21.9 m/s (about 49 mph),
UTV 24.6, truck 19.6, race car 42.6, muscle 34.2, moto 28.5, Lambo 35.3, semi 17.1,
fire truck 17.5, monster 21.3, RV 19.0, tractor 2.7. Accel and brake use the same
factor per second. On foot is fixed at 3 m/s walk and 5 m/s run (the 2D ratio would
be a 1 m/s crawl in 3D). Aircraft and boats have their own rows in the same table
and keep the 2D ordering (canoe slowest, jet fastest). The derivation lives in
`lib/constants.ts` next to the numbers.

### Physics
- World: `<Physics>` from `@react-three/rapier`, gravity -9.81, fixed timestep.
- Terrain: one `RigidBody type="fixed"` per loaded chunk with a `HeightfieldCollider`
  sampled from `heightAt`. Visual mesh vertices sample the same function, so physics
  and visuals never disagree.
- Ground vehicles: `DynamicRayCastVehicleController` from `@dimforge/rapier3d-compat`
  created from `useRapier().world` with the chassis rigid body. Four wheels, suspension
  rest length, stiffness, and damping per vehicle in `lib/vehicles.ts`. Engine force
  and brake from the tuning row. Steering angle on the front wheels. A jump input
  applies an upward impulse when all wheels touch. Upside down for 1.5 s: reset the
  rotation with a hint.
- Boats: dynamic body with `lib/buoyancy.ts` forces at four float points against the
  water plane height.
- Aircraft: dynamic body with `lib/flight.ts` lift and drag, pitch and roll from input.
- On foot: Rapier `KinematicCharacterController` with a capsule.
- Animals: no rigid bodies. They walk on `heightAt` and are drawn as instances.
- Train: kinematic along a spline.

### Chunk streaming
The world is a 32 x 32 grid of 128 m chunks (4,096 m). The streamer keeps the chunks
within a radius of 3 (a 7 x 7 window, 49 chunks) loaded around the player and
disposes the rest. Each chunk builds its geometry and heightfield from `heightAt` in
a `useMemo` keyed on the chunk coordinates. Props (trees, rocks, grass) are placed by
a seeded hash of the chunk coordinates so the same chunk always looks the same.
Instanced meshes per prop kind per chunk, with a smaller leaf-mesh LOD per species beyond 200 m. The graphics pass adds individual leaves, a local scanned ground material, detailed ATV geometry, and an outdoor light probe.
The dev HUD shows the loaded chunk count so the bound is visible.

### Camera
`lib/camera.ts` is a critically damped spring on the camera position toward a target
2.2 m up and 5 m behind the seat along the vehicle's heading. FOV lerps from 60 to 75
between 0 and max speed. A spherecast from the seat toward the desired position stops
early on terrain so the camera never sits under a hill. Landing impulse adds a short
shake. Helmet cam sets the camera at the rider's head with no spring.

### Interaction system
`lib/interactables.ts` keeps a registry of `{ id, position, radius, label, kind }`.
Every frame the resolver returns the nearest entry whose distance is under its
radius, or null. The HUD shows one big prompt button for that entry and the model
pulses an emissive glow. This is the 2D `nearestInteractable()` idea with one code
path for vehicles, stores, stands, docks, boats, houses, plots, and the train.

### Store shape
`lib/store.ts` uses Zustand `persist` under the name `"four-wheeler-3d-game-state"`.

```ts
export type FourWheeler3dProgress = {
  [key: string]: unknown;
  money: number;
  totalEarned: number;
  ownedVehicles: string[];        // vehicle ids
  currentVehicle: string;
  paint: string;                  // hex color
  trophies: number;               // skulls on the wall
  fishCaught: Record<string, number>;   // little, middle, big, huge, rainbow
  biggestFish: string;
  bestRaceTimeMs: number;         // 0 = none
  racesWon: number;
  airPoints: number;
  land: Record<string, { size: number; slots: string[] }>;  // plot id -> built
  hunger: number;                 // 0..100
  day: number;
  timeOfDay: number;              // 0..24
  weather: string;
  settings: { soundEnabled: boolean; tiltEnabled: boolean; helmetCam: boolean };
  lastModified: number;
};
```

Transient session state (race in progress, current mode, position) lives in the
store but is not persisted (`partialize`). The Zod schema in `progress-schemas.ts`
is `.strict()` with `MAX_CURRENCY` on money, `MAX_COUNT` on counts, `boundedString`
on ids, and `boundedRecord` on the dynamic maps.

### Controls
`hooks/useControls.ts` follows the monster-truck hook: keyboard state, touch state,
and `useDeviceOrientation` tilt with the iOS permission prompt, combined into one
`getControlValues()` used inside `useFrame`. `lib/controls.ts` is the pure reducer so
tests can prove touch and keyboard produce the same `ControlValues`. Keys: WASD and
arrows, space jump, H horn, R reset, C camera, E interact, Escape pause.

### Performance budget
60 fps desktop. Under 33 ms average frame on a 4x CPU throttled Chrome trace (the
phone proxy). Rules: no allocations inside `useFrame` (scratch vectors), instanced
props, shadow map only within 60 m of the player, far fog hides chunk edges, at most
49 chunks loaded, animals updated in a strided loop (a quarter of the flock per frame).

### Testing
Pure logic in `lib/*.ts` with Vitest. R3F components render with the canvas mocked as
in `apps/web/src/games/monster-truck/__tests__/Game.test.tsx`. A
`no-external-media.test.ts` proves no `<img>`, `<audio>`, `fetch`, or external URL
appears in the module. Browser walks per milestone with Playwright MCP on a
390 x 844 touch viewport and a desktop viewport.

## Child-Friendly Design
- Cartoony low-poly everything. No blood, no gore. Tagged animals poof and flop.
  The blaster is a bright toy. Wolves knock you out; you wake at home.
- Big controls: pedals 56 px, every other target at least 44 px. Touch, tilt, and
  keyboard all work. Nothing hover-gated.
- One prompt button at a time. Short emoji hints at a 1st to 3rd grade reading level.
  The start overlay reads itself aloud.
- Forgiving: auto-recover flips, respawn at checkpoints, no permanent loss of
  vehicles or land.
- Celebrations: confetti and a fanfare on race wins, a rainbow burst on the rainbow
  fish, a skull pop on a trophy.
- Safe: no links out, no accounts, no money, nothing about the kid stored in the game.
