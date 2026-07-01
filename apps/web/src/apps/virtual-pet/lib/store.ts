import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type PetStage,
  type PetMood,
  DECAY_RATES,
  SHOP_ITEMS,
  PET_SPECIES,
  PLAY_HAPPINESS_GAIN,
  PLAY_ENERGY_COST,
  MINIGAME_REWARD,
  calculateMood,
  getStage,
  clamp,
} from "./constants";

// Progress data
export type VirtualPetProgress = {
  pet: {
    name: string;
    speciesId: string;
    hunger: number;
    happiness: number;
    energy: number;
    cleanliness: number;
    sleeping: boolean;
    bornAt: string;
    lastChecked: string;
  };
  coins: number;
  inventory: { itemId: string; quantity: number }[];
  unlockedSpecies: string[];
  equippedCosmetics: string[];
  stats: {
    daysCaredFor: number;
    totalFeedings: number;
    totalPlaySessions: number;
    longestStreak: number;
    currentStreak: number;
    lastPlayDate: string;
  };
  settings: {
    soundEnabled: boolean;
    petName: string;
  };
  lastModified: number;
};

// Full state
export type VirtualPetState = {
  showShop: boolean;
  showStats: boolean;
  isPlaying: boolean; // Mini-game active
  miniGameScore: number;

  progress: VirtualPetProgress;
};

type VirtualPetActions = {
  // Pet actions
  feed: (itemId: string) => void;
  useToy: (itemId: string) => void;
  play: () => void;
  sleep: () => void;
  wake: () => void;
  clean: () => void;

  // Time simulation
  updateFromTime: () => void;

  // Mini-game
  startMiniGame: () => void;
  endMiniGame: (score: number) => void;

  // Shop
  buyItem: (itemId: string) => void;
  toggleShop: () => void;
  toggleStats: () => void;

  // Pet management
  renamePet: (name: string) => void;
  newPet: (speciesId: string, name: string) => void;

  // Progress
  getProgress: () => VirtualPetProgress;
  setProgress: (data: VirtualPetProgress) => void;
};

const defaultProgress: VirtualPetProgress = {
  pet: {
    name: "Blobby",
    speciesId: "blobby",
    hunger: 80,
    happiness: 80,
    energy: 100,
    cleanliness: 100,
    sleeping: false,
    bornAt: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
  },
  coins: 50,
  inventory: [],
  unlockedSpecies: ["blobby"],
  equippedCosmetics: [],
  stats: {
    daysCaredFor: 0,
    totalFeedings: 0,
    totalPlaySessions: 0,
    longestStreak: 0,
    currentStreak: 0,
    lastPlayDate: "",
  },
  settings: {
    soundEnabled: true,
    petName: "Blobby",
  },
  lastModified: Date.now(),
};

function createInitialState(): Partial<VirtualPetState> {
  return {
    showShop: false,
    showStats: false,
    isPlaying: false,
    miniGameScore: 0,
  };
}

// Audio
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

function playSound(type: "eat" | "play" | "sleep" | "clean" | "happy" | "sad" | "coin", enabled: boolean) {
  if (!enabled) return;

  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      case "eat":
        osc.frequency.value = 400;
        osc.type = "sine";
        gain.gain.value = 0.1;
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
        break;
      case "play":
        osc.frequency.value = 600;
        osc.type = "triangle";
        gain.gain.value = 0.1;
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.setValueAtTime(800, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.2);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
        break;
      case "sleep":
        osc.frequency.value = 200;
        osc.type = "sine";
        gain.gain.value = 0.08;
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
        break;
      case "clean":
        osc.frequency.value = 800;
        osc.type = "sine";
        gain.gain.value = 0.05;
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.2);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
        break;
      case "happy":
        osc.frequency.value = 523;
        osc.type = "sine";
        gain.gain.value = 0.1;
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.1);
        osc.frequency.setValueAtTime(784, now + 0.2);
        osc.start();
        osc.stop(now + 0.4);
        break;
      case "coin":
        osc.frequency.value = 1000;
        osc.type = "sine";
        gain.gain.value = 0.1;
        osc.frequency.setValueAtTime(1000, ctx.currentTime);
        osc.frequency.setValueAtTime(1500, ctx.currentTime + 0.05);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
        break;
    }
  } catch {
    // Audio not supported
  }
}

