import { readPetName, writePetName } from "./localWords";
import { PET_SPECIES } from "./constants";
import { createWordProjection } from "@/lib/progress-words";
import { localWords } from "@/lib/local-words";
import { bindWordConsumer } from "@/lib/local-words/consumer";
import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { automaticStamp, sameProgress, stampIfChanged } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import {
  DECAY_RATES,
  SHOP_ITEMS,
  PLAY_HAPPINESS_GAIN,
  PLAY_ENERGY_COST,
  MINIGAME_REWARD,
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

  // Time simulation. VirtualPet runs it when useAuthSync is ready, and passes
  // `synced` (the pet is the account's): only then does a visit on a new day
  // stamp the time (automaticStamp).
  updateFromTime: (synced?: boolean) => void;

  // Mini-game
  startMiniGame: () => void;
  endMiniGame: (score: number) => void;

  // Shop
  buyItem: (itemId: string) => void;
  toggleShop: () => void;
  toggleStats: () => void;

  // Pet management
  renamePet: (name: string) => void;
  /** The sound switch: a player's choice, so it stamps the time. */
  toggleSound: () => void;
  newPet: (speciesId: string, name: string) => void;

  // Progress
  getProgress: () => VirtualPetProgress;
  setProgress: (data: VirtualPetProgress) => void;
};

const projectWords = createWordProjection<VirtualPetProgress>("virtual-pet");

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
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

type PetStats = VirtualPetProgress["stats"];

/** The day of a lastPlayDate (a toDateString() value), or -Infinity for none. */
const playDay = (date: unknown) => {
  const time = typeof date === "string" && date ? Date.parse(date) : NaN;
  return Number.isNaN(time) ? -Infinity : time;
};

/**
 * Time passing changes the pet with no choice of the player: its needs, its
 * age, the daily-visit streak and the species that time unlocks (a default
 * pet opened a week after it was born unlocks Pupper by itself). Before the
 * sync-time fix the time update stamped an untouched pet, and the sound
 * switch did not stamp at all. Such a pet is untouched: it must never
 * replace the account's real pet. What time earned is not lost: when the
 * sync takes the account's pet over it, foldNested keeps the visit streak,
 * and the server's merge keeps the unlocked species.
 */
