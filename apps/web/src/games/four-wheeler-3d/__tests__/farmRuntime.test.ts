import { afterEach, describe, expect, it } from "vitest";
import {
  advanceFarmPose,
  boundsForHorse,
  cowBounds,
  cowPoses,
  createCowHerd,
  createFarmPose,
  flushFarmPoses,
  horseBounds,
  horsePoses,
  horseWithPose,
  liveHorsePosition,
  nearestCow,
  nearestHorse,
  registerFarmFlush,
} from "../lib/farmRuntime";
import type { Horse } from "../lib/adventureTypes";
import { defaultProgress } from "../lib/store";
import { PROGRESS_SCHEMAS } from "@/lib/progress-schemas";

afterEach(() => horsePoses.clear());
describe("farm movement", () => {
  it("keeps five independently walking cows within their corral over ten simulated minutes", () => {
    const herd = createCowHerd(),
      start = herd.map((c) => ({ ...c.position }));
    for (let i = 0; i < 18000; i++)
      for (const cow of herd) {
        advanceFarmPose(cow, 1 / 30, herd);
        const { x, z } = cow.position;
        if (!(
          x >= cowBounds.minX &&
          x <= cowBounds.maxX &&
          z >= cowBounds.minZ &&
          z <= cowBounds.maxZ
        ))
          throw new Error(
            `Cow ${cow.id} left its corral at frame ${i}: ${x}, ${z}`,
          );
      }
    expect(herd).toHaveLength(5);
    herd.forEach((cow, i) => {
      expect(cow.distance).toBeGreaterThan(10);
      expect(cow.position).not.toEqual(start[i]);
    });
  });
  it("turns a horse smoothly and stays within its corral", () => {
    const horse = createFarmPose("horse-1", "horse", { x: -480, y: 2, z: -65 });
    horse.rest = 0;
    horse.target = { x: -475, z: -65 };
    advanceFarmPose(horse, 0.1);
    expect(horse.heading).toBeGreaterThan(0);
    expect(horse.heading).toBeLessThanOrEqual(0.12);
    for (let i = 0; i < 6000; i++) advanceFarmPose(horse, 0.1);
    expect(horse.position.x).toBeGreaterThanOrEqual(horseBounds.minX);
    expect(horse.position.x).toBeLessThanOrEqual(horseBounds.maxX);
    expect(horse.position.z).toBeGreaterThanOrEqual(horseBounds.minZ);
    expect(horse.position.z).toBeLessThanOrEqual(horseBounds.maxZ);
    expect(horse.distance).toBeGreaterThan(10);
  });
  it("holds the milking cow still and stops its walking gait", () => {
    const cow = createCowHerd()[0];
    cow.rest = 0;
    cow.speed = 0.4;
    const before = { ...cow.position };
    for (let i = 0; i < 300; i++) advanceFarmPose(cow, 1 / 30, [], true);
    expect(cow.position).toEqual(before);
    expect(cow.distance).toBe(0);
    expect(cow.speed).toBe(0);
  });
  it("preserves a horse left away from the farm instead of snapping it back", () => {
    const position = { x: 780, y: 14, z: 810 },
      horse = createFarmPose("horse-1", "horse", position);
    expect(boundsForHorse(position)).toEqual({
      minX: 776,
      maxX: 784,
      minZ: 806,
      maxZ: 814,
    });
    for (let i = 0; i < 6000; i++) advanceFarmPose(horse, 0.1);
    expect(horse.position.x).toBeGreaterThanOrEqual(776);
    expect(horse.position.z).toBeGreaterThanOrEqual(806);
  });
  it("does not advance with a zero frame and clamps a tab-resume delta", () => {
    const cow = createCowHerd()[0],
      before = JSON.stringify(cow);
    advanceFarmPose(cow, 0);
    expect(JSON.stringify(cow)).toBe(before);
    cow.rest = 0;
    cow.target = { x: cow.position.x + 4, z: cow.position.z };
    advanceFarmPose(cow, 60);
    expect(cow.distance).toBeLessThan(0.1);
  });
});
describe("live farm interactions", () => {
  it("finds the visible horse while retaining the latest saddle and paint", () => {
    const saved: Horse = {
      id: "horse-1",
      position: { x: 0, y: 0, z: 0 },
      heading: 0,
      color: "brown",
      saddle: "gold",
    };
    const live = createFarmPose(
      saved.id,
      "horse",
      { x: 100, y: 3, z: 100 },
      1.2,
    );
    horsePoses.set(saved.id, live);
    expect(nearestHorse({ x: 100, z: 101 }, [saved])).toEqual({
      ...saved,
      position: live.position,
      heading: 1.2,
    });
    expect(nearestHorse({ x: 0, z: 0 }, [saved])).toBeNull();
    const copy = liveHorsePosition(saved.id)!;
    copy.x = 0;
    expect(live.position.x).toBe(100);
  });
  it("finds nearby cows only and provides the actual world pose", () => {
    const cow = Array.from(cowPoses.values())[0];
    expect(nearestCow(cow.position, 0.1)?.id).toBe(cow.id);
    expect(nearestCow({ x: 1000, z: 1000 })).toBeNull();
  });
  it("flushes only the mounted farm callback and removes it on cleanup", () => {
    let first = 0,
      second = 0;
    const removeFirst = registerFarmFlush(() => first++),
      removeSecond = registerFarmFlush(() => second++);
    removeFirst();
    flushFarmPoses();
    expect(first).toBe(0);
    expect(second).toBe(1);
    removeSecond();
    flushFarmPoses();
    expect(second).toBe(1);
  });
});

describe("strict farm save boundaries", () => {
  it("accepts a rich rider snapshot without leaking runtime keys into the full save", () => {
    const progress = structuredClone(defaultProgress),
      horse = progress.adventure.horses[0];
    const rich = {
      x: -480,
      y: 2,
      z: -65,
      heading: 1.2,
      speed: 8,
      grounded: true,
    };
    const pose = createFarmPose(horse.id, "horse", rich, rich.heading);
    expect(pose.position).toEqual({ x: rich.x, y: rich.y, z: rich.z });
    // Also guard callers that directly update a live pose from a richer runtime source.
    pose.position = rich;
    horsePoses.set(horse.id, pose);
    const snapshots = [
      horseWithPose(horse, pose),
      nearestHorse(rich, [horse])!,
      { ...horse, position: liveHorsePosition(horse.id)! },
    ];
    horsePoses.clear();
    snapshots.push(nearestHorse(rich, [{ ...horse, position: rich }])!);
    for (const saved of snapshots) {
      progress.adventure.horses[0] = saved;
      expect(Object.keys(saved.position).sort()).toEqual(["x", "y", "z"]);
      expect(
        PROGRESS_SCHEMAS["four-wheeler-3d"]!.safeParse(
          JSON.parse(JSON.stringify(progress)),
        ).success,
      ).toBe(true);
    }
  });
});
