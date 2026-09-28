import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROGRESS_SCHEMAS } from "@/lib/progress-schemas";
import {
  PROGRESS_OWNER_KEY,
  clearGameStorage,
  isClearedOnSignOut,
} from "@/lib/storage-keys";

import { KID_TEXT_LABELS, SIGN_IN_COOKIE_DAYS, type KidTextLabelKey } from "../lib/notice";

/**
 * The privacy notice states facts about the code. These tests fail when
 * the code changes under a fact, so the notice cannot silently become
 * false. When one fails, update the notice (and PRIVACY_NOTICE_UPDATED)
 * in the same change, then update the test.
 */

const SRC = path.resolve(__dirname, "../../..");

function source(relativePath: string): string {
  return readFileSync(path.join(SRC, relativePath), "utf8");
}

/** Every .ts and .tsx file under a folder of src, without the tests. */
function sourceFiles(relativeDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(full);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(SRC, relativeDir));
  return out;
}

describe("privacy notice facts match the code", () => {
  it("sign-in cookie lasts as many days as the notice says", () => {
    const auth = source("lib/auth.ts");
    const match = auth.match(/maxAge:\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
    expect(match, "session.maxAge in lib/auth.ts changed shape").not.toBeNull();
    expect(Number(match![1])).toBe(SIGN_IN_COOKIE_DAYS);
    // The notice describes a cookie session, not a database session.
    expect(auth).toMatch(/strategy:\s*"jwt"/);
  });

  it("stores passwords only as bcrypt hashes", () => {
    const signup = source("app/api/auth/signup/route.ts");
    expect(signup).toMatch(/bcrypt\.hash\(password,/);
    expect(signup).toMatch(/password:\s*hashedPassword/);
  });

  it("keeps real names and emails off the public leaderboard", () => {
    const leaderboard = source("app/api/leaderboards/[appId]/route.ts");
    // The public list reads the random handle, never the users table.
    expect(leaderboard).toMatch(/handle:\s*gamingProfiles\.handle/);
    expect(leaderboard).not.toMatch(/\busers\b/);
    expect(leaderboard).not.toMatch(/\bemail\b/);
  });

  it("keeps the account number on the device after sign-out, as the notice says", () => {
    expect(isClearedOnSignOut(PROGRESS_OWNER_KEY)).toBe(false);
  });

  it("removes every synced game's progress from the device on sign-out", () => {
    // The keys come from the code (every localStorageKey given to
    // useAuthSync), not from the registry that the clear function reads.
    const keys = new Set<string>();
    for (const file of sourceFiles(".")) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/localStorageKey:\s*["']([^"']+)["']/g)) {
        keys.add(match[1]);
      }
    }
    expect(keys.size).toBeGreaterThan(10);

    for (const key of keys) localStorage.setItem(key, "{}");
    localStorage.setItem(PROGRESS_OWNER_KEY, "user-1");

    clearGameStorage();

    const left = [...keys].filter((key) => localStorage.getItem(key) !== null);
    expect(left, "these keys stay on the device after sign-out").toEqual([]);
    expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("user-1");
    localStorage.clear();
  });

  it("copies guest progress into the account at the first sign-in, as the notice says", () => {
    const sync = source("shared/hooks/useAuthSync.ts");
    // No server copy yet: the local (guest) progress is uploaded.
    expect(sync).toMatch(/if \(!serverData\) \{[\s\S]{0,200}saveToServer\(localState, false\)/);
    // Both exist: the local progress is merged into the account.
    expect(sync).toMatch(/saveToServer\(localState, true\)/);
  });

  it("never sends email: no mail library and no email sign-in provider", () => {
    const pkg = JSON.parse(source("../package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    for (const mailer of ["nodemailer", "resend", "@sendgrid/mail", "postmark", "mailgun.js"]) {
      expect(deps).not.toContain(mailer);
    }
    // next-auth ships email providers inside the package (Resend needs only
    // fetch), so a package check is not enough.
    const emailProvider =
      /next-auth\/providers\/(email|resend|nodemailer|sendgrid|postmark|mailgun|forwardemail|loops)\b/;
    for (const file of sourceFiles(".")) {
      expect(readFileSync(file, "utf8"), path.relative(SRC, file)).not.toMatch(emailProvider);
    }
  });

  it("writes no error object to the server logs (they hold player data)", () => {
    // A drizzle query error holds the query values, for example the email,
    // name and password hash of a new account. Use lib/server-log.ts.
    const serverFiles = [
      ...sourceFiles("app/api"),
      ...sourceFiles("lib").filter((file) => !readFileSync(file, "utf8").startsWith('"use client"')),
    ];
    const errorObjectLog =
      /console\.(error|warn|log|info)\([^;]*,\s*(error|err|e|cause)\s*\)/;
    for (const file of serverFiles) {
      expect(readFileSync(file, "utf8"), path.relative(SRC, file)).not.toMatch(errorObjectLog);
    }
    // Auth.js logs its own errors. Its logger must go through the helper too.
    expect(source("lib/auth.ts")).toMatch(
      /logger:\s*\{\s*error\(error\)\s*\{\s*logServerError\(/
    );
  });
});

/*
 * Free text in game progress.
 *
 * The notice lists, under "Game progress", every game that saves words or
 * pictures that a player makes. This walk finds every text field (and every
 * field of any type) in the progress schemas. Each field must be in one of
 * the two lists below. A new text field fails this test until someone
 * decides which list it belongs in. If players can type it (or it holds a
 * file name, a drawing or a place), put it in PLAYER_TEXT with the label of
 * the notice line that covers it, and update the notice line if needed.
 */

/** Fields that hold what a player types or makes, and the notice line for each. */
const PLAYER_TEXT: Record<string, KidTextLabelKey> = {
  "oregon-trail.leaderName": "oregonTrail",
  "oregon-trail.party[].name": "oregonTrail",
  // Event text can name a traveler (for example "Sam has a broken arm").
  "oregon-trail.currentEvent": "oregonTrail",
  "four-wheeler-3d.adventure.outfit.text": "fourWheeler",
  "four-wheeler-3d.adventure.feeders[].label": "fourWheeler",
  "virtual-pet.pet.name": "virtualPet",
  "virtual-pet.settings.petName": "virtualPet",
  "drawing-app.savedArtworks[].name": "drawing",
  "drawing-app.savedArtworks[].thumbnail": "drawing",
  "drawing-app.savedArtworks[].dataUrl": "drawing",
  "drum-machine.savedBeats[].name": "drumMachine",
  "weather.savedLocations[].name": "weather",
  "weather.savedLocations[].country": "weather",
  "weather.savedLocations[].admin1": "weather",
  "weather.lastLocation.name": "weather",
  "weather.lastLocation.country": "weather",
  "weather.lastLocation.admin1": "weather",
  // A game that the player adds keeps its file name in its id and name.
  "retro-arcade.customRoms[].id": "retroArcade",
  "retro-arcade.customRoms[].name": "retroArcade",
  "retro-arcade.recentlyPlayed[].gameId": "retroArcade",
  "retro-arcade.recentlyPlayed[].name": "retroArcade",
  "retro-arcade.favorites[]": "retroArcade",
  "retro-arcade.saveStates{key}": "retroArcade",
  "retro-arcade.saveStates{}.slot1": "retroArcade",
  "retro-arcade.saveStates{}.slot2": "retroArcade",
  "retro-arcade.saveStates{}.slot3": "retroArcade",
  "retro-arcade.saveStates{}.autoSave": "retroArcade",
};

/** Fields that the game sets: ids, settings, catalog names and dates. */
const GAME_TEXT = new Set<string>([
  "snake.controlMode",
  "cookie-clicker.buildings{key}",
  "cookie-clicker.purchasedUpgrades[]",
  "cookie-clicker.unlockedAchievements[]",
  "memory-match.favoriteTheme",
  "memory-match.unlockedThemes[]",
  "memory-match.difficulty",
  "memory-match.theme",
  "checkers.difficulty",
  "chess.difficulty",
  "chess.gameMode",
  "quoridor.difficulty",
  "quoridor.gameMode",
  "oregon-trail.gamePhase",
  "oregon-trail.occupation",
  "oregon-trail.departureMonth",
  "oregon-trail.pace",
  "oregon-trail.weather",
  "oregon-trail.currentRiver.name",
  "monster-truck.currentTruckId",
  "monster-truck.trucks[].id",
  "monster-truck.trucks[].name",
  "monster-truck.trucks[].description",
  "monster-truck.trucks[].color",
  "monster-truck.upgrades{key}",
  "monster-truck.customization{key}",
  "monster-truck.customization{}.paintColor",
  "monster-truck.customization{}.decal",
  "monster-truck.challenges[].id",
  "monster-truck.challenges[].name",
  "monster-truck.challenges[].description",
  "four-wheeler-3d.adventure.activities.cutGrass{key}",
  "four-wheeler-3d.adventure.activities.plowVehicleId",
  "four-wheeler-3d.adventure.activities.brokenProps[]",
  "four-wheeler-3d.adventure.fleet{key}",
  "four-wheeler-3d.adventure.fleet{}.id",
  "four-wheeler-3d.adventure.fleet{}.type",
  "four-wheeler-3d.adventure.fleet{}.paint",
  "four-wheeler-3d.adventure.fleet{}.cargo[]",
  "four-wheeler-3d.adventure.fleet{}.hitch",
  "four-wheeler-3d.adventure.activeVehicleId",
  "four-wheeler-3d.adventure.inventory{key}",
  "four-wheeler-3d.adventure.plots{key}",
  "four-wheeler-3d.adventure.plots{}.id",
  "four-wheeler-3d.adventure.plots{}.buildings[].parkedVehicleIds[]",
  "four-wheeler-3d.adventure.collectedBones[]",
  "four-wheeler-3d.adventure.feeders[].id",
  "four-wheeler-3d.adventure.stands[].id",
  "four-wheeler-3d.adventure.heldKills{key}",
  "four-wheeler-3d.adventure.trophyCounts{key}",
  "four-wheeler-3d.adventure.outfit.color",
  "four-wheeler-3d.adventure.horses[].id",
  "four-wheeler-3d.adventure.horses[].color",
  "four-wheeler-3d.adventure.horses[].saddle",
  "four-wheeler-3d.adventure.bucket.color",
  "four-wheeler-3d.adventure.bucket.colorName",
  "four-wheeler-3d.adventure.hunting.removedAnimalIds[]",
  "four-wheeler-3d.adventure.hunting.carcasses[].id",
  "four-wheeler-3d.adventure.hunting.carcasses[].type",
  "four-wheeler-3d.adventure.hunting.looseSkulls[].id",
  "four-wheeler-3d.adventure.hunting.activeBait",
  "four-wheeler-3d.adventure.space.visited[]",
  "four-wheeler-3d.adventure.space.gems{key}",
  "four-wheeler-3d.adventure.space.gems{}[]",
  "four-wheeler-3d.adventure.delivery.id",
  "four-wheeler-3d.adventure.delivery.offerId",
  "four-wheeler-3d.adventure.helperTask.id",
  "four-wheeler-3d.adventure.helperTask.offerId",
  "four-wheeler-3d.ownedVehicles[]",
  "four-wheeler-3d.currentVehicle",
  "four-wheeler-3d.paint",
  "four-wheeler-3d.fishCaught{key}",
  "four-wheeler-3d.biggestFish",
  "four-wheeler-3d.land{key}",
  "four-wheeler-3d.land{}.slots[]",
  "four-wheeler-3d.weather",
  "hill-climb.currentVehicleId",
  "hill-climb.currentStageId",
  "hill-climb.unlockedVehicles[]",
  "hill-climb.unlockedStages[]",
  "hill-climb.vehicleUpgrades{key}",
  "hill-climb.bestDistancePerStage{key}",
  "endless-runner.unlockedCharacters[]",
  "endless-runner.selectedCharacter",
  "platformer.levels{key}",
  "platformer.lastPlayedLevel",
  "retro-arcade.recentlyPlayed[].system",
  "retro-arcade.customRoms[].system",
  "retro-arcade.stats.favoriteSystem",
  // Jokes come from icanhazdadjoke.com, not from the player.
  "joke-generator.favorites[].id",
  "joke-generator.favorites[].setup",
  "joke-generator.favorites[].punchline",
  "joke-generator.favorites[].category",
  "joke-generator.ratings[].jokeId",
  "joke-generator.seenJokeIds[]",
  "joke-generator.lastCategory",
  "toy-finder.wishlistItems[].toyId",
  "toy-finder.wishlistItems[].priority",
  // No screen lets a player type notes today (2026-09-28). If one is added,
  // move this field to PLAYER_TEXT and add a line to the notice.
  "toy-finder.wishlistItems[].notes",
  "toy-finder.recentlyViewed[]",
  "drawing-app.settings.defaultColor",
  "drawing-app.savedArtworks[].id",
  "drawing-app.savedArtworks[].createdAt",
  "drawing-app.savedArtworks[].editedAt",
  "drum-machine.savedBeats[].id",
  "drum-machine.savedBeats[].kitId",
  "drum-machine.savedBeats[].pattern{key}",
  "drum-machine.savedBeats[].createdAt",
  "drum-machine.favoriteKitId",
  "drum-machine.settings.defaultKitId",
  "virtual-pet.pet.speciesId",
  "virtual-pet.pet.bornAt",
  "virtual-pet.pet.lastChecked",
  "virtual-pet.inventory[].itemId",
  "virtual-pet.unlockedSpecies[]",
  "virtual-pet.equippedCosmetics[]",
  "virtual-pet.stats.lastPlayDate",
  "achievements.unlocked{key}",
]);

type ZodDef = { type: string; [key: string]: unknown };

function zodDef(schema: unknown): ZodDef {
  return (schema as { _zod: { def: ZodDef } })._zod.def;
}

/** Collect the path of every text field and every field of any type. */
function textFields(schema: unknown, at: string, out: Set<string>): void {
  const def = zodDef(schema);
  switch (def.type) {
    case "string":
    case "any":
    case "unknown":
      out.add(at);
      return;
    case "object":
      for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) {
        textFields(value, `${at}.${key}`, out);
      }
      return;
    case "array":
      textFields(def.element, `${at}[]`, out);
      return;
    case "record":
      textFields(def.keyType, `${at}{key}`, out);
      textFields(def.valueType, `${at}{}`, out);
      return;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
      textFields(def.innerType, at, out);
      return;
    case "pipe":
      textFields(def.in, at, out);
      textFields(def.out, at, out);
      return;
    case "union":
      for (const option of def.options as unknown[]) textFields(option, at, out);
      return;
    case "intersection":
      textFields(def.left, at, out);
      textFields(def.right, at, out);
      return;
    case "tuple":
      (def.items as unknown[]).forEach((item, index) => textFields(item, `${at}[${index}]`, out));
      if (def.rest) textFields(def.rest, `${at}[]`, out);
      return;
    case "lazy":
      textFields((def.getter as () => unknown)(), at, out);
      return;
    case "number":
    case "boolean":
    case "enum":
    case "literal":
    case "null":
    case "undefined":
    case "bigint":
    case "date":
    case "nan":
      return;
    default:
      throw new Error(`notice-facts: teach textFields about the zod type "${def.type}" (at ${at})`);
  }
}

describe("every text field in game progress is covered by the notice", () => {
  const found = new Set<string>();
  for (const [appId, schema] of Object.entries(PROGRESS_SCHEMAS)) {
    textFields(schema, appId, found);
  }

  it("finds the text fields (the walk works)", () => {
    expect(found.has("oregon-trail.leaderName")).toBe(true);
    expect(found.has("four-wheeler-3d.adventure.feeders[].label")).toBe(true);
    expect(found.size).toBeGreaterThan(100);
  });

  it("puts each field in exactly one list", () => {
    const unsorted = [...found].filter(
      (field) => !(field in PLAYER_TEXT) && !GAME_TEXT.has(field)
    );
    expect(
      unsorted,
      "New text fields in progress-schemas.ts. Put each one in PLAYER_TEXT (and the notice) or GAME_TEXT."
    ).toEqual([]);
    for (const field of Object.keys(PLAYER_TEXT)) {
      expect(GAME_TEXT.has(field), field).toBe(false);
    }
  });

  it("has no stale entries in the lists", () => {
    const stale = [...Object.keys(PLAYER_TEXT), ...GAME_TEXT].filter((field) => !found.has(field));
    expect(stale, "These fields are gone from the schemas. Remove them here.").toEqual([]);
  });

  it("names each game with player text in the notice labels", () => {
    const used = new Set(Object.values(PLAYER_TEXT));
    expect([...used].sort()).toEqual(
      (Object.keys(KID_TEXT_LABELS) as KidTextLabelKey[]).sort()
    );
  });
});
