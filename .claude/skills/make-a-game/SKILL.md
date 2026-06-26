---
name: make-a-game
description: Use when a kid wants a brand-new game or app built, before writing any code. Triggers on "make a game", "make me a game about X", "build me a game", "I want a game where…", "can you make X", "I have an idea for a game", "create a new game/app", "I want an app that…".
---

# Make a Game 🎮

A kid wants a new game. Turn their idea into a **complete, working, kid-safe, actually-playable game**, then show it to them. No half-games, no "we'll add saving later."

**TONE — the blunt/sarcastic/profane style from CLAUDE.md is for Jack ONLY.** To the kid you are always warm, gentle, and excited — never sarcastic, never condescending, not a single swear. The kid never sees code or hears words like "schema," "store," "deploy," "commit," or "VALID_APP_IDS." Talk about "your game," "your score," "the screen."

## Step 0 — Does it already exist?
Quick check: look in `apps/web/src/games/` and `apps/web/src/apps/` for a matching game. If it already exists and works, **don't re-scaffold a duplicate** (you'll clobber another game's island) — switch to **change-a-game**, or build a genuinely different twist under a NEW id. **If the kid wants "one like X but Y," prefer remixing — copy + re-theme an existing game (→ remix-a-game) — over building from a blank page; it's faster and more fun.** Re-using an existing game still needs its design note (Step 3) if one is missing.

## Step 1 — Get excited, reassure, then ask 1–3 simple questions
If the kid sounds nervous or says they don't know computers, **answer that worry FIRST**: *"Totally okay — you bring the ideas, I do all the computer stuff!"* Then match their energy.

Ask a couple of **either/or questions with examples** (never tech questions). One at a time:
- **What do you do?** *"Do you catch the donuts, or dodge them?"*
- **How do you score / win?** *"A point for each donut you catch?"*
- **How hard?** *"Slow and easy, or super fast and tricky?"*
- **Look / controls?** *"What color? Arrow keys or tap the screen?"* (do both if you can)

If they say "I don't know," pick something fun and tell them: *"I'll start it slow — we can speed it up later!"* **Don't guess a whole different game over their idea.**

## Step 2 — Pick the kind of game (copy a real, well-tested sibling)
| Idea sounds like… | category | Copy from |
|---|---|---|
| Arcade / reflex (catch, dodge, tap) | `arcade` | `snake`, `flappy-bird`, `arkanoid` |
| Puzzle / numbers / matching | `puzzle` | `2048`, `memory-match`, `wordle` |
| Driving / racing | `racing` | `hill-climb`, `monster-truck` |
| Shooting / fighting (cartoony!) | `action` | `bomberman`, `blitz-bomber` (both wire `useAuthSync`; copy TESTS from `arkanoid`) |
| Board / turn-based | `board` | `checkers`, `chess` |
| A tool/toy, not a game | `apps` | `virtual-pet`, `drawing-app` (lives in `src/apps/`) |

Read the sibling's files first so you match the **current** patterns. Two cautions: (1) **`arkanoid` is an outlier** — it does NOT use `useAuthSync` or `GameShell` and hand-rolls its own HUD. Copy `arkanoid` only for the **store-test shape**; for the real wiring of `Game.tsx` + the route, mirror **`breakout`** (a normal synced game). (2) Several games (e.g. `space-invaders`) ship **no tests at all** — don't copy a test pattern from one that has none.

## Step 3 — Write a quick design note
Create `design/games/<name>.md` (or `design/apps/<name>.md`): core loop, how you win, what's fun, controls. Short — it's for you.

## Step 4 — Build the WHOLE thing
**Do step ① FIRST — it's a build prerequisite, not cleanup.** `appId` is typed `ValidAppId`, so `Game.tsx` (④) won't typecheck until the id is registered. Recommended order: **① → ② → ③ → ④ → ⑤ → ⑥ → ⑦ → ⑧ → ⑨**.

**The kid's words become the `name` and `emoji` (emoji and any language are great there). But YOU invent the `id` — lowercase letters, numbers, and hyphens ONLY, no spaces/emoji/punctuation (`🔥 Poop Blaster!!` → id `poop-blaster`). The `id` is the folder name, the URL, and the `VALID_APP_IDS` entry, so it must be a clean ascii slug.** (Examples below use `my-game`.)

