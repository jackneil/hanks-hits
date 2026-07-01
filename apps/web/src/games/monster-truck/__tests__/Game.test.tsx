import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the heavy 3D components
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({ camera: { position: { copy: vi.fn() }, lookAt: vi.fn() } }),
}));

vi.mock('@react-three/rapier', () => ({
  Physics: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RigidBody: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rapier-rigid-body">{children}</div>
  ),
  CuboidCollider: () => null,
  CylinderCollider: () => null,
  BallCollider: () => null,
  useRapier: () => ({ world: { castRay: () => null } }),
}));

vi.mock('@react-three/drei', () => ({
  Sky: () => null,
  Cloud: () => null,
}));

// We test the store separately, so just test that the Game module loads
describe('Monster Truck Game Module', () => {
  it('exports MonsterTruckGame component', async () => {
    const gameModule = await import('../index');
    expect(gameModule.MonsterTruckGame).toBeDefined();
  });

  it('exports useGameStore hook', async () => {
    const gameModule = await import('../index');
    expect(gameModule.useGameStore).toBeDefined();
  });

  it('keeps physics colliders out of the ambient environment', async () => {
    const { Environment, EnvironmentColliders } = await import('../components/Environment');

    const { unmount } = render(<Environment />);
    expect(screen.queryByTestId('rapier-rigid-body')).not.toBeInTheDocument();
    unmount();

    render(<EnvironmentColliders />);
    expect(screen.getAllByTestId('rapier-rigid-body').length).toBeGreaterThan(0);
  });
});

// Test constants
describe('Game Constants', () => {
  it('defines physics constants', async () => {
    const { PHYSICS } = await import('../lib/constants');
    expect(PHYSICS.TRUCK.CHASSIS_WIDTH).toBeGreaterThan(0);
    expect(PHYSICS.ENGINE.BASE_FORCE).toBeGreaterThan(0);
    expect(PHYSICS.STEERING.MAX_ANGLE).toBeGreaterThan(0);
  });

  it('defines world constants', async () => {
    const { WORLD } = await import('../lib/constants');
    expect(WORLD.SIZE).toBe(500);
    expect(WORLD.SPAWN.POSITION).toHaveLength(3);
  });

  it('defines collectible constants', async () => {
    const { COLLECTIBLES } = await import('../lib/constants');
    expect(COLLECTIBLES.COIN.VALUE).toBe(10);
    expect(COLLECTIBLES.STAR.VALUE).toBe(50);
    expect(COLLECTIBLES.COIN.COUNT).toBeGreaterThan(0);
  });
});

// Test sound manager
describe('Sound Manager', () => {
  it('creates sound manager instance', async () => {
    const { sounds } = await import('../lib/sounds');
    expect(sounds).toBeDefined();
    expect(typeof sounds.playCoin).toBe('function');
    expect(typeof sounds.playStar).toBe('function');
    expect(typeof sounds.playHorn).toBe('function');
  });

  it('can toggle sound enabled', async () => {
    const { sounds } = await import('../lib/sounds');
    sounds.setEnabled(false);
    sounds.setEnabled(true);
    // Should not throw
    expect(true).toBe(true);
  });
});
