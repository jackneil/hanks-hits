import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { PROGRESS_SCHEMAS, validateProgress, type ProgressSchemasByApp } from "@/lib/progress-schemas";
import type { use2048Store } from "@/games/2048/lib/store";
import type { useArkanoidStore } from "@/games/arkanoid/lib/store";
import type { useAsteroidsStore } from "@/games/asteroids/lib/store";
import type { useBlitzBomberStore } from "@/games/blitz-bomber/lib/store";
import type { useBombermanStore } from "@/games/bomberman/lib/store";
import type { useBreakoutStore } from "@/games/breakout/lib/store";
import type { useCheckersStore } from "@/games/checkers/lib/store";
import type { useChessStore } from "@/games/chess/lib/store";
import type { useCookieClickerStore } from "@/games/cookie-clicker/lib/store";
import type { useDinoRunnerStore } from "@/games/dino-runner/lib/store";
import type { useEndlessRunnerStore } from "@/games/endless-runner/lib/store";
import type { useFlappyStore } from "@/games/flappy-bird/lib/store";
import type { useFourWheeler3dStore } from "@/games/four-wheeler-3d/lib/store";
import type { useHextrisStore } from "@/games/hextris/lib/store";
import type { useHillClimbStore } from "@/games/hill-climb/lib/store";
import type { useMathAttackStore } from "@/games/math-attack/lib/store";
import type { useMemoryMatchStore } from "@/games/memory-match/lib/store";
import type { useGameStore } from "@/games/monster-truck/lib/store";
import type { useOregonTrailStore } from "@/games/oregon-trail/lib/store";
import type { usePlatformerStore } from "@/games/platformer/lib/store";
import type { useQuoridorStore } from "@/games/quoridor/lib/store";
import type { useRetroArcadeStore } from "@/games/retro-arcade/lib/store";
import type { useSnakeStore } from "@/games/snake/lib/store";
import type { useSpaceInvadersStore } from "@/games/space-invaders/lib/store";
import type { useWordleStore } from "@/games/wordle/lib/store";
import type { useDrawingStore } from "@/apps/drawing-app/lib/store";
import type { useDrumMachineStore } from "@/apps/drum-machine/lib/store";
import type { useJokeStore } from "@/apps/joke-generator/lib/store";
import type { useToyFinderStore } from "@/apps/toy-finder/lib/store";
import type { useTriviaStore } from "@/apps/trivia/lib/store";
import type { useVirtualPetStore } from "@/apps/virtual-pet/lib/store";
import type { useWeatherStore } from "@/apps/weather/lib/store";
import type { useAchievementsStore } from "@/shared/lib/achievements";

/**
 * Store TYPE <-> schema TYPE contract, checked by tsc (`pnpm typecheck`
 * and `pnpm build` both compile this file).
 *
 * progress-schema-contract.test.ts proves that each store's DEFAULT progress
 * passes its schema. That cannot see a value the kid makes later: an age
 * that a picker offers, a health that a long trip sets, a field inside a
 * list item. This file compares the TYPES, so it sees every value that the
 * store's type allows:
 *
 * - "refused": a value that the store's type allows and the schema's input
 *   type does not. The server answers 400 to that save, and the client does
 *   not send it again. Math Attack's 6yo and 10yo, and Oregon Trail's
 *   "very_poor", were refused this way.
 * - "dropped": a field that the store sends and the schema does not list.
 *   z.object() strips it without an error, so the field is lost in the
 *   account. Oregon Trail's party id and the drum machine's patternLength
 *   were dropped this way.
 *
 * A failure is a compile error on the contract<...>() line of the app,
 * with the path of the field. Fix the SCHEMA (the client already makes the
 * value), never the type here.
 */

type ProgressOf<T extends { getState: () => { getProgress: () => unknown } }> = ReturnType<
  ReturnType<T["getState"]>["getProgress"]
>;

/** Keys that are written out (not an index signature such as [key: string]). */
type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** The paths where the store's type allows a value that the schema refuses. */
type Refused<S, Z, P extends string = ""> = [S] extends [Z]
  ? never
  : [S] extends [readonly (infer SE)[]]
    ? [Z] extends [readonly (infer ZE)[]]
      ? Refused<SE, ZE, `${P}[]`>
      : P
    : [S] extends [object]
      ? [Z] extends [object]
        ? string extends keyof Z
          ? Refused<S[keyof S], Z[string & keyof Z], `${P}.*`>
          : {
              [K in KnownKeys<Z> & string]-?: K extends keyof S
                ? Refused<S[K], Z[K], `${P}.${K}`>
                : undefined extends Z[K]
                  ? never
                  : `${P}.${K}`;
            }[KnownKeys<Z> & string]
        : P
      : P;

