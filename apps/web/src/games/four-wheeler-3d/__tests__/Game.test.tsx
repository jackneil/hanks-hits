import { describe, it, expect, vi } from "vitest";

// Mock the heavy 3D stack, the same way the monster-truck test does.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useFrame: vi.fn(),
  useLoader: vi.fn(),
  useThree: (selector?: (state: unknown) => unknown) => {
    const camera = {
      position: { copy: vi.fn(), set: vi.fn() },
      lookAt: vi.fn(),
      updateProjectionMatrix: vi.fn(),
    };
    const state = { camera };
    return selector ? selector(state) : state;
  },
}));

// The vehicle controller the raycast vehicle builds, with every call the
// component makes present and doing nothing.
const vehicleController = {
  addWheel: vi.fn(),
  setWheelSuspensionStiffness: vi.fn(),
  setWheelSuspensionCompression: vi.fn(),
  setWheelSuspensionRelaxation: vi.fn(),
  setWheelMaxSuspensionTravel: vi.fn(),
  setWheelFrictionSlip: vi.fn(),
  setWheelSideFrictionStiffness: vi.fn(),
  setWheelSteering: vi.fn(),
  setWheelEngineForce: vi.fn(),
  setWheelBrake: vi.fn(),
  wheelIsInContact: vi.fn(() => true),
  wheelSuspensionLength: vi.fn(() => 0.3),
  currentVehicleSpeed: vi.fn(() => 0),
  updateVehicle: vi.fn(),
  free: vi.fn(),
};

vi.mock("@react-three/rapier", () => ({
  Physics: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RigidBody: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rapier-rigid-body">{children}</div>
  ),
  CuboidCollider: () => null,
  CylinderCollider: () => null,
  BallCollider: () => null,
  HeightfieldCollider: () => null,
  useBeforePhysicsStep: vi.fn(),
  useAfterPhysicsStep: vi.fn(),
  useRapier: () => ({
    world: {
      castRay: () => null,
      createVehicleController: () => vehicleController,
      removeVehicleController: vi.fn(),
    },
    rapier: {
      Ray: class {
        origin: { x: number; y: number; z: number };
        dir: { x: number; y: number; z: number };
        constructor(
          origin: { x: number; y: number; z: number },
          dir: { x: number; y: number; z: number }
        ) {
          this.origin = origin;
          this.dir = dir;
        }
      },
      QueryFilterFlags: { EXCLUDE_DYNAMIC: 2 },
    },
  }),
}));

vi.mock("@react-three/drei", () => ({
  Sky: () => null,
  Stars: () => null,
  Cloud: () => null,
}));

describe("Four-Wheeler Adventure 3D module", () => {
  it("exports the game component", async () => {
    const gameModule = await import("../index");
    expect(gameModule.FourWheeler3dGame).toBeDefined();
    expect(gameModule.default).toBeDefined();
  }, 30_000);

  it("exports the store", async () => {
    const gameModule = await import("../index");
    expect(gameModule.useFourWheeler3dStore).toBeDefined();
  }, 30_000);

  it("exports the game shell", async () => {
    const shell = await import("../GameShell");
    expect(shell.default).toBeDefined();
  }, 30_000);

  it("registers itself on the home page with plain literals", async () => {
    const { metadata } = await import("../metadata");
    expect(metadata.id).toBe("four-wheeler-3d");
    expect(metadata.name).toBe("Four-Wheeler Adventure 3D");
    expect(metadata.category).toBe("racing");
    expect(metadata.madeByKid).toBe(true);
  });

  it("exports the world scene and its clock badge", async () => {
    const world = await import("../components/World");
    expect(world.World).toBeDefined();
    const badge = await import("../components/hud/ClockBadge");
    expect(badge.ClockBadge).toBeDefined();
  }, 30_000);

  it("keeps the world constants the design doc specifies", async () => {
    const { WORLD, SCALE, DAY_MINUTES } = await import("../lib/constants");
    expect(WORLD.SIZE).toBe(4000);
    expect(WORLD.CHUNK * WORLD.CHUNKS).toBeGreaterThanOrEqual(WORLD.SIZE);
    expect(SCALE.POS).toBeCloseTo(1 / 18, 6);
    expect(SCALE.SPEED).toBe(0.38);
    expect(DAY_MINUTES).toBe(24);
  });

  it("documents the streaming budget in constants", async () => {
    const { CHUNK_SEGMENTS, CHUNK_VIEW_RADIUS, TREE_LOD_DISTANCE } =
      await import("../lib/constants");
    expect(CHUNK_SEGMENTS).toBe(32);
    // A radius of 3 is the 7 x 7 window the design doc budgets for.
    expect((CHUNK_VIEW_RADIUS * 2 + 1) ** 2).toBe(49);
    expect(TREE_LOD_DISTANCE).toBe(200);
  });
  it("exports the ride, the camera and the effects", async () => {
    const vehicle = await import("../components/Vehicle");
    expect(vehicle.Vehicle).toBeDefined();
    const camera = await import("../components/ChaseCamera");
    expect(camera.ChaseCamera).toBeDefined();
    const effects = await import("../components/Effects");
    expect(effects.Effects).toBeDefined();
  }, 30_000);

  it("exports the speedometer and the phone controls", async () => {
    const speedo = await import("../components/hud/Speedo");
    expect(speedo.Speedo).toBeDefined();
    const mobile = await import("../components/MobileControls");
    expect(mobile.MobileControls).toBeDefined();
  }, 30_000);

  it("draws a body for the quad and for every other vehicle", async () => {
    const models = await import("../components/models");
    expect(models.VehicleModel).toBeTypeOf("function");
    expect(models.AtvModel).toBeTypeOf("function");
    expect(models.GenericVehicleModel).toBeTypeOf("function");
  }, 30_000);

  it("gives the boost the three seconds the 2D game gives it", async () => {
    const { NOS_SECONDS, useFourWheeler3dStore } = await import("../lib/store");
    expect(NOS_SECONDS).toBe(3);
    const store = useFourWheeler3dStore.getState();
    store.clearNos();
    expect(store.startNos()).toBe(true);
    // A second press while it is running does nothing.
    expect(useFourWheeler3dStore.getState().startNos()).toBe(false);
    useFourWheeler3dStore.getState().clearNos();
    expect(useFourWheeler3dStore.getState().nosUntil).toBe(0);
  });
});
