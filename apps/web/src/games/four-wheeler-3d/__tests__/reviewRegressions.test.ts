import { afterEach, describe, expect, it, vi } from "vitest";
import { adventureSchema } from "../lib/adventureSchema";
import { createAdventureProgress } from "../lib/adventureTypes";
import { migrateAdventure } from "../lib/migration";
import { sellVehicle } from "../lib/economy";
import { defaultProgress } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { mergeProgress } from "@/lib/progress-merge";
import { displaySpeedMph } from "../lib/displaySpeed";
import { wheelGeometry } from "../components/models/WheelModel";
import { nearestInteraction } from "../lib/interactions";
import { startRadio } from "../lib/radioAudio";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("review regression boundaries", () => {
  it("keeps nearby destinations reachable despite parked rides", () => {
    const ride = {
      id: "heli",
      kind: "vehicle",
      label: "Helicopter",
      icon: "",
      distance: 3.6,
      ready: true,
    };
    const launch = {
      id: "launchPad",
      kind: "launch",
      label: "Space Launch",
      icon: "",
      distance: 0,
      ready: true,
    };
    expect(nearestInteraction([null, ride, launch])).toBe(launch);
    expect(
      nearestInteraction([
        { ...ride, distance: 0 },
        { ...launch, distance: 9 },
      ])?.id,
    ).toBe("heli");
  });

  it.each(["__proto__", "constructor", "toString", "prototype"])(
    "rejects inherited fleet reference %s and salvages without prototype mutation",
    (key) => {
      const a = createAdventureProgress();
      a.activeVehicleId = key;
      a.fleet["starter-atv"].cargo = [key];
      expect(adventureSchema.safeParse(a).success).toBe(false);
      const clean = migrateAdventure(a);
      expect(
        clean.activeVehicleId === null ||
          Object.hasOwn(clean.fleet, clean.activeVehicleId),
      ).toBe(true);
      expect(Object.values(clean.fleet).flatMap((v) => v.cargo)).not.toContain(
        key,
      );
      sellVehicle(
        { ...structuredClone(defaultProgress), adventure: a },
        "starter-atv",
      );
      expect(Object.hasOwn(Object.prototype, "parked")).toBe(false);
      expect(Object.hasOwn(Object.prototype, "position")).toBe(false);
    },
  );
  it.each([
    { x: 0, z: 0, size: 1e100 },
    { x: 1e100, z: 0, size: 1 },
    { x: 0, z: -1e100, size: 1 },
  ])("rejects impossible saved snow %j", (pile) => {
    const a = createAdventureProgress();
    a.activities.snowPiles = [pile];
    expect(adventureSchema.safeParse(a).success).toBe(false);
  });
  it("bounds grass masks separately from the clock while retaining legacy fractional hours", () => {
    const a = createAdventureProgress();
    a.activities.cutGrass = { "b:0,0": 2 ** 48 - 1, "@epoch": 1, "0,0": 0.5 };
    expect(adventureSchema.safeParse(a).success).toBe(true);
    const invalidCuts: Record<string, number>[] = [
      { "b:0,0": 1e100 },
      { "b:0,0": 0.5 },
      { "@epoch": 1e100 },
    ];
    for (const invalid of invalidCuts) {
      a.activities.cutGrass = invalid;
      expect(adventureSchema.safeParse(a).success).toBe(false);
    }
  });
  it("never reuses events across resets and advances the world generation", () => {
    const s = useAdventureSession.getState();
    s.relocate({ x: 1, y: 2, z: 3 });
    s.requestAction("first");
    const old = useAdventureSession.getState();
    s.reset();
    s.relocate({ x: 4, y: 5, z: 6 });
    s.requestAction("next");
    const next = useAdventureSession.getState();
    expect(next.generation).toBeGreaterThan(old.generation);
    expect(next.relocation!.id).toBeGreaterThan(old.relocation!.id);
    expect(next.action!.id).toBeGreaterThan(old.action!.id);
  });
  it.each([
    [120000, 150000, 120000],
    [150000, 120000, 120000],
    [0, 120000, 120000],
    [120000, 0, 120000],
    [0, 0, 0],
  ])("merges race record %i with %i to %i", (local, server, want) => {
    expect(
      mergeProgress(
        { bestRaceTimeMs: local, lastModified: 200 },
        { bestRaceTimeMs: server, lastModified: 100 },
        200,
        100,
      ).data.bestRaceTimeMs,
    ).toBe(want);
  });
  it.each([
    ["canoe", 9],
    ["boat", 31],
    ["plane", 72],
  ])("displays actual %s speed", (type, mph) =>
    expect(displaySpeedMph(type as string)).toBe(mph),
  );
  it("shares wheel buffers across all 2000 wheels in a supported fleet", () => {
    const first = wheelGeometry(0.38);
    for (let i = 0; i < 2000; i++) {
      expect(wheelGeometry(0.38).tire).toBe(first.tire);
      expect(wheelGeometry(0.38).rim).toBe(first.rim);
    }
    expect(wheelGeometry(0.42).tire).not.toBe(first.tire);
  });
});
describe("optional radio failure isolation", () => {
  it("contains context construction failure", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("device unavailable");
        }
      },
    );
    const unavailable = vi.fn();
    expect(() => startRadio([220], "sine", unavailable)()).not.toThrow();
    expect(unavailable).toHaveBeenCalledOnce();
  });
  it("closes a rejected context and reports unavailable without an unhandled rejection", async () => {
    const close = vi.fn(async () => {});
    vi.stubGlobal(
      "AudioContext",
      class {
        resume = () => Promise.reject(new Error("blocked"));
        close = close;
      },
    );
    const unavailable = vi.fn();
    startRadio([220], "sine", unavailable);
    await vi.waitFor(() => expect(unavailable).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce();
  });
  it("ignores a late resume after unmount", async () => {
    let resume!: () => void;
    const create = vi.fn(),
      close = vi.fn(async () => {});
    vi.stubGlobal(
      "AudioContext",
      class {
        resume = () => new Promise<void>((r) => (resume = r));
        close = close;
        createOscillator = create;
      },
    );
    const unavailable = vi.fn(),
      stop = startRadio([220], "sine", unavailable);
    stop();
    resume();
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
