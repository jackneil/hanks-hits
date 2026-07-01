import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, type Challenge } from '../lib/store';

// Default trucks to reset - must match store defaults
const defaultTrucks = [
  { id: 'mud-crusher', name: 'Mud Crusher', cost: 0, description: '', baseStats: { engine: 1, suspension: 1, tires: 1, nos: 1 }, color: '#e74c3c', unlocked: true },
  { id: 'big-red', name: 'Big Red', cost: 2000, description: '', baseStats: { engine: 1.25, suspension: 1, tires: 1, nos: 1 }, color: '#c0392b', unlocked: false },
  { id: 'bouncy-boy', name: 'Bouncy Boy', cost: 3500, description: '', baseStats: { engine: 1, suspension: 1.5, tires: 1, nos: 1 }, color: '#27ae60', unlocked: false },
  { id: 'grip-king', name: 'Grip King', cost: 5000, description: '', baseStats: { engine: 1, suspension: 1, tires: 1.4, nos: 1 }, color: '#3498db', unlocked: false },
  { id: 'speed-demon', name: 'Speed Demon', cost: 8000, description: '', baseStats: { engine: 1.5, suspension: 0.9, tires: 1.1, nos: 1.2 }, color: '#9b59b6', unlocked: false },
  { id: 'the-beast', name: 'The Beast', cost: 15000, description: '', baseStats: { engine: 1.3, suspension: 1.3, tires: 1.3, nos: 1.3 }, color: '#f39c12', unlocked: false },
];

const defaultChallenges: Challenge[] = [
  { id: 'collect-10-stars', name: 'Star Collector', description: 'Collect 10 stars', type: 'collection', target: 10, reward: 300, completed: false },
  { id: 'airtime-10', name: 'Hang Time', description: 'Get 10 seconds of airtime', type: 'stunt', target: 10, reward: 500, completed: false },
  { id: 'smash-20', name: 'Demolition Derby', description: 'Smash 20 objects', type: 'destruction', target: 20, reward: 350, completed: false },
  { id: 'collect-500', name: 'Coin Hunter', description: 'Collect 500 coins', type: 'collection', target: 500, reward: 400, completed: false },
  { id: 'flip-5', name: 'Flipmaster', description: 'Do 5 flips', type: 'stunt', target: 5, reward: 600, completed: false },
];

const createDefaultUpgrades = () => ({
  engine: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] },
  suspension: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] },
  tires: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] },
  nos: { level: 0, maxLevel: 5, costs: [150, 300, 600, 1200, 3000] },
});