/** The paths of the fields that the store sends and the schema drops. */
type Dropped<S, Z, P extends string = ""> = [S] extends [readonly (infer SE)[]]
  ? [Z] extends [readonly (infer ZE)[]]
    ? Dropped<SE, ZE, `${P}[]`>
    : never
  : [S] extends [object]
    ? [Z] extends [object]
      ? string extends keyof Z
        ? Dropped<S[keyof S], Z[string & keyof Z], `${P}.*`>
        : {
            [K in KnownKeys<S> & string]-?: K extends keyof Z
              ? Dropped<NonNullable<S[K]>, NonNullable<Z[K]>, `${P}.${K}`>
              : `${P}.${K}`;
          }[KnownKeys<S> & string]
      : never
    : never;

type RefusedPaths<A extends keyof ProgressSchemasByApp, Store> = Refused<
  Store,
  z.input<ProgressSchemasByApp[A]>
>;
type DroppedPaths<A extends keyof ProgressSchemasByApp, Store> = Dropped<
  Store,
  z.output<ProgressSchemasByApp[A]>
>;

/** `true` when the schema of app A refuses and drops nothing that Store sends. */
type Clean<A extends keyof ProgressSchemasByApp, Store> = [RefusedPaths<A, Store>] extends [never]
  ? [DroppedPaths<A, Store>] extends [never]
    ? true
    : { dropped: DroppedPaths<A, Store> }
  : { refused: RefusedPaths<A, Store> };

// A line here fails to compile when its schema refuses or drops a value that
// the store makes. The error shows the path of the field.
const CHECKED = {
  "2048": true satisfies Clean<"2048", ProgressOf<typeof use2048Store>>,
  "arkanoid": true satisfies Clean<"arkanoid", ProgressOf<typeof useArkanoidStore>>,
  "asteroids": true satisfies Clean<"asteroids", ProgressOf<typeof useAsteroidsStore>>,
  "blitz-bomber": true satisfies Clean<"blitz-bomber", ProgressOf<typeof useBlitzBomberStore>>,
  "bomberman": true satisfies Clean<"bomberman", ProgressOf<typeof useBombermanStore>>,
  "breakout": true satisfies Clean<"breakout", ProgressOf<typeof useBreakoutStore>>,
  "checkers": true satisfies Clean<"checkers", ProgressOf<typeof useCheckersStore>>,
  "chess": true satisfies Clean<"chess", ProgressOf<typeof useChessStore>>,
  "cookie-clicker": true satisfies Clean<"cookie-clicker", ProgressOf<typeof useCookieClickerStore>>,
  "dino-runner": true satisfies Clean<"dino-runner", ProgressOf<typeof useDinoRunnerStore>>,
  "endless-runner": true satisfies Clean<"endless-runner", ProgressOf<typeof useEndlessRunnerStore>>,
  "flappy-bird": true satisfies Clean<"flappy-bird", ProgressOf<typeof useFlappyStore>>,
  "four-wheeler-3d": true satisfies Clean<"four-wheeler-3d", ProgressOf<typeof useFourWheeler3dStore>>,
  "hextris": true satisfies Clean<"hextris", ProgressOf<typeof useHextrisStore>>,
  "hill-climb": true satisfies Clean<"hill-climb", ProgressOf<typeof useHillClimbStore>>,
  "math-attack": true satisfies Clean<"math-attack", ProgressOf<typeof useMathAttackStore>>,
  "memory-match": true satisfies Clean<"memory-match", ProgressOf<typeof useMemoryMatchStore>>,
  "monster-truck": true satisfies Clean<"monster-truck", ProgressOf<typeof useGameStore>>,
  "oregon-trail": true satisfies Clean<"oregon-trail", ProgressOf<typeof useOregonTrailStore>>,
  "platformer": true satisfies Clean<"platformer", ProgressOf<typeof usePlatformerStore>>,
  "quoridor": true satisfies Clean<"quoridor", ProgressOf<typeof useQuoridorStore>>,
  "retro-arcade": true satisfies Clean<"retro-arcade", ProgressOf<typeof useRetroArcadeStore>>,
  "snake": true satisfies Clean<"snake", ProgressOf<typeof useSnakeStore>>,
  "space-invaders": true satisfies Clean<"space-invaders", ProgressOf<typeof useSpaceInvadersStore>>,
  "wordle": true satisfies Clean<"wordle", ProgressOf<typeof useWordleStore>>,
  "drawing-app": true satisfies Clean<"drawing-app", ProgressOf<typeof useDrawingStore>>,
  "drum-machine": true satisfies Clean<"drum-machine", ProgressOf<typeof useDrumMachineStore>>,
  "joke-generator": true satisfies Clean<"joke-generator", ProgressOf<typeof useJokeStore>>,
  "toy-finder": true satisfies Clean<"toy-finder", ProgressOf<typeof useToyFinderStore>>,
  "trivia": true satisfies Clean<"trivia", ProgressOf<typeof useTriviaStore>>,
  "virtual-pet": true satisfies Clean<"virtual-pet", ProgressOf<typeof useVirtualPetStore>>,
  "weather": true satisfies Clean<"weather", ProgressOf<typeof useWeatherStore>>,
  "achievements": true satisfies Clean<"achievements", ProgressOf<typeof useAchievementsStore>>,
} satisfies Record<keyof ProgressSchemasByApp, true>;

