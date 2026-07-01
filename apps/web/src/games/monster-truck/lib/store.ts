import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// TYPES
// ============================================================================

// Progress type for cloud sync
// Index signature required for AppProgressData compatibility
export type MonsterTruckProgress = {
  [key: string]: unknown;
  coins: number;
  totalCoinsEarned: number;
  currentTruckId: string;
  trucks: Truck[];
  upgrades: Record<string, {
    engine: Upgrade;
    suspension: Upgrade;
    tires: Upgrade;
    nos: Upgrade;
  }>;
  customization: Record<string, {
    paintColor: string;
    decal: string | null;
  }>;
  starsCollected: number;
  challenges: Challenge[];
  soundEnabled: boolean;
  musicEnabled: boolean;
  lastModified: number;
};

export interface Truck {
  id: string;
  name: string;
  cost: number;
  description: string;
  baseStats: {
    engine: number;
    suspension: number;
    tires: number;
    nos: number;
  };
  color: string;
  unlocked: boolean;
}

export interface Upgrade {
  level: number;
  maxLevel: number;
  costs: number[];
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  type: 'time' | 'collection' | 'stunt' | 'destruction';
  target: number;
  reward: number;
  completed: boolean;
}

export interface GameState {
  // Currency
  coins: number;
  totalCoinsEarned: number;

  // Current truck
  currentTruckId: string;

  // Trucks collection
  trucks: Truck[];

  // Upgrades per truck
  upgrades: Record<string, {
    engine: Upgrade;
    suspension: Upgrade;
    tires: Upgrade;
    nos: Upgrade;
  }>;

  // Customization per truck
  customization: Record<string, {
    paintColor: string;
    decal: string | null;
  }>;

  // Session stats (reset on new game)
  sessionCoins: number;
  sessionAirtime: number;
  sessionFlips: number;
  sessionDestructions: number;
  starsCollected: number;

  // NOS
  nosCharge: number;
  nosMaxCharge: number;

  // Challenges
  challenges: Challenge[];

  // Settings
  soundEnabled: boolean;
  musicEnabled: boolean;

  // Game state
  isPaused: boolean;
  showGarage: boolean;
  showChallenges: boolean;
}

export interface GameActions {
  // Currency
  addCoins: (amount: number) => void;
  spendCoins: (amount: number) => boolean;

  // Trucks
  selectTruck: (truckId: string) => void;
  unlockTruck: (truckId: string) => boolean;
  upgradeStat: (truckId: string, stat: 'engine' | 'suspension' | 'tires' | 'nos') => boolean;
  setPaintColor: (truckId: string, color: string) => void;
  setDecal: (truckId: string, decal: string | null) => void;

  // Session
  addAirtime: (seconds: number) => void;
  addFlip: () => void;
  addDestruction: () => void;
  collectStar: () => void;
  resetSession: () => void;

  // NOS
  useNos: (amount: number) => void;
  rechargeNos: (amount: number) => void;

  // Challenges
  completeChallenge: (challengeId: string) => void;
  resetChallenges: () => void;

  // Settings
  toggleSound: () => void;
  toggleMusic: () => void;

  // UI state
  setPaused: (paused: boolean) => void;
  setShowGarage: (show: boolean) => void;
  setShowChallenges: (show: boolean) => void;

  // Helpers
  getCurrentTruck: () => Truck;
  getTruckStats: (truckId: string) => { engine: number; suspension: number; tires: number; nos: number };
  getNextUpgradeCost: (truckId: string, stat: 'engine' | 'suspension' | 'tires' | 'nos') => number | null;

  // Cloud sync
  getProgress: () => MonsterTruckProgress;
  setProgress: (data: MonsterTruckProgress) => void;
}

// ============================================================================
// DEFAULT DATA (from design doc)
// ============================================================================

