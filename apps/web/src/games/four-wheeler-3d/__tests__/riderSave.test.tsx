import { afterEach, describe, expect, it, vi } from "vitest";

// AdventureRuntime is a scene component: keep three.js out of the test.
vi.mock("@react-three/fiber", () => ({ useFrame: vi.fn(), useThree: vi.fn() }));

import { saveRiderPosition } from "../components/AdventureRuntime";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { syncedStore } from "@/__tests__/synced-stores";

/**
 * The rider's place saves on pagehide and on pause. Before the ride starts
 * nothing moved: a save there wrote the session's start place into an
 * untouched world and stamped it, so the untouched world replaced the
 * account's world at the next sign-in (review wave 3 of #26i; the old code's
 * save is in fixtures/legacy-saves.json as "automatic").
 */
describe("four-wheeler-3d: the rider save", () => {
  afterEach(() => syncedStore("four-wheeler-3d").reset());

  it("saves nothing before the ride starts, so an untouched world stays untouched", () => {
    syncedStore("four-wheeler-3d").reset();
    const before = useFourWheeler3dStore.getState().progress;
    saveRiderPosition();
    expect(useFourWheeler3dStore.getState().progress).toBe(before);
    expect(useFourWheeler3dStore.getState().progress.lastModified).toBe(0);
  });

  it("saves the rider's new place during a ride, with a new time", () => {
    syncedStore("four-wheeler-3d").reset();
    useFourWheeler3dStore.getState().setHasStarted(true);
    useAdventureSession.setState({ playerSnapshot: { x: -380, y: 3, z: 40, heading: 1, speed: 0 } });
    saveRiderPosition();
    const progress = useFourWheeler3dStore.getState().progress;
    expect(progress.adventure.rider?.position.x).toBe(-380);
    expect(progress.lastModified).toBeGreaterThan(0);
  });

  it("keeps the time when the rider did not move since the last save", () => {
    syncedStore("four-wheeler-3d").reset();
    useFourWheeler3dStore.getState().setHasStarted(true);
    useAdventureSession.setState({ playerSnapshot: { x: -380, y: 3, z: 40, heading: 1, speed: 0 } });
    saveRiderPosition();
    useFourWheeler3dStore.getState().setProgress({ ...useFourWheeler3dStore.getState().progress, lastModified: 5 });
    useFourWheeler3dStore.getState().setHasStarted(true);
    useAdventureSession.setState({ playerSnapshot: { x: -380, y: 3, z: 40, heading: 1, speed: 0 } });
    saveRiderPosition();
    expect(useFourWheeler3dStore.getState().progress.lastModified).toBe(5);
  });
});
