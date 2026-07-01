import { beforeEach, describe, expect, it } from 'vitest';
import { useHillClimbStore } from '../lib/store';
import { FUEL, NITRO } from '../lib/constants';

function resetStore() {
  localStorage.clear();
  useHillClimbStore.setState({
    coins: 0,
    totalCoinsEarned: 0,
    isPlaying: false,
    isGameOver: false,
    isPaused: false,
    pauseScreen: 'menu',
    gameOverReason: null,
    distance: 0,
    fuel: FUEL.INITIAL_FUEL,
    nitro: NITRO.MAX,
    sessionCoins: 0,
    sessionFlips: 0,
    sessionAirtime: 0,
    combo: 0,
    comboTimer: 0,
    bestDistance: 0,
    bestDistancePerStage: {},
    currentVehicleId: 'jeep',
    unlockedVehicles: ['jeep'],
    vehicleUpgrades: {
      jeep: { engine: 0, suspension: 0, tires: 0, fuelTank: 0, nitro: 0 },
    },
    currentStageId: 'countryside',
    unlockedStages: ['countryside'],
    soundEnabled: true,
    musicEnabled: true,
    leanSensitivity: 1,
  });
}

describe('Hill Climb store', () => {
  beforeEach(() => {
    resetStore();
  });

  it('selects stages unlocked by best distance even when old progress has not listed them', () => {
    useHillClimbStore.setState({
      bestDistance: 1000,
      unlockedStages: ['countryside'],
      currentStageId: 'countryside',
    });

    useHillClimbStore.getState().selectStage('arctic');

    const state = useHillClimbStore.getState();
    expect(state.currentStageId).toBe('arctic');
    expect(state.unlockedStages).toContain('arctic');
  });

  it('records newly distance-unlocked stages when a run ends', () => {
    useHillClimbStore.setState({
      isPlaying: true,
      distance: 2500,
      unlockedStages: ['countryside'],
    });

    useHillClimbStore.getState().endRun('head');

    const state = useHillClimbStore.getState();
    expect(state.isGameOver).toBe(true);
    expect(state.bestDistance).toBe(2500);
    expect(state.unlockedStages).toEqual(['countryside', 'arctic', 'moon', 'desert']);
  });
});