const defaultTrucks: Truck[] = [
  {
    id: 'mud-crusher',
    name: 'Mud Crusher',
    cost: 0,
    description: 'Your trusty starter truck. Balanced and ready to roll!',
    baseStats: { engine: 1, suspension: 1, tires: 1, nos: 1 },
    color: '#e74c3c',
    unlocked: true,
  },
  {
    id: 'big-red',
    name: 'Big Red',
    cost: 2000,
    description: 'Raw power! +25% engine boost.',
    baseStats: { engine: 1.25, suspension: 1, tires: 1, nos: 1 },
    color: '#c0392b',
    unlocked: false,
  },
  {
    id: 'bouncy-boy',
    name: 'Bouncy Boy',
    cost: 3500,
    description: 'Springs for days! +50% suspension.',
    baseStats: { engine: 1, suspension: 1.5, tires: 1, nos: 1 },
    color: '#27ae60',
    unlocked: false,
  },
  {
    id: 'grip-king',
    name: 'Grip King',
    cost: 5000,
    description: 'Sticks like glue! +40% tire grip.',
    baseStats: { engine: 1, suspension: 1, tires: 1.4, nos: 1 },
    color: '#3498db',
    unlocked: false,
  },
  {
    id: 'speed-demon',
    name: 'Speed Demon',
    cost: 8000,
    description: 'Blazing fast! Maximum top speed.',
    baseStats: { engine: 1.5, suspension: 0.9, tires: 1.1, nos: 1.2 },
    color: '#9b59b6',
    unlocked: false,
  },
  {
    id: 'the-beast',
    name: 'The Beast',
    cost: 15000,
    description: 'The ultimate monster truck. Best stats all around!',
    baseStats: { engine: 1.3, suspension: 1.3, tires: 1.3, nos: 1.3 },
    color: '#f39c12',
    unlocked: false,
  },
];

const createDefaultUpgrades = () => ({
  engine: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] },
  suspension: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] },
  tires: { level: 0, maxLevel: 5, costs: [100, 250, 500, 1000, 2500] },
  nos: { level: 0, maxLevel: 5, costs: [150, 300, 600, 1200, 3000] },
});

const defaultChallenges: Challenge[] = [
  { id: 'collect-10-stars', name: 'Star Collector', description: 'Collect 10 stars', type: 'collection', target: 10, reward: 300, completed: false },
  { id: 'airtime-10', name: 'Hang Time', description: 'Get 10 seconds of airtime', type: 'stunt', target: 10, reward: 500, completed: false },
  { id: 'smash-20', name: 'Demolition Derby', description: 'Smash 20 objects', type: 'destruction', target: 20, reward: 350, completed: false },
  { id: 'collect-500', name: 'Coin Hunter', description: 'Collect 500 coins', type: 'collection', target: 500, reward: 400, completed: false },
  { id: 'flip-5', name: 'Flipmaster', description: 'Do 5 flips', type: 'stunt', target: 5, reward: 600, completed: false },
];

type ChallengeProgressSnapshot = Pick<
  GameState,
  | 'sessionCoins'
  | 'sessionAirtime'
  | 'sessionFlips'
  | 'sessionDestructions'
  | 'starsCollected'
>;

type ChallengeCompletionSnapshot = ChallengeProgressSnapshot &
  Pick<GameState, 'coins' | 'totalCoinsEarned' | 'challenges'>;

export function getChallengeProgress(
  state: ChallengeProgressSnapshot,
  challenge: Challenge
): number {
  switch (challenge.id) {
    case 'collect-10-stars':
      return state.starsCollected;
    case 'airtime-10':
      return state.sessionAirtime;
    case 'smash-20':
      return state.sessionDestructions;
    case 'collect-500':
      return state.sessionCoins;
    case 'flip-5':
      return state.sessionFlips;
    default:
      return 0;
  }
}

function getChallengeCompletionUpdate(state: ChallengeCompletionSnapshot): {
  challenges: Challenge[];
  reward: number;
} {
  let reward = 0;
  const challenges = state.challenges.map((challenge) => {
    if (challenge.completed) return challenge;
    if (getChallengeProgress(state, challenge) < challenge.target) return challenge;

    reward += challenge.reward;
    return { ...challenge, completed: true };
  });

  return { challenges, reward };
}

// ============================================================================
// STORE
// ============================================================================