describe('Monster Truck Game Store', () => {
  beforeEach(() => {
    // Reset store state without replacing actions (don't use true flag)
    useGameStore.setState({
      coins: 0,
      totalCoinsEarned: 0,
      currentTruckId: 'mud-crusher',
      trucks: defaultTrucks.map(t => ({ ...t })),
      upgrades: Object.fromEntries(defaultTrucks.map(t => [t.id, createDefaultUpgrades()])),
      customization: Object.fromEntries(defaultTrucks.map(t => [t.id, { paintColor: t.color, decal: null }])),
      sessionCoins: 0,
      sessionAirtime: 0,
      sessionFlips: 0,
      sessionDestructions: 0,
      starsCollected: 0,
      challenges: defaultChallenges.map(c => ({ ...c })),
      nosCharge: 100,
      nosMaxCharge: 100,
      isPaused: false,
      showGarage: false,
      showChallenges: false,
      soundEnabled: true,
      musicEnabled: true,
    });
  });

  describe('Currency', () => {
    it('adds coins correctly', () => {
      const store = useGameStore.getState();
      store.addCoins(100);

      const state = useGameStore.getState();
      expect(state.coins).toBe(100);
      expect(state.totalCoinsEarned).toBe(100);
      expect(state.sessionCoins).toBe(100);
    });

    it('spends coins when sufficient balance', () => {
      const store = useGameStore.getState();
      useGameStore.setState({ coins: 500 });

      const result = store.spendCoins(200);
      expect(result).toBe(true);
      expect(useGameStore.getState().coins).toBe(300);
    });

    it('fails to spend coins when insufficient balance', () => {
      const store = useGameStore.getState();
      store.addCoins(100);

      const result = store.spendCoins(200);
      expect(result).toBe(false);
      expect(useGameStore.getState().coins).toBe(100);
    });
  });

  describe('Trucks', () => {
    it('starts with mud-crusher selected and unlocked', () => {
      const state = useGameStore.getState();
      expect(state.currentTruckId).toBe('mud-crusher');

      const mudCrusher = state.trucks.find(t => t.id === 'mud-crusher');
      expect(mudCrusher?.unlocked).toBe(true);
    });

    it('unlocks a truck when enough coins', () => {
      const store = useGameStore.getState();
      useGameStore.setState({ coins: 2000 });

      const result = store.unlockTruck('big-red');
      expect(result).toBe(true);

      const state = useGameStore.getState();
      const bigRed = state.trucks.find(t => t.id === 'big-red');
      expect(bigRed?.unlocked).toBe(true);
      expect(state.coins).toBe(0);
    });

    it('fails to unlock truck without enough coins', () => {
      const store = useGameStore.getState();
      store.addCoins(100);

      const result = store.unlockTruck('big-red');
      expect(result).toBe(false);

      const state = useGameStore.getState();
      const bigRed = state.trucks.find(t => t.id === 'big-red');
      expect(bigRed?.unlocked).toBe(false);
    });

    it('selects an unlocked truck', () => {
      const store = useGameStore.getState();
      useGameStore.setState({ coins: 2000 });
      store.unlockTruck('big-red');
      store.selectTruck('big-red');

      expect(useGameStore.getState().currentTruckId).toBe('big-red');
    });

    it('does not select a locked truck', () => {
      const store = useGameStore.getState();
      store.selectTruck('big-red');

      expect(useGameStore.getState().currentTruckId).toBe('mud-crusher');
    });
  });

  describe('Upgrades', () => {
    it('upgrades a stat when enough coins', () => {
      const store = useGameStore.getState();
      useGameStore.setState({ coins: 100 });

      const result = store.upgradeStat('mud-crusher', 'engine');
      expect(result).toBe(true);

      const state = useGameStore.getState();
      expect(state.upgrades['mud-crusher'].engine.level).toBe(1);
      expect(state.coins).toBe(0);
    });

    it('fails to upgrade when not enough coins', () => {
      const store = useGameStore.getState();
      store.addCoins(50);

      const result = store.upgradeStat('mud-crusher', 'engine');
      expect(result).toBe(false);

      expect(useGameStore.getState().upgrades['mud-crusher'].engine.level).toBe(0);
    });

    it('calculates truck stats with upgrades', () => {
      const store = useGameStore.getState();
      useGameStore.setState({ coins: 1000 });
      store.upgradeStat('mud-crusher', 'engine');
      store.upgradeStat('mud-crusher', 'engine');

      const stats = store.getTruckStats('mud-crusher');
      // Base 1.0 + 2 levels * 0.2 = 1.4
      expect(stats.engine).toBeCloseTo(1.4);
    });
  });

  describe('Session Stats', () => {
    it('tracks airtime', () => {
      const store = useGameStore.getState();
      store.addAirtime(2.5);
      store.addAirtime(1.5);

      expect(useGameStore.getState().sessionAirtime).toBe(4);
    });

    it('tracks flips', () => {
      const store = useGameStore.getState();
      store.addFlip();
      store.addFlip();
      store.addFlip();

      expect(useGameStore.getState().sessionFlips).toBe(3);
    });

    it('tracks destructions', () => {
      const store = useGameStore.getState();
      store.addDestruction();
      store.addDestruction();

      expect(useGameStore.getState().sessionDestructions).toBe(2);
    });

    it('resets session stats', () => {
      const store = useGameStore.getState();
      store.addCoins(100);
      store.addAirtime(5);
      store.addFlip();
      store.resetSession();

      const state = useGameStore.getState();
      expect(state.sessionCoins).toBe(0);
      expect(state.sessionAirtime).toBe(0);
      expect(state.sessionFlips).toBe(0);
      // But total coins remain
      expect(state.coins).toBe(100);
    });
  });

  describe('Challenges', () => {
    it('auto-completes and rewards coin collection challenges once', () => {
      const store = useGameStore.getState();

      store.addCoins(500);

      let state = useGameStore.getState();
      expect(state.challenges.find(c => c.id === 'collect-500')?.completed).toBe(true);
      expect(state.sessionCoins).toBe(500);
      expect(state.coins).toBe(900);
      expect(state.totalCoinsEarned).toBe(900);

      store.addCoins(10);

      state = useGameStore.getState();
      expect(state.coins).toBe(910);
      expect(state.totalCoinsEarned).toBe(910);
    });

    it('auto-completes stunt and destruction challenges from gameplay counters', () => {
      const store = useGameStore.getState();

      store.addAirtime(10);
      Array.from({ length: 5 }).forEach(() => store.addFlip());
      Array.from({ length: 20 }).forEach(() => store.addDestruction());

      const state = useGameStore.getState();
      expect(state.challenges.find(c => c.id === 'airtime-10')?.completed).toBe(true);
      expect(state.challenges.find(c => c.id === 'flip-5')?.completed).toBe(true);
      expect(state.challenges.find(c => c.id === 'smash-20')?.completed).toBe(true);
      expect(state.coins).toBe(1450);
      expect(state.totalCoinsEarned).toBe(1450);
    });

    it('auto-completes the star challenge when enough stars are collected', () => {
      const store = useGameStore.getState();

      Array.from({ length: 10 }).forEach(() => store.collectStar());

      const state = useGameStore.getState();
      expect(state.challenges.find(c => c.id === 'collect-10-stars')?.completed).toBe(true);
      expect(state.starsCollected).toBe(10);
      expect(state.coins).toBe(300);
    });
  });

  describe('NOS', () => {
    it('uses NOS charge', () => {
      const store = useGameStore.getState();
      store.useNos(25);

      expect(useGameStore.getState().nosCharge).toBe(75);
    });

    it('recharges NOS', () => {
      const store = useGameStore.getState();
      store.useNos(50);
      store.rechargeNos(20);

      expect(useGameStore.getState().nosCharge).toBe(70);
    });

    it('does not exceed max NOS', () => {
      const store = useGameStore.getState();
      store.rechargeNos(50);

      expect(useGameStore.getState().nosCharge).toBe(100);
    });
  });

  describe('UI State', () => {
    it('toggles pause', () => {
      const store = useGameStore.getState();
      store.setPaused(true);
      expect(useGameStore.getState().isPaused).toBe(true);

      store.setPaused(false);
      expect(useGameStore.getState().isPaused).toBe(false);
    });

    it('toggles garage', () => {
      const store = useGameStore.getState();
      store.setShowGarage(true);
      expect(useGameStore.getState().showGarage).toBe(true);
    });

    it('toggles sound', () => {
      const store = useGameStore.getState();
      const initial = store.soundEnabled;
      store.toggleSound();
      expect(useGameStore.getState().soundEnabled).toBe(!initial);
    });
  });
});
