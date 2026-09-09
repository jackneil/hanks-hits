import { describe, it, expect } from "vitest";
import {
  CAMERA_PRESETS,
  DEFAULT_CAMERA_PRESET,
  advanceOrbit,
  cameraPreset,
  createOrbit,
  cycleCameraPreset,
  dragOrbit,
  presetCameraTarget,
  zoomOrbit,
} from "../lib/cameraPresets";
const target = () => ({ x: 0, y: 0, z: 0 });
describe("the complete original camera catalog", () => {
  it("retains all ten original view names and zoom strengths, with a comfortable 3D default", () => {
    expect(CAMERA_PRESETS.map((p) => p.name)).toEqual([
      "Top-Down",
      "Close",
      "Far",
      "Bird's Eye",
      "Oblique",
      "Low Angle",
      "Cinematic",
      "Action",
      "Wide",
      "Super Zoom",
    ]);
    expect(CAMERA_PRESETS.map((p) => p.zoom)).toEqual([
      1, 1.5, 0.7, 0.5, 1.1, 1.4, 0.9, 1.7, 0.6, 2,
    ]);
    expect(cameraPreset(DEFAULT_CAMERA_PRESET).name).toBe("Oblique");
  });
  it("cycles every view once and wraps, including malformed older session indices", () => {
    let index = 0;
    const visited = [];
    for (let i = 0; i < 10; i++) {
      visited.push(index);
      index = cycleCameraPreset(index);
    }
    expect(new Set(visited).size).toBe(10);
    expect(index).toBe(0);
    expect(cycleCameraPreset(-1)).toBe(0);
    expect(cameraPreset(NaN)).toEqual(CAMERA_PRESETS[4]);
  });
  it.each(CAMERA_PRESETS.map((p, i) => [p.name, i] as const))(
    "%s remains finite above the rider and scales out for large transports",
    (_, index) => {
      const point = { x: 30, y: 2, z: -20 },
        small = presetCameraTarget(
          point,
          0,
          1.9,
          index,
          createOrbit(),
          target(),
        ),
        large = presetCameraTarget(
          point,
          0,
          30,
          index,
          createOrbit(),
          target(),
        );
      expect(small.y).toBeGreaterThan(point.y);
      expect(Object.values(small).every(Number.isFinite)).toBe(true);
      expect(
        Math.hypot(large.x - point.x, large.y - point.y, large.z - point.z),
      ).toBeGreaterThan(
        Math.hypot(small.x - point.x, small.y - point.y, small.z - point.z),
      );
    },
  );
  it("keeps the camera behind +Z forward and behind +X after a rider-right turn", () => {
    const p = { x: 0, y: 0, z: 0 };
    const straight = presetCameraTarget(p, 0, 1.9, 4, createOrbit(), target()),
      right = presetCameraTarget(
        p,
        Math.PI / 2,
        1.9,
        4,
        createOrbit(),
        target(),
      );
    expect(straight.z).toBeLessThan(0);
    expect(right.x).toBeLessThan(0);
    expect(Math.abs(right.z)).toBeLessThan(0.00001);
    expect(right.y).toBeCloseTo(straight.y);
  });
});
describe("direct camera manipulation", () => {
  it("moves toward rider-right while dragging right without changing the player's heading", () => {
    const o = createOrbit();
    dragOrbit(o, 100, 0, 1000, 800, 0.016, 4);
    const p = presetCameraTarget({ x: 0, y: 0, z: 0 }, 0, 1.9, 4, o, target());
    expect(p.x).toBeGreaterThan(0);
  });
  it("keeps a re-grabbed camera exactly under the pointer and never integrates its old release momentum", () => {
    const o = createOrbit();
    o.dragging = true;
    o.velocityYaw = 2;
    const yaw = o.yaw;
    advanceOrbit(o, 0.1, false, 4);
    expect(o.yaw).toBe(yaw);
  });
  it("decelerates consistently at 30 and120fps and disables inertia for reduced motion", () => {
    const slow = createOrbit(),
      fast = createOrbit();
    slow.velocityYaw = fast.velocityYaw = 2;
    for (let i = 0; i < 30; i++) advanceOrbit(slow, 1 / 30, false, 4);
    for (let i = 0; i < 120; i++) advanceOrbit(fast, 1 / 120, false, 4);
    expect(slow.yaw).toBeCloseTo(fast.yaw, 4);
    const prior = fast.yaw;
    fast.velocityYaw = 3;
    advanceOrbit(fast, 0.1, true, 4);
    expect(fast.yaw).toBe(prior);
    expect(fast.velocityYaw).toBe(0);
  });
  it("clamps vertical drags and zoom to usable finite limits", () => {
    const o = createOrbit();
    dragOrbit(o, 0, -100000, 1000, 500, 0.01, 0);
    expect(o.pitch + cameraPreset(0).pitch).toBeLessThanOrEqual(1.49);
    for (let i = 0; i < 100; i++) zoomOrbit(o, 500);
    expect(o.zoom).toBe(3);
    for (let i = 0; i < 100; i++) zoomOrbit(o, -500);
    expect(o.zoom).toBe(0.55);
  });
});