export const useVirtualPetStore = create<VirtualPetState & VirtualPetActions>()(
  persist(
    (set, get) => ({
      ...createInitialState() as VirtualPetState,
      progress: defaultProgress,

      feed: (itemId) => {
        const state = get();
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if (!item || item.type !== "food") return;

        // Check inventory
        const invItem = state.progress.inventory.find(i => i.itemId === itemId);
        if (!invItem || invItem.quantity <= 0) return;

        playSound("eat", state.progress.settings.soundEnabled);

        const newHunger = clamp(state.progress.pet.hunger + (item.effect?.amount || 0), 0, 100);
        const newInventory = state.progress.inventory.map(i =>
          i.itemId === itemId ? { ...i, quantity: i.quantity - 1 } : i
        ).filter(i => i.quantity > 0);

        set({
          progress: {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              hunger: newHunger,
              lastChecked: new Date().toISOString(),
            },
            inventory: newInventory,
            stats: {
              ...state.progress.stats,
              totalFeedings: state.progress.stats.totalFeedings + 1,
            },
            lastModified: Date.now(),
          },
        });
      },

      useToy: (itemId) => {
        const state = get();
        if (state.progress.pet.sleeping) return;

        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if (!item || item.type !== "toy") return;

        const invItem = state.progress.inventory.find(i => i.itemId === itemId);
        if (!invItem || invItem.quantity <= 0) return;

        playSound("play", state.progress.settings.soundEnabled);

        const happinessGain = item.effect?.stat === "happiness" ? item.effect.amount : 0;
        const newInventory = state.progress.inventory.map(i =>
          i.itemId === itemId ? { ...i, quantity: i.quantity - 1 } : i
        ).filter(i => i.quantity > 0);

        set({
          progress: {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              happiness: clamp(state.progress.pet.happiness + happinessGain, 0, 100),
              lastChecked: new Date().toISOString(),
            },
            inventory: newInventory,
            stats: {
              ...state.progress.stats,
              totalPlaySessions: state.progress.stats.totalPlaySessions + 1,
            },
            lastModified: Date.now(),
          },
        });
      },

      play: () => {
        const state = get();
        if (state.progress.pet.sleeping) return;
        if (state.progress.pet.energy < PLAY_ENERGY_COST) return;

        playSound("play", state.progress.settings.soundEnabled);

        const newHappiness = clamp(state.progress.pet.happiness + PLAY_HAPPINESS_GAIN, 0, 100);
        const newEnergy = clamp(state.progress.pet.energy - PLAY_ENERGY_COST, 0, 100);

        set({
          progress: {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              happiness: newHappiness,
              energy: newEnergy,
              lastChecked: new Date().toISOString(),
            },
            stats: {
              ...state.progress.stats,
              totalPlaySessions: state.progress.stats.totalPlaySessions + 1,
            },
            lastModified: Date.now(),
          },
        });
      },

      sleep: () => {
        const state = get();
        if (state.progress.pet.sleeping) return;

        playSound("sleep", state.progress.settings.soundEnabled);

        set({
          progress: {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              sleeping: true,
              lastChecked: new Date().toISOString(),
            },
            lastModified: Date.now(),
          },
        });
      },

      wake: () => {
        const state = get();
        if (!state.progress.pet.sleeping) return;

        set({
          progress: {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              sleeping: false,
              energy: 100, // Full energy on wake
              lastChecked: new Date().toISOString(),
            },
            lastModified: Date.now(),
          },
        });
      },

      clean: () => {
        const state = get();

        playSound("clean", state.progress.settings.soundEnabled);

        set({
          progress: {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              cleanliness: 100,
              lastChecked: new Date().toISOString(),
            },
            lastModified: Date.now(),
          },
        });
      },

      updateFromTime: () => {
        const state = get();
        const lastChecked = new Date(state.progress.pet.lastChecked);
        const now = new Date();
        const hoursAway = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);

        // Cap at 24 hours to prevent total depletion
        const cappedHours = Math.min(hoursAway, 24);

        let newHunger = state.progress.pet.hunger;
        let newHappiness = state.progress.pet.happiness;
        let newEnergy = state.progress.pet.energy;
        let newCleanliness = state.progress.pet.cleanliness;

        if (state.progress.pet.sleeping) {
          // Energy restores while sleeping
          newEnergy = Math.min(100, newEnergy + 10 * cappedHours);
        } else {
          // Stats decay while awake
          newHunger = Math.max(0, newHunger - DECAY_RATES.hunger * cappedHours);
          newHappiness = Math.max(0, newHappiness - DECAY_RATES.happiness * cappedHours);
          newEnergy = Math.max(0, newEnergy - DECAY_RATES.energy * cappedHours);
        }
        newCleanliness = Math.max(0, newCleanliness - DECAY_RATES.cleanliness * cappedHours);

        // Update streak
        const today = new Date().toDateString();
        const lastPlay = state.progress.stats.lastPlayDate;
        let currentStreak = state.progress.stats.currentStreak;
        let longestStreak = state.progress.stats.longestStreak;

        if (lastPlay !== today) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          if (lastPlay === yesterday.toDateString()) {
            currentStreak++;
          } else {
            currentStreak = 1;
          }
          longestStreak = Math.max(longestStreak, currentStreak);
        }

        // Calculate days cared for
        const bornAt = new Date(state.progress.pet.bornAt);
        const daysCaredFor = Math.floor((now.getTime() - bornAt.getTime()) / (1000 * 60 * 60 * 24));

        // Check for unlocks
        const unlockedSpecies = [...state.progress.unlockedSpecies];
        if (daysCaredFor >= 7 && !unlockedSpecies.includes("pupper")) {
          unlockedSpecies.push("pupper");
        }
        if (currentStreak >= 3 && !unlockedSpecies.includes("kitcat")) {
          unlockedSpecies.push("kitcat");
        }

        set({
          progress: {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              hunger: newHunger,
              happiness: newHappiness,
              energy: newEnergy,
              cleanliness: newCleanliness,
              lastChecked: now.toISOString(),
            },
            unlockedSpecies,
            stats: {
              ...state.progress.stats,
              daysCaredFor,
              currentStreak,
              longestStreak,
              lastPlayDate: today,
            },
            lastModified: Date.now(),
          },
        });
      },

      startMiniGame: () => {
        set({ isPlaying: true, miniGameScore: 0 });
      },

      endMiniGame: (score) => {
        const state = get();
        const coins = Math.floor(score * MINIGAME_REWARD / 10);

        if (coins > 0) {
          playSound("coin", state.progress.settings.soundEnabled);
        }

        set({
          isPlaying: false,
          miniGameScore: score,
          progress: {
            ...state.progress,
            coins: state.progress.coins + coins,
            pet: {
              ...state.progress.pet,
              happiness: clamp(state.progress.pet.happiness + Math.floor(score / 2), 0, 100),
            },
            lastModified: Date.now(),
          },
        });
      },

      buyItem: (itemId) => {
        const state = get();
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if (!item) return;
        if (state.progress.coins < item.price) return;

        playSound("coin", state.progress.settings.soundEnabled);

        const existingItem = state.progress.inventory.find(i => i.itemId === itemId);
        let newInventory;
        if (existingItem) {
          newInventory = state.progress.inventory.map(i =>
            i.itemId === itemId ? { ...i, quantity: i.quantity + 1 } : i
          );
        } else {
          newInventory = [...state.progress.inventory, { itemId, quantity: 1 }];
        }

        // Handle cosmetics
        const equippedCosmetics = [...state.progress.equippedCosmetics];
        if (item.type === "cosmetic" && !equippedCosmetics.includes(itemId)) {
          equippedCosmetics.push(itemId);
        }

        set({
          progress: {
            ...state.progress,
            coins: state.progress.coins - item.price,
            inventory: newInventory,
            equippedCosmetics,
            lastModified: Date.now(),
          },
        });
      },

      toggleShop: () => set(s => ({ showShop: !s.showShop })),
      toggleStats: () => set(s => ({ showStats: !s.showStats })),

      renamePet: (name) => {
        const state = get();
        set({
          progress: {
            ...state.progress,
            pet: { ...state.progress.pet, name },
            settings: { ...state.progress.settings, petName: name },
            lastModified: Date.now(),
          },
        });
      },

      newPet: (speciesId, name) => {
        const state = get();
        if (!state.progress.unlockedSpecies.includes(speciesId)) return;

        set({
          progress: {
            ...state.progress,
            pet: {
              name,
              speciesId,
              hunger: 80,
              happiness: 80,
              energy: 100,
              cleanliness: 100,
              sleeping: false,
              bornAt: new Date().toISOString(),
              lastChecked: new Date().toISOString(),
            },
            equippedCosmetics: [],
            settings: { ...state.progress.settings, petName: name },
            lastModified: Date.now(),
          },
        });
      },

      getProgress: () => get().progress,
      setProgress: (data) => set({ progress: data }),
    }),
    {
      name: "virtual-pet-state",
      partialize: (state) => ({
        progress: state.progress,
      }),
    }
  )
);
