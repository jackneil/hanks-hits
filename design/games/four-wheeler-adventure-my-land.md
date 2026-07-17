# My Land — Design Document

## Overview
Hank asked for a huge feature: land plots around the map, roads connecting them,
a tiny "Build" shack on each plot that lets you construct a garage / trophy room /
house (in several sizes, up to a huge one with 3+ bedrooms), the ability to add on
to your land, and — eventually — inviting a specific friend by name to visit your
base, with a shared "community" garage/dealership/trophy room everyone uses, 2-seat
cars, and a rule that community cars can't sit at your house more than 1 game hour.

That's really three separate projects stacked together. This doc scopes **Project 1
only: "My Land"** — land plots, roads, the Build shack, and buildable
garage/trophy-room/house structures, single-player, saved locally on this browser.

**Explicitly deferred** (their own future projects, not started here):
- **Real multiplayer** — players choosing a name, a "Share Land" phone button,
  inviting a specific friend to enter your base. The game currently has **zero**
  persistence or network calls of any kind (confirmed: no `fetch`/`localStorage`
  anywhere in the file) and no concept of other players existing at all. This needs
  new server-side plumbing (a real land-ownership table, a friends/share-permission
  list, and some way for two browsers to see the same world) before it can work even
  a little. Reusable building blocks already exist in the wider site (real user
  accounts via next-auth, and a public "handle" system via the leaderboard feature)
  but the connective tissue is 100% new work.
- **2-seat cars** — only matters once there's a second real person (a friend) who
  could sit in the passenger seat. Cosmetic without multiplayer, so deferred
  alongside it.
- **The 1-game-hour community car rule** — depends on a real personal-vs-community
  car distinction, which becomes meaningful once real multiplayer land ownership
  exists. Revisit alongside the multiplayer project.

## Core Loop
Walk/drive out from the community hub along a new dirt road to an open plot of
land. A small "🔨 Build" shack glows (reusing the existing "hop in" glow/bubble
system) — walk up and open it to spend money building a Garage, a Trophy Room, or
a House (Small / Medium / Huge). Once built, that structure replaces the shack. A
second Build shack appears on the same plot so you can add on a second structure
later ("add on to your land").

## Progression System
Structures cost money (using the game's existing economy), so building out your
land is itself a money sink/goal alongside all the other things you already save
for (vehicles, boats, planes). A Huge House with 3 bedrooms is an expensive,
aspirational build.

## Features (Priority Order)
1. **6 land plots** placed around the map (~14,000 units out from the lake, spread
   evenly), each a generous-but-not-huge clearing (900×900 world units — for scale,
   the existing community HOUSE building is roughly 600 units wide).
2. **Roads** — simple straight dirt-road strips (cosmetic, no special physics)
   connecting each plot back toward the lake/community hub, "spoke" style.
3. **Build shack** — a tiny buildable marker per empty slot, using the same
   glow-and-click system added for vehicles/stands/train.
4. **Build Menu** — a shop-style panel (matching the existing dealership/bike-shop
   panels) listing: Garage ($3,000), Trophy Room ($3,000), House – Small ($4,000,
   1 bed), House – Medium ($10,000, 2 beds + a closet), House – Huge ($25,000, 3
   bedrooms + kitchen + closet + a bonus game room — at least 3 separate rooms).
5. **Garage** — cosmetic building; parking already works anywhere on the map via
   the existing universal vehicle system, so no new mechanic is needed — vehicles
   left near a player-built garage are just as safely parked as at the main one.
6. **Trophy Room** — cosmetic building showing the same shared mounted-skull count
   as the community trophy room (there's only one trophy stat until real
   multiplayer/per-player data exists).
7. **House interiors** — generalizes the existing single house-interior system
   (currently one hardcoded bed/kitchen/closet layout) to support multiple
   player-built houses, each with a size-appropriate room layout.
8. **Land expansion** — each plot supports 2 building slots total (build one, a
   second Build shack appears for the add-on).
9. **Local save** — plot ownership and built structures are saved to this
   browser's local storage so they survive a refresh (the game currently saves
   NOTHING, so this is new — but scoped to "this computer," not a cloud account).

## Technical Approach
- Reuse the `nearestInteractable()` / `drawInteractGlow()` / click-to-board system
  built last session — add a new `'build'` type alongside vehicle/stand/train.
- Reuse the existing `cabinFrom` pattern (`'house'`/`'yacht'`/`'cabin'`/`'camper'`)
  for entering/exiting a house, adding a `'myhouse'` variant that tracks which
  plot+size you're in so `houseObjects()` can return the right room layout.
- Garage/Trophy Room are simplified (less ornate than the hand-drawn community
  originals) generic buildings, reusing the game's existing drawing primitives
  (`roundRect`, `circle`) rather than replicating intricate hand-tuned pixel art
  six times over.
- Persistence via `localStorage` inside the game's own script — no server
  involvement, no changes to the site's account system.

## Child-Friendly Design
- Building costs fit the existing money economy a 9-year-old already understands.
- The glow/bubble system already reads clearly to a kid ("something I can click!").
- Nothing here can be lost permanently — it's an add-on to an already-forgiving
  open world, not a hardcore survival mechanic.
