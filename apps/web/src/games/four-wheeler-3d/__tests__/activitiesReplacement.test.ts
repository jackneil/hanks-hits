import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import * as THREE from "three";
const frame = vi.hoisted(() => ({
  callback: (_state: unknown, _dt: number) => {
    void _state;
    void _dt;
  },
}));
vi.mock("@react-three/fiber", () => ({
  useFrame: (callback: typeof frame.callback) => {
    frame.callback = callback;
  },
}));
vi.mock("../lib/gameContext", () => ({
  useGameContext: () => ({
    playerPos: { current: new THREE.Vector3(500, 2, 500) },
    playerQuat: { current: new THREE.Quaternion() },
    playerSpeedRef: { current: 5 },
  }),
}));
import { useActivitiesRuntime } from "../components/Activities";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import {
  trailerTransforms,
  useActivitiesSession,
  resetActivitiesSession,
} from "../lib/activitiesSession";
import { createAdventureProgress } from "../lib/adventureTypes";
afterEach(() => {
  cleanup();
  resetActivitiesSession();
  useAdventureSession.getState().reset();
});
describe("activity save replacement", () => {
  it.each([4, 40])(
    "discards cached towing and mowing before loading nextId=%i and changing mode",
    (nextId) => {
      const adventure = createAdventureProgress();
      adventure.nextId = 4;
      adventure.activities.mowerOn = true;
      adventure.fleet["starter-atv"].position = { x: 500, y: 2, z: 500 };
      adventure.fleet["starter-atv"].hitch = "starter-trailer";
      adventure.fleet["starter-trailer"].type = "mower";
      adventure.fleet["starter-trailer"].position = { x: 500, y: 2, z: 496 };
      useFourWheeler3dStore.getState().setProgress({
        ...useFourWheeler3dStore.getState().progress,
        adventure,
      });
      useFourWheeler3dStore.setState({
        hasStarted: true,
        isPaused: false,
        mode: "vehicle",
      });
      useAdventureSession.setState({ panel: null });
      renderHook(() => useActivitiesRuntime());
      act(() => {
        for (let i = 0; i < 8; i++) frame.callback({}, 0.1);
      });
      expect(trailerTransforms.size).toBe(1);
      expect(useActivitiesSession.getState().liveActivities).not.toBeNull();
      const replacement = structuredClone(
        useFourWheeler3dStore.getState().progress,
      );
      replacement.adventure.nextId = nextId;
      replacement.adventure.fleet["starter-trailer"].position = {
        x: 777,
        y: 9,
        z: 888,
      };
      replacement.adventure.fleet["starter-trailer"].mud = 0.17;
      replacement.adventure.activities = {
        ...replacement.adventure.activities,
        cutGrass: {},
        plowLoad: 2,
        goals: 7,
        brokenProps: ["cloud-tree"],
      };
      act(() => {
        useFourWheeler3dStore.getState().setProgress(replacement);
        useFourWheeler3dStore.getState().setMode("foot");
        for (let i = 0; i < 60; i++) frame.callback({}, 0.1);
      });
      const result = useFourWheeler3dStore.getState().progress.adventure;
      expect(trailerTransforms.size).toBe(0);
      expect(result.fleet["starter-trailer"].position).toEqual({
        x: 777,
        y: 9,
        z: 888,
      });
      expect(result.fleet["starter-trailer"].mud).toBe(0.17);
      expect(result.activities).toMatchObject({
        cutGrass: {},
        plowLoad: 2,
        goals: 7,
        brokenProps: ["cloud-tree"],
      });
    },
  );
});