**Edit first (the registration that everything else depends on):**
① `packages/db/src/schema/app-progress.ts` — add `"my-game"` to `VALID_APP_IDS`. **Without this, nothing typechecks and the server rejects every save.**
② `apps/web/src/lib/progress-schemas.ts` — add a Zod schema (`.strict()`, bound numbers with `MAX_COUNT`/`MAX_CURRENCY`, keys match the Progress type) and register it in `PROGRESS_SCHEMAS` under `"my-game"`.
③ `apps/web/src/apps/profile/lib/gameStatExtractor.ts` — add a `case "my-game":` with `primaryStat` + a couple of `secondaryStats`, or the profile page silently falls through to a generic high-score.

**Then create the module under `apps/web/`:**
④ `src/games/my-game/lib/store.ts` — Zustand `persist` store. Export `useMyGameStore`, a `MyGameProgress` type **with `lastModified: number`**, plus `getProgress: () => get().progress` and `setProgress: (d) => set({ progress: d })`. Persist: `name: "my-game-state"`, `partialize: (s) => ({ progress: s.progress })`. Bump `lastModified: Date.now()` on every change.
⑤ `src/games/my-game/Game.tsx` — `"use client"`, `default` export. Wire `useAuthSync({ appId: "my-game", localStorageKey: "my-game-state", getState: () => store.getProgress(), setState: (d) => store.setProgress(d), debounceMs: 2000 })`. Mirror `breakout/Game.tsx` for this wiring — not `arkanoid`, which skips `useAuthSync`.
⑥ `src/games/my-game/metadata.ts` — `export const metadata: GameMetadata` (import type from `@/shared/lib/game-registry`). **Only `id`, `name`, `emoji`, `category` are required** (`description`, `hidden` are optional). The home page finds your game by **regex-scanning this file at runtime**, so every value MUST be a **plain string literal** (`"donut-catch"`) — never a computed value, imported constant, or template string, or the game is silently skipped. **Do not add a `color` field** — card color is auto-derived from `category`. **Set `madeByKid: true`** so it shows up on the kid's **my-creations** shelf.
⑦ `src/games/my-game/index.ts` — re-export the `default` component, the store, and the Progress type.
⑧ `src/app/games/my-game/page.tsx` — thin `"use client"` route: `dynamic(() => import("@/games/my-game"), { ssr: false, loading })` inside `<GameShell gameName="My Game" appId="my-game" canPause={false}>` (mirror `breakout`'s route). Set `canPause` to `true` **only** if your game has a real paused state — otherwise it ships a dead pause button.
⑨ `src/games/my-game/__tests__/` — at least `store.test.ts` (logic; copy the shape from `arkanoid/__tests__/store.test.ts`) AND `Game.test.tsx` (mounts the component — the one that catches a broken game). **Your `Game` uses `useAuthSync` (→ `useSession`), so a render test throws `useSession must be wrapped in a <SessionProvider>` unless you mock next-auth at the top of the test file:**
```ts
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
```
**No existing 2D synced game ships a render test** (`breakout` has none; `arkanoid`'s renders only because it skips `useAuthSync`), so there's no sibling to copy for this one — use the `vi.mock` snippet above as-is. `monster-truck/__tests__/Game.test.tsx` is only the model for mocking the heavy `@react-three/*` modules (3D games).

> **Apps** go in `src/apps/my-app/` + `src/app/apps/my-app/page.tsx`, and `metadata.category` MUST be `"apps"`. Otherwise identical.

### Make it kid-friendly (always)
Big buttons (44px+), bright colors, touch AND keyboard, celebrations on score/win, forgiving, instant restart. **Sound:** if you add a `soundEnabled` flag, you MUST wire real sounds to it — a flag that plays nothing is a stub; wire it or delete it.

## Step 5 — Prove it works (three gates, in order)
1. `cd apps/web && pnpm test` — runs vitest. (If `node_modules` is missing, run `pnpm install` first.) **A green run proves little on its own** — most games have no tests.
2. `cd apps/web && pnpm build` — this is the **real gate**: it runs the TypeScript compiler (catches the unregistered-`appId` build failure that vitest cannot) and regenerates `gameMetadata.generated.ts` (the static name/emoji/color lookup the profile page **and leaderboards** read). Must pass. Heads-up: in `pnpm dev` a new game shows on the home grid right away but looks generic (gray 🎮, wrong name/category) on the profile/leaderboards until this build runs once — expected, not a bug.
3. **Watch it actually run.** Hand to **play-my-game** (or `/qa`) and SEE the game render and respond to a tap/keypress in a browser. Passing tests + a green build is the **floor, not the finish line** — unit tests don't draw a pixel. If you haven't watched it move and score, it is not done.

## Step 6 — Show the kid (automatically) + celebrate
**Open it on their screen and bring it to the front right away — don't wait to be asked.** Use **play-my-game** to start the dev server and pop the game to the front so they see it running the instant it's done. Celebrate big 🎉, then offer: *"Want it harder? Add something? Put it on the internet for your friends?"* (→ **change-a-game** / **put-it-online**).

## 🛡️ Guardrails — content safety
**HARD LINE (never negotiate, never ask permission, never tone down):** realistic guns aimed at people, blood, gore, killing real-looking people, torture, hateful or sexual content. Don't dial these back — **swap the whole premise to something cartoony and start building the safe version** (foam darts, aliens, goo, snowballs, lasers at blocks). Don't scold or lecture. If the kid pushes back ("no, I want REAL blood"), stay warm and **do not cave** — just keep selling the fun version and build it: *"Honestly the goo-blaster is way cooler — watch!"* If they get upset or escalate ("I HATE the goo one, you're dumb"), validate the *feeling* without caving — *"I know, you really wanted it scary — you've got a wild imagination!"* — hold the content line, and pour that energy into something they CAN have more of (more enemies, bigger goo explosions). Never go cold or make them feel rejected; never cave on the HARD LINE no matter how many times they ask.

**SOFT (just dial back, can discuss):** a monster that's a bit too scary, a boss that's too hard.

**Other:** no personal info, no money/accounts, no random web links. One game = one island — never edit or import another game's folder. No MVPs or stubs — build the complete small version, all 9 steps.

**Public-safe content:** never bake the kid's identifiable info into the game itself — a **first name** is the most that should ever appear. No last name, address, town/city, school, exact age, or friends'/family names in the game's text, code, labels, or filenames (a game can be published to the public internet). Build every game **deploy-ready** — the standard module pattern runs on Railway as-is — but default to running it **locally**; publishing is the gated exception (see **put-it-online**).

## Rationalization table — STOP if you think any of these
| Excuse | Reality |
|---|---|
| "Tests pass, so the game works — I'll show the kid." | Vitest doesn't typecheck and doesn't render. Run `pnpm build` AND watch it in a browser. |
| "I'll add the id to VALID_APP_IDS at the end." | `Game.tsx` won't compile until it's registered. Step ① is first, not last. |
| "metadata.ts can use a constant for the id to stay DRY." | The discovery parser is regex — only plain string literals are seen. Computed values vanish. |
| "The game shows up because build regenerates metadata." | Wrong path. The home card comes from a runtime fs scan of `metadata.ts`. The build regenerates `gameMetadata.generated.ts`, which feeds the profile page and leaderboards. |
| "I added the schema, that's enough plumbing." | All three shared edits (①②③) are mandatory, or saving/profile silently break. |
| "The kid insists on real guns, I should give them what they asked for." | The HARD LINE is non-negotiable no matter how many times they ask. Build the safe version. |
| "I'll just ask the kid which safe version they want." (for an unsafe ask) | Don't stall on a question — pivot to a concrete safe game and start building. |
| "A `soundEnabled` flag is fine even if nothing plays yet." | A dead flag is a stub. Wire it or delete it. |

## Red flags — you're about to ship a known failure
- Telling the kid it's ready without ever watching it render/respond.
- Citing "tests pass" or "build green" as proof it's fun or even visible.
- `Game.tsx` written with an `appId` not yet in `VALID_APP_IDS`.
- `metadata.ts` present but the game missing from the home page (non-literal value or category typo).
- Only some of ①②③ done — partial registration.
- Any code word (schema, store, Zod, deploy, typecheck) in a message to the kid.
- A new game's files touch or import another game's folder.
