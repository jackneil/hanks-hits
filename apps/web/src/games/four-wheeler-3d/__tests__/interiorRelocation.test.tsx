import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as THREE from "three";
const runtime = vi.hoisted(() => ({
  frames: [] as Array<(state: unknown, dt: number) => void>,
  physics: () => {},
  position: { x: 0, y: 2000.8, z: 0.5 },
  context: null as unknown,
}));
vi.mock("@react-three/fiber", () => ({
  useFrame: (fn: (state: unknown, dt: number) => void) => {
    runtime.frames.push(fn);
  },
  useThree: (select: (s: unknown) => unknown) => select({ gl: {} }),
}));
vi.mock("../lib/gameContext", () => ({
  useGameContext: () => runtime.context,
}));
vi.mock("@react-three/rapier", async () => {
  const React = await import("react");
  const body = {
    translation: () => runtime.position,
    setTranslation: (p: { x: number; y: number; z: number }) => {
      runtime.position = { ...p };
    },
    setNextKinematicTranslation: (p: { x: number; y: number; z: number }) => {
      runtime.position = { ...p };
    },
    setNextKinematicRotation: () => {},
  };
  const controller = {
    enableAutostep: () => {},
    enableSnapToGround: () => {},
    setMaxSlopeClimbAngle: () => {},
    setMinSlopeSlideAngle: () => {},
    computeColliderMovement: () => {},
    computedMovement: () => ({ x: 0, y: 0, z: 0 }),
    computedGrounded: () => true,
  };
  const world = {
    timestep: 1 / 60,
    createCharacterController: () => controller,
    removeCharacterController: () => {},
  };
  return {
    useRapier: () => ({
      world,
      rapier: { QueryFilterFlags: { EXCLUDE_SENSORS: 1 } },
    }),
    useBeforePhysicsStep: (fn: () => void) => {
      runtime.physics = fn;
    },
    RigidBody: React.forwardRef(function MockRigidBody(
      { children }: { children: React.ReactNode },
      ref,
    ) {
      React.useImperativeHandle(ref, () => body);
      return React.Children.toArray(children)[0];
    }),
    CapsuleCollider: React.forwardRef(
      function MockCapsuleCollider(_props, ref) {
        React.useImperativeHandle(ref, () => ({}));
        return null;
      },
    ),
    CuboidCollider: () => null,
  };
});
import { Player } from "../components/Player";
import {
  AdventureRuntime,
  interact,
  saveRiderPosition,
} from "../components/AdventureRuntime";
import { enterInterior, leaveInterior } from "../components/HomeLife";
import { defaultProgress, useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import type { GameControls } from "../hooks/useControls";
import { NEUTRAL } from "../lib/controls";
import { PLAYER_HALF_HEIGHT } from "../lib/foot";
import { createRailSession, RAIL_BOARD_RANGE } from "../lib/rail";
const controls = {
  takeOneShot: () => false,
  getControlValues: () => NEUTRAL,
} as unknown as GameControls;
const outside = { x: -485, y: 2.1, z: 6, heading: 0, speed: 0 };
beforeEach(() => {
  runtime.frames = [];
  runtime.position = { x: 0, y: 2000.02 + PLAYER_HALF_HEIGHT, z: 0.5 };
  runtime.context = {
    playerPos: { current: new THREE.Vector3(0, 2000.02, 0.5) },
    playerQuat: { current: new THREE.Quaternion() },
    playerSpeedRef: { current: 0 },
  };
  useAdventureSession.getState().reset();
  useAdventureSession.setState({ playerSnapshot: { ...outside } });
  useFourWheeler3dStore.setState({
    progress: structuredClone(defaultProgress),
    hasStarted: true,
    isPaused: false,
    mode: "foot",
  });
});
afterEach(() => cleanup());
it("boards the nearby moving train through the shared Use action, with a vertical range guard", () => {
  const rail = createRailSession();
  const context = runtime.context as { playerPos: { current: THREE.Vector3 } };
  context.playerPos.current.set(
    rail.position.x,
    rail.position.y + 2,
    rail.position.z + 3,
  );
  useFourWheeler3dStore
    .getState()
    .updateProgress((p) => ({
      ...p,
      adventure: { ...p.adventure, trainOwned: true },
    }));
  useAdventureSession.setState({ rail });
  render(<AdventureRuntime controls={controls} />);
  act(() => runtime.frames[0]({ camera: new THREE.PerspectiveCamera() }, 0.1));
  expect(useAdventureSession.getState().interaction?.kind).toBe("live-train");
  act(() => interact());
  expect(useAdventureSession.getState().action?.name).toBe("rail:board");
  context.playerPos.current.y = rail.position.y + RAIL_BOARD_RANGE + 1;
  act(() => runtime.frames[0]({ camera: new THREE.PerspectiveCamera() }, 0.1));
  expect(useAdventureSession.getState().interaction?.kind).not.toBe(
    "live-train",
  );
});
describe("interior exit between render and physics", () => {
  it.each(["immediate", "old render first"])(
    "saves the outdoor target when paused %s, then resumes normal walking",
    (timing) => {
      enterInterior("house", "house");
      render(
        <>
          <Player controls={controls} />
          <AdventureRuntime controls={controls} />
        </>,
      );
      // Entry is applied once. Exit is then requested while Rapier still holds the indoor body.
      act(() => runtime.physics());
      act(() => leaveInterior());
      const target = useAdventureSession.getState().relocation!.position;
      const playerFrame = runtime.frames[0],
        worldFrame = runtime.frames[1],
        state = { camera: new THREE.PerspectiveCamera() };
      act(() => {
        if (timing === "old render first") {
          worldFrame(state, 0.1);
          playerFrame(state, 0.1);
          worldFrame(state, 0.1);
        }
        useFourWheeler3dStore.getState().setPaused(true);
      });
      expect(
        useFourWheeler3dStore.getState().progress.adventure.rider?.position.x,
      ).toBe(target.x);
      expect(
        useFourWheeler3dStore.getState().progress.adventure.rider?.position.z,
      ).toBe(target.z);
      expect(
        useFourWheeler3dStore.getState().progress.adventure.rider?.position.y,
      ).toBeLessThan(100);
      act(() => {
        useFourWheeler3dStore.getState().setPaused(false);
        runtime.physics();
        playerFrame(state, 0.1);
        worldFrame(state, 0.1);
      });
      runtime.position.x += 3;
      act(() => {
        playerFrame(state, 0.1);
        worldFrame(state, 0.1);
        saveRiderPosition();
      });
      expect(
        useFourWheeler3dStore.getState().progress.adventure.rider?.position.x,
      ).toBe(target.x + 3);
    },
  );
});