export const useGameStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      // Initial state
      coins: 0,
      totalCoinsEarned: 0,
      currentTruckId: 'mud-crusher',
      trucks: defaultTrucks,
      upgrades: Object.fromEntries(defaultTrucks.map(t => [t.id, createDefaultUpgrades()])),
      customization: Object.fromEntries(defaultTrucks.map(t => [t.id, { paintColor: t.color, decal: null }])),
      sessionCoins: 0,
      sessionAirtime: 0,
      sessionFlips: 0,
      sessionDestructions: 0,
      starsCollected: 0,
      nosCharge: 100,
      nosMaxCharge: 100,
      challenges: defaultChallenges,
      soundEnabled: true,
      musicEnabled: true,
      isPaused: false,
      showGarage: false,
      showChallenges: false,

      // Currency actions
      addCoins: (amount) => set((state) => {
        const nextState = {
          ...state,
          coins: state.coins + amount,
          totalCoinsEarned: state.totalCoinsEarned + amount,
          sessionCoins: state.sessionCoins + amount,
        };
        const { challenges, reward } = getChallengeCompletionUpdate(nextState);

        return {
          coins: nextState.coins + reward,
          totalCoinsEarned: nextState.totalCoinsEarned + reward,
          sessionCoins: nextState.sessionCoins,
          challenges,
        };
      }),

      spendCoins: (amount) => {
        const state = get();
        if (state.coins >= amount) {
          set({ coins: state.coins - amount });
          return true;
        }
        return false;
      },

      // Truck actions
      selectTruck: (truckId) => {
        const truck = get().trucks.find(t => t.id === truckId);
        if (truck?.unlocked) {
          set({ currentTruckId: truckId });
        }
      },

      unlockTruck: (truckId) => {
        const state = get();
        const truck = state.trucks.find(t => t.id === truckId);
        if (truck && !truck.unlocked && state.coins >= truck.cost) {
          set({
            coins: state.coins - truck.cost,
            trucks: state.trucks.map(t =>
              t.id === truckId ? { ...t, unlocked: true } : t
            ),
          });
          return true;
        }
        return false;
      },

      upgradeStat: (truckId, stat) => {
        const state = get();
        const truckUpgrades = state.upgrades[truckId];
        if (!truckUpgrades) return false;

        const upgrade = truckUpgrades[stat];
        if (upgrade.level >= upgrade.maxLevel) return false;

        const cost = upgrade.costs[upgrade.level];
        if (state.coins < cost) return false;

        set({
          coins: state.coins - cost,
          upgrades: {
            ...state.upgrades,
            [truckId]: {
              ...truckUpgrades,
              [stat]: { ...upgrade, level: upgrade.level + 1 },
            },
          },
        });
        return true;
      },

      setPaintColor: (truckId, color) => set((state) => ({
        customization: {
          ...state.customization,
          [truckId]: { ...state.customization[truckId], paintColor: color },
        },
      })),

      setDecal: (truckId, decal) => set((state) => ({
        customization: {
          ...state.customization,
          [truckId]: { ...state.customization[truckId], decal },
        },
      })),

      // Session actions
      addAirtime: (seconds) => set((state) => {
        const nextState = {
          ...state,
          sessionAirtime: state.sessionAirtime + seconds,
        };
        const { challenges, reward } = getChallengeCompletionUpdate(nextState);

        return {
          coins: nextState.coins + reward,
          totalCoinsEarned: nextState.totalCoinsEarned + reward,
          sessionAirtime: nextState.sessionAirtime,
          challenges,
        };
      }),

      addFlip: () => set((state) => {
        const nextState = {
          ...state,
          sessionFlips: state.sessionFlips + 1,
        };
        const { challenges, reward } = getChallengeCompletionUpdate(nextState);

        return {
          coins: nextState.coins + reward,
          totalCoinsEarned: nextState.totalCoinsEarned + reward,
          sessionFlips: nextState.sessionFlips,
          challenges,
        };
      }),

      addDestruction: () => set((state) => {
        const nextState = {
          ...state,
          sessionDestructions: state.sessionDestructions + 1,
        };
        const { challenges, reward } = getChallengeCompletionUpdate(nextState);

        return {
          coins: nextState.coins + reward,
          totalCoinsEarned: nextState.totalCoinsEarned + reward,
          sessionDestructions: nextState.sessionDestructions,
          challenges,
        };
      }),

      collectStar: () => set((state) => {
        const nextState = {
          ...state,
          starsCollected: state.starsCollected + 1,
        };
        const { challenges, reward } = getChallengeCompletionUpdate(nextState);

        return {
          coins: nextState.coins + reward,
          totalCoinsEarned: nextState.totalCoinsEarned + reward,
          starsCollected: nextState.starsCollected,
          challenges,
        };
      }),

      resetSession: () => set({
        sessionCoins: 0,
        sessionAirtime: 0,
        sessionFlips: 0,
        sessionDestructions: 0,
      }),

      // NOS actions
      useNos: (amount) => set((state) => ({
        nosCharge: Math.max(0, state.nosCharge - amount),
      })),

      rechargeNos: (amount) => set((state) => ({
        nosCharge: Math.min(state.nosMaxCharge, state.nosCharge + amount),
      })),

      // Challenge actions
      completeChallenge: (challengeId) => {
        const state = get();
        const challenge = state.challenges.find(c => c.id === challengeId);
        if (challenge && !challenge.completed) {
          set({
            coins: state.coins + challenge.reward,
            totalCoinsEarned: state.totalCoinsEarned + challenge.reward,
            challenges: state.challenges.map(c =>
              c.id === challengeId ? { ...c, completed: true } : c
            ),
          });
        }
      },

      resetChallenges: () => set({
        challenges: defaultChallenges,
      }),

      // Settings actions
      toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
      toggleMusic: () => set((state) => ({ musicEnabled: !state.musicEnabled })),

      // UI state actions
      setPaused: (paused) => set({ isPaused: paused }),
      setShowGarage: (show) => set({ showGarage: show }),
      setShowChallenges: (show) => set({ showChallenges: show }),

      // Helper functions
      getCurrentTruck: () => {
        const state = get();
        return state.trucks.find(t => t.id === state.currentTruckId) || state.trucks[0];
      },

      getTruckStats: (truckId) => {
        const state = get();
        const truck = state.trucks.find(t => t.id === truckId);
        const upgrades = state.upgrades[truckId];
        if (!truck || !upgrades) {
          return { engine: 1, suspension: 1, tires: 1, nos: 1 };
        }

        // Each upgrade level adds 20% to the stat
        const upgradeMultiplier = (level: number) => 1 + (level * 0.2);

        return {
          engine: truck.baseStats.engine * upgradeMultiplier(upgrades.engine.level),
          suspension: truck.baseStats.suspension * upgradeMultiplier(upgrades.suspension.level),
          tires: truck.baseStats.tires * upgradeMultiplier(upgrades.tires.level),
          nos: truck.baseStats.nos * upgradeMultiplier(upgrades.nos.level),
        };
      },

      getNextUpgradeCost: (truckId, stat) => {
        const state = get();
        const truckUpgrades = state.upgrades[truckId];
        if (!truckUpgrades) return null;

        const upgrade = truckUpgrades[stat];
        if (upgrade.level >= upgrade.maxLevel) return null;

        return upgrade.costs[upgrade.level];
      },

      // Cloud sync
      getProgress: () => {
        const state = get();
        return {
          coins: state.coins,
          totalCoinsEarned: state.totalCoinsEarned,
          currentTruckId: state.currentTruckId,
          trucks: state.trucks,
          upgrades: state.upgrades,
          customization: state.customization,
          starsCollected: state.starsCollected,
          challenges: state.challenges,
          soundEnabled: state.soundEnabled,
          musicEnabled: state.musicEnabled,
          lastModified: Date.now(),
        };
      },

      setProgress: (data) => {
        set({
          coins: data.coins,
          totalCoinsEarned: data.totalCoinsEarned,
          currentTruckId: data.currentTruckId,
          trucks: data.trucks,
          upgrades: data.upgrades,
          customization: data.customization,
          starsCollected: data.starsCollected,
          challenges: data.challenges,
          soundEnabled: data.soundEnabled,
          musicEnabled: data.musicEnabled,
        });
      },
    }),
    {
      name: 'monster-truck-save',
      partialize: (state) => ({
        coins: state.coins,
        totalCoinsEarned: state.totalCoinsEarned,
        currentTruckId: state.currentTruckId,
        trucks: state.trucks,
        upgrades: state.upgrades,
        customization: state.customization,
        starsCollected: state.starsCollected,
        challenges: state.challenges,
        soundEnabled: state.soundEnabled,
        musicEnabled: state.musicEnabled,
      }),
    }
  )
);