const UNTOUCHED = defineUntouchedProgress("virtual-pet", {
  defaults: defaultProgress,
  ignore: [
    "soundEnabled", "hunger", "happiness", "energy", "cleanliness", "lastChecked", "bornAt",
    "daysCaredFor", "currentStreak", "longestStreak", "lastPlayDate", "unlockedSpecies",
  ],
  foldNested: (base, other) => {
    const mine = base.stats as PetStats | undefined;
    const theirs = other.stats as PetStats | undefined;
    if (!mine || !theirs) return base;
    const stats: PetStats = { ...mine, longestStreak: Math.max(mine.longestStreak ?? 0, theirs.longestStreak ?? 0) };
    // The newer visit carries the streak.
    if (playDay(theirs.lastPlayDate) > playDay(mine.lastPlayDate)) {
      stats.currentStreak = theirs.currentStreak;
      stats.lastPlayDate = theirs.lastPlayDate;
    }
    return sameProgress(stats, mine) ? base : { ...base, stats };
  },
});

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
          progress: stampIfChanged(state.progress, {
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
          }),
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
          progress: stampIfChanged(state.progress, {
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
          }),
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
          progress: stampIfChanged(state.progress, {
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
          }),
        });
      },

      sleep: () => {
        const state = get();
        if (state.progress.pet.sleeping) return;

        playSound("sleep", state.progress.settings.soundEnabled);

        set({
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              sleeping: true,
              lastChecked: new Date().toISOString(),
            },
          }),
        });
      },

      wake: () => {
        const state = get();
        if (!state.progress.pet.sleeping) return;

        set({
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              sleeping: false,
              energy: 100, // Full energy on wake
              lastChecked: new Date().toISOString(),
            },
          }),
        });
      },

      clean: () => {
        const state = get();

        playSound("clean", state.progress.settings.soundEnabled);

        set({
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            pet: {
              ...state.progress.pet,
              cleanliness: 100,
              lastChecked: new Date().toISOString(),
            },
          }),
        });
      },

      updateFromTime: (synced = true) => {
        const state = get();
        const lastChecked = new Date(state.progress.pet.lastChecked);
        const now = new Date();
        const hoursAway = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);

        // Cap at 24 hours to prevent total depletion. Never below 0: a pet
        // checked on a device whose clock runs ahead (or read on a device
        // whose clock runs behind) made the time away negative, the decay
        // then ADDED to the needs, and the server refused every save of a
        // need above 100. An unreadable time counts as no time away.
        const cappedHours = Number.isFinite(hoursAway) ? Math.max(0, Math.min(hoursAway, 24)) : 0;

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
        // Never below 0: a pet born on a device whose clock runs ahead, then
        // read on another device, made it -1, and the server refused every
        // save of the pet.
        const daysCaredFor = Math.max(0, Math.floor((now.getTime() - bornAt.getTime()) / (1000 * 60 * 60 * 24)));

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
            // The minute update runs while the page is open: when only the
            // needs move, it keeps the time (a continuous change, see
            // shared/lib/progressStamp.ts), or an idle pet page would replace
            // what the kid did on another device. A visit on a new day (the
            // streak) and an unlock are progress of a pet that the player
            // already changed (automaticStamp: an untouched pet stays
            // untouched), and only on the account's pet (`synced`): on the
            // device's copy (the account cannot be reached, or a guest) the
            // visit keeps the time, so an old copy never looks newer than
            // the account's pet.
            lastModified:
              lastPlay !== today || unlockedSpecies.length !== state.progress.unlockedSpecies.length
                ? automaticStamp(state.progress.lastModified, synced)
                : state.progress.lastModified,
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
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            coins: state.progress.coins + coins,
            pet: {
              ...state.progress.pet,
              happiness: clamp(state.progress.pet.happiness + Math.floor(score / 2), 0, 100),
            },
          }),
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
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            coins: state.progress.coins - item.price,
            inventory: newInventory,
            equippedCosmetics,
          }),
        });
      },

      toggleShop: () => set(s => ({ showShop: !s.showShop })),
      toggleStats: () => set(s => ({ showStats: !s.showStats })),

      toggleSound: () =>
        set((state) => ({
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            settings: { ...state.progress.settings, soundEnabled: !state.progress.settings.soundEnabled },
          }),
        })),

      renamePet: (name) => {
        const state = get();
        const lease = localWords.captureLease();
        if (lease) void writePetName(lease, state.progress.pet, name);
        set({
          progress: {
            ...state.progress,
            pet: { ...state.progress.pet, name },
            settings: { ...state.progress.settings, petName: name },
          },
        });
      },

      newPet: (speciesId, name) => {
        const state = get();
        if (!state.progress.unlockedSpecies.includes(speciesId)) return;

        const bornAt = new Date().toISOString();
        const lease = localWords.captureLease();
        if (lease) void writePetName(lease, { speciesId, bornAt }, name);
        set({
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            pet: {
              name,
              speciesId,
              hunger: 80,
              happiness: 80,
              energy: 100,
              cleanliness: 100,
              sleeping: false,
              bornAt,
              lastChecked: new Date().toISOString(),
            },
            equippedCosmetics: [],
            settings: { ...state.progress.settings, petName: name },
          }),
        });
      },

      getProgress: () => projectWords(get().progress),
      setProgress: (data) => set({ progress: data }),
    }),
    {
      storage: createOwnerPersistStorage("virtual-pet-state", "virtual-pet"),
      skipHydration: true,
      name: "virtual-pet-state",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
        progress: projectWords(state.progress),
      }),
    }
  )
);

bindPersistedStore("virtual-pet-state", useVirtualPetStore.persist, () => useVirtualPetStore.setState({}));

bindWordConsumer("virtual-pet", useVirtualPetStore.subscribe, (_records, lease) => {
  const { progress } = useVirtualPetStore.getState();
  const name = (lease ? readPetName(lease, progress.pet) : undefined) ?? PET_SPECIES.find(species => species.id === progress.pet.speciesId)?.name ?? "Blobby";
  if (progress.pet.name !== name || progress.settings.petName !== name) {
    useVirtualPetStore.setState({ progress: { ...progress, pet: { ...progress.pet, name }, settings: { ...progress.settings, petName: name } } });
  }
});
