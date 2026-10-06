import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROGRESS_WORD_FIELDS } from "@/lib/progress-words";
import { clearGameStorage, PROGRESS_OWNER_KEY } from "@/lib/storage-keys";
import { KID_TEXT_LABELS, SIGN_IN_COOKIE_DAYS } from "../lib/notice";

const SRC = path.resolve(__dirname, "../../..");
function source(relative: string): string {
  return readFileSync(path.join(SRC, relative), "utf8");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(file);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [file] : [];
  });
}

afterEach(() => localStorage.clear());

describe("current source facts used by the privacy draft", () => {
  it("describes the actual configured JWT session lifetime and hashed email/password signup", () => {
    const auth = source("lib/auth.ts");
    expect(auth).toMatch(/strategy:\s*"jwt"/);
    const days = auth.match(/maxAge:\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
    expect(days).not.toBeNull();
    expect(Number(days![1])).toBe(SIGN_IN_COOKIE_DAYS);
    expect(auth).toContain('next-auth/providers/google');
    const signup = source("app/api/auth/signup/route.ts");
    expect(signup).toMatch(/bcrypt\.hash\(password,/);
    expect(signup).toMatch(/password:\s*hashedPassword/);
  });

  it("covers all games in the reviewed player-word inventory, including Toy Finder notes and drawings", () => {
    expect(Object.keys(KID_TEXT_LABELS).sort()).toEqual(Object.keys(PROGRESS_WORD_FIELDS).sort());
    // Adding a category within an existing game requires a notice review too.
    expect(Object.fromEntries(Object.entries(PROGRESS_WORD_FIELDS).map(([appId, fields]) => [
      appId, fields.map((field) => field.path).sort(),
    ]))).toEqual({
      "oregon-trail": ["leaderName", "party[].name"],
      weather: ["lastLocation", "savedLocations"],
      "toy-finder": ["wishlistItems[].notes"],
      "drawing-app": ["savedArtworks"],
      "drum-machine": ["savedBeats[].name"],
      "virtual-pet": ["pet.name", "settings.petName"],
      "four-wheeler-3d": ["adventure.feeders[].label", "adventure.outfit.text"],
    });
    // The notice describes the disabled-policy path too; it does not promise a
    // future device-only cutover. The deployed policy needs a separate receipt.
    expect(source("app/api/progress/[appId]/route.ts")).toMatch(/data:\s*\(await readWordPolicy\(db\)\)\s*\?\s*stripProgressWords\(appId, progress\.data\)\s*:\s*progress\.data/);
  });

  it("does not repeat the old universal sign-out-erasure promise", () => {
    localStorage.setItem("hank-chess-state", "saved local game");
    localStorage.setItem(PROGRESS_OWNER_KEY, "test-owner");
    localStorage.setItem("test-recovery-original", "retained recovery");
    clearGameStorage();
    expect(localStorage.getItem("hank-chess-state")).toBe("saved local game");
    expect(localStorage.getItem(PROGRESS_OWNER_KEY)).toBe("test-owner");
    expect(localStorage.getItem("test-recovery-original")).toBe("retained recovery");
    const signout = source("lib/auth-client.ts").split("export async function signOutAndClear")[1];
    expect(signout).toContain("revokeForNavigation(target)");
    expect(signout).not.toMatch(/clearGameStorage\(|deleteOwner\(|localStorage\.clear\(/);
  });

  it("distinguishes new Retro device save states and ROM metadata from legacy cloud copies", () => {
    const retro = source("games/retro-arcade/lib/store.ts");
    const projection = retro.split("getProgress: () => {")[1].split("setProgress:")[0];
    expect(projection).toContain("customRoms: state.customRoms.map(stripRuntimeFile)");
    expect(projection).not.toMatch(/saveStates\s*:/);
    const fields = retro.split("function stripRuntimeFile")[1].split("// Immutable")[0];
    expect(fields).toContain("name: rom.name");
    expect(fields).toContain("system: rom.system");
    expect(fields).not.toMatch(/file:\s*rom\.file/);
    expect(source("games/retro-arcade/lib/saveStates.ts")).toContain('keyPath: ["owner", "gameId", "slot"]');
    // A documentation URL in a comment is not a runtime asset request.
    // Check the paths actually assigned to EmulatorJS and its loader.
    const emulator = source("../public/emulator/index.html");
    const assetRoot = emulator.match(/window\.EJS_pathtodata\s*=\s*['"]([^'"]+)['"]/);
    const loader = emulator.match(/script\.src\s*=\s*['"]([^'"]+)['"]/);
    expect(assetRoot).not.toBeNull();
    expect(loader).not.toBeNull();
    expect(assetRoot![1]).toMatch(/^\/emulator\/ejs\/[^/]+\/$/);
    expect(loader![1]).toBe(`${assetRoot![1]}loader.js`);
  });

  it("describes public generated leaderboard handles and the real visibility control", () => {
    const board = source("app/api/leaderboards/[appId]/route.ts");
    expect(board).toMatch(/handle:\s*gamingProfiles\.handle/);
    expect(board).not.toMatch(/\busers\b|\bemail\b/);
    expect(source("apps/profile/components/LeaderboardNameToggle.tsx")).toContain("Show my gamer name on leaderboards");
  });

  it("does not claim microphone/camera capture when capture sources are game canvases and audio buses", () => {
    const captureFiles = [...sourceFiles(path.join(SRC, "shared/clips")), ...sourceFiles(path.join(SRC, "shared/lib/audio"))];
    for (const file of captureFiles) expect(readFileSync(file, "utf8"), path.relative(SRC, file)).not.toMatch(/\bgetUserMedia\b/);
    expect(source("shared/clips/engine/recorder/compositor.ts")).toContain("captureStream");
    expect(source("shared/clips/engine/recorder/audioTrack.ts")).toContain("createMediaStreamDestination");
  });

  it("keeps the current clip sweeper and excludes account-inactivity deletion from this notice split", () => {
    const instrumentation = source("instrumentation.ts");
    expect(instrumentation).toContain("startLeaderboardClipSweepSchedule");
    expect(instrumentation).not.toContain("account-retention");
    const noticeFiles = sourceFiles(path.join(SRC, "apps/privacy"));
    for (const file of noticeFiles) expect(readFileSync(file, "utf8")).not.toMatch(/INACTIVE_ACCOUNT_MONTHS|retention-policy|account-retention/);
  });
});
