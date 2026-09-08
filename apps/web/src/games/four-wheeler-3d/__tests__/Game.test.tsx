import { describe, it, expect, vi } from "vitest";

// Mock the heavy 3D stack, the same way the monster-truck test does.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({ camera: { position: { copy: vi.fn() }, lookAt: vi.fn() } }),
}));

vi.mock("@react-three/rapier", () => ({
  Physics: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RigidBody: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rapier-rigid-body">{children}</div>
  ),
  CuboidCollider: () => null,
  CylinderCollider: () => null,
  BallCollider: () => null,
  HeightfieldCollider: () => null,
  useRapier: () => ({ world: { castRay: () => null } }),
}));

vi.mock("@react-three/drei", () => ({
  Sky: () => null,
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

  it("keeps the world constants the design doc specifies", async () => {
    const { WORLD, SCALE, DAY_MINUTES } = await import("../lib/constants");
    expect(WORLD.SIZE).toBe(4000);
    expect(WORLD.CHUNK * WORLD.CHUNKS).toBeGreaterThanOrEqual(WORLD.SIZE);
    expect(SCALE.POS).toBeCloseTo(1 / 18, 6);
    expect(SCALE.SPEED).toBe(0.38);
    expect(DAY_MINUTES).toBe(24);
  });
});
