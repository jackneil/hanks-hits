import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { resetWebGLSupportCache } from '@/shared/components/WebGLGate';

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
  HeightfieldCollider: () => null,
  ConvexHullCollider: () => null,
  useRapier: () => ({ world: { castRay: () => null } }),
}));

vi.mock('@react-three/drei', () => ({
  Sky: () => null,
  Cloud: () => null,
}));

// We test the store separately, so just test that the Game module loads.
// The first import pulls the whole three.js/R3F chain, which legitimately
// exceeds vitest's default 5s under full-suite parallel load — this was the
// suite's one documented flake, so the import tests get a generous timeout.
describe('Monster Truck Game Module', () => {
  it('exports MonsterTruckGame component', async () => {
    const gameModule = await import('../index');
    expect(gameModule.MonsterTruckGame).toBeDefined();
  }, 30_000);

  it('exports useGameStore hook', async () => {
    const gameModule = await import('../index');
    expect(gameModule.useGameStore).toBeDefined();
  }, 30_000);

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

// ============================================================================
// START MOMENT
// ============================================================================

/**
 * The 1.5s LoadingScreen used to dismiss itself, so nobody ever started the
 * game. The shared overlay is now a real start moment: it waits for Play, and
 * the 3D world loads behind it.
 */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('Monster Truck start overlay', () => {
  beforeEach(() => {
    resetWebGLSupportCache();
    // jsdom creates no WebGL context, and WebGLGate would then render its
    // fallback instead of the scene (and the overlay inside it).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as never
    );
  });

  afterEach(() => {
    cleanup();
    mockPointer(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetWebGLSupportCache();
  });

  it('renders the shared overlay with the title exactly once', async () => {
    const { MonsterTruckGame } = await import('../Game');
    render(<MonsterTruckGame />);

    expect(screen.getByTestId('game-start-overlay')).toBeInTheDocument();
    expect(screen.getAllByText('Monster Truck Mayhem')).toHaveLength(1);
  }, 30_000);

  it('shows the touch instructions, tilt included, on a coarse pointer', async () => {
    mockPointer(true);
    const { MonsterTruckGame } = await import('../Game');
    render(<MonsterTruckGame />);

    expect(screen.getByText('📱 Tilt your phone to steer')).toBeInTheDocument();
    expect(
      screen.getByText('🦶 Tap GAS to go, BRAKE to stop')
    ).toBeInTheDocument();
    expect(screen.getByText('📣 Tap the horn!')).toBeInTheDocument();
    expect(
      screen.queryByText('🦶 Press W or the up arrow to go')
    ).not.toBeInTheDocument();
  }, 30_000);

  it('never dismisses itself on a timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { MonsterTruckGame } = await import('../Game');
    render(<MonsterTruckGame />);

    vi.advanceTimersByTime(2000);

    expect(screen.getByTestId('game-start-overlay')).toBeInTheDocument();
  }, 30_000);

  it('starts the game once and hides the overlay on Play', async () => {
    const { MonsterTruckGame } = await import('../Game');
    render(<MonsterTruckGame />);

    const play = screen.getByRole('button', { name: /Play/ });
    fireEvent.click(play);
    fireEvent.click(play);

    expect(screen.queryByTestId('game-start-overlay')).toBeNull();
    expect(screen.getAllByTestId('r3f-canvas')).toHaveLength(1);
  }, 30_000);
});