describe("progress schema types: the schema takes every value that the store's type allows", () => {
  it("checks every app that has a schema", () => {
    expect(Object.keys(CHECKED).sort()).toEqual(Object.keys(PROGRESS_SCHEMAS).sort());
  });

  // The values that the type check found, at run time.
  it("math-attack: every age of the picker passes (6yo and 10yo were refused)", async () => {
    const { DIFFICULTY_SETTINGS } = await import("@/games/math-attack/lib/constants");
    const { useMathAttackStore } = await import("@/games/math-attack/lib/store");
    const ages = Object.keys(DIFFICULTY_SETTINGS);
    expect(ages).toEqual(expect.arrayContaining(["6yo", "10yo"]));
    for (const age of ages) {
      const progress = useMathAttackStore.getState().getProgress();
      const result = validateProgress("math-attack", {
        ...progress,
        settings: { ...progress.settings, difficulty: age },
        lastModified: Date.now(),
      });
      expect(result, age).toEqual(expect.objectContaining({ success: true }));
    }
  });

  // Number limits are not in the types. These are the limits below what the
  // client makes, found by reading each store (drum + button, Oregon Rest
  // button and store).
  it("drum-machine: a beat as long as the + button makes passes, with its patternLength", async () => {
    const { MAX_PATTERN_STEPS } = await import("@/apps/drum-machine/lib/constants");
    const { useDrumMachineStore } = await import("@/apps/drum-machine/lib/store");
    const beat = (steps: number) => ({
      id: "b1",
      name: "Long beat",
      kitId: "hip-hop",
      bpm: 120,
      pattern: { kick: new Array(steps).fill(false), snare: new Array(steps).fill(true) },
      patternLength: steps,
      createdAt: new Date().toISOString(),
    });
    const progress = useDrumMachineStore.getState().getProgress();
    // extendPattern adds 16 steps a tap: 4 taps make an 80-step beat.
    for (const steps of [16, 80, MAX_PATTERN_STEPS]) {
      const result = validateProgress("drum-machine", { ...progress, savedBeats: [beat(steps)], lastModified: Date.now() });
      expect(result, String(steps)).toEqual(expect.objectContaining({ success: true }));
      if (!result.success) continue;
      const saved = (result.data as { savedBeats: { patternLength?: number }[] }).savedBeats[0];
      expect(saved.patternLength, "patternLength is kept, not dropped").toBe(steps);
    }
    const tooLong = validateProgress("drum-machine", {
      ...progress,
      savedBeats: [beat(MAX_PATTERN_STEPS + 16)],
      lastModified: Date.now(),
    });
    expect(tooLong.success).toBe(false);
  });

  it("oregon-trail: a long rest, a big parts order and a very sick member pass, and ids are kept", async () => {
    const { useOregonTrailStore } = await import("@/games/oregon-trail/lib/store");
    const progress = useOregonTrailStore.getState().getProgress();
    const trip = {
      ...progress,
      // rest() adds a day and a rest day with no limit (store rest()).
      currentDay: 400,
      daysRested: 380,
      // A banker ($1,600) can buy 160 spare wheels at $10.
      supplies: { ...progress.supplies, spareParts: { wheels: 160, axles: 120, tongues: 101 } },
      // updatePartyHealth sets "very_poor" after 10 sick days.
      party: [
        { id: "m0", name: "Ann", health: "very_poor", isSick: true, sickDays: 12, leftBehind: false },
        { id: "m1", name: "Bo", health: "good", isSick: false, sickDays: 0, leftBehind: false },
      ],
      lastModified: Date.now(),
    };
    const result = validateProgress("oregon-trail", trip);
    expect(result).toEqual(expect.objectContaining({ success: true }));
    if (!result.success) return;
    const party = (result.data as { party: { id?: string }[] }).party;
    expect(party.map((m) => m.id)).toEqual(["m0", "m1"]);
  });
});
