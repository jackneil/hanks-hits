import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

async function hydratedStore() {
  const { useGameStore: store } = await import('../lib/store');
  const { ownerBoundProgress: authority } = await import('@/lib/owner-bound-progress');
  const key = 'monster-truck-save';
  await authority.updateSession('unauthenticated');
  await authority.whenHydrated(key);
  store.setState({});
  const writes = vi.spyOn(localStorage, 'setItem');
  const saved = () => JSON.parse(authority.readScoped(key)!).state;
  return { store, writes, saved };
}

describe('Monster Truck durable progress', () => {
  it.each([60, 120])('does not save unchanged progress during %i airtime updates', async (frames) => {
    const { store, writes, saved } = await hydratedStore();
    const before = saved();
    for (let frame = 0; frame < frames; frame++) store.getState().addAirtime(1 / frames);
    expect(store.getState().sessionAirtime).toBeCloseTo(1);
    expect(saved()).toEqual(before);
    expect(writes).not.toHaveBeenCalled();
  });

  it('keeps destruction and flip counters transient until their challenge completes', async () => {
    const { store, writes, saved } = await hydratedStore();
    const before = saved();
    for (let count = 0; count < 19; count++) store.getState().addDestruction();
    for (let count = 0; count < 4; count++) store.getState().addFlip();
    expect(store.getState().sessionDestructions).toBe(19);
    expect(store.getState().sessionFlips).toBe(4);
    expect(saved()).toEqual(before);
    expect(writes).not.toHaveBeenCalled();
  });

  it('saves the challenge and reward once, survives hydration, and never rewards it twice', async () => {
    const { store, writes, saved } = await hydratedStore();
    store.getState().addAirtime(10);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(saved().coins).toBe(500);
    expect(saved().totalCoinsEarned).toBe(500);
    expect(saved().challenges.find((challenge: { id: string }) => challenge.id === 'airtime-10').completed).toBe(true);
    const completed = saved();
    // Reconstruct a fresh store from the saved bytes, as on a new page load.
    vi.resetModules();
    const { useGameStore: reloaded } = await import('../lib/store');
    const { ownerBoundProgress: freshAuthority } = await import('@/lib/owner-bound-progress');
    expect(reloaded.getState().coins).toBe(0);
    await freshAuthority.updateSession('unauthenticated');
    await freshAuthority.whenHydrated('monster-truck-save');
    expect(reloaded.getState().coins).toBe(500);
    expect(reloaded.getState().challenges.find((challenge) => challenge.id === 'airtime-10')?.completed).toBe(true);
    // The adapter primes its cache with the first save after hydration.
    reloaded.setState({});
    writes.mockClear();
    for (let frame = 0; frame < 120; frame++) reloaded.getState().addAirtime(1 / 120);
    expect(reloaded.getState().coins).toBe(500);
    expect(saved()).toEqual(completed);
    expect(writes).not.toHaveBeenCalled();
  });

  it('persists a zero-reward completion', async () => {
    const { store, writes, saved } = await hydratedStore();
    store.setState({ challenges: store.getState().challenges.map((challenge) => (
      challenge.id === 'airtime-10' ? { ...challenge, reward: 0 } : challenge
    )) });
    writes.mockClear();
    store.getState().addAirtime(10);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(saved().coins).toBe(0);
    expect(saved().challenges.find((challenge: { id: string }) => challenge.id === 'airtime-10').completed).toBe(true);
  });
});
