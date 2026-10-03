// Oregon Trail - Zustand Store
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { progressStamp } from '@/shared/lib/progressStamp';
import { defineUntouchedProgress, markSavedWithSum, persistSettledSave, settleOnLoad } from '@/shared/lib/untouchedProgress';
import type { GameState, GamePhase, PaceType, OccupationType, Month, GameEvent, Supplies } from '../types';
import { createInitialState, calculateDailyTravel, calculateFoodConsumption, getRandomWeather, updatePartyHealth, applyEventEffect, checkLandmarkReached, checkGameOver, getRiverDepth, attemptRiverCrossing } from './gameLogic';
import { getRandomEvent } from './events';
import { LANDMARKS, STORE_PRICES } from './constants';

const defaultState: GameState = {
  gamePhase: "title", gameStarted: false, leaderName: "", occupation: "banker", party: [], departureMonth: "march",
  currentDay: 1, milesTraveled: 0, currentLandmarkIndex: 0, pace: "steady",
  supplies: { food: 0, oxen: 0, clothing: 0, ammunition: 0, spareParts: { wheels: 0, axles: 0, tongues: 0 }, money: 0 },
  weather: "clear", currentEvent: null, currentRiver: null, huntingFood: 0, huntingAmmoUsed: 0,
  daysRested: 0, foodHunted: 0, riversCrossed: 0, eventsEncountered: 0,
};

function formatLostSupplies(lostSupplies?: Partial<Supplies>): string {
  if (!lostSupplies) return "";

  const losses = [
    lostSupplies.food ? `${lostSupplies.food} lbs food` : null,
    lostSupplies.oxen ? `${lostSupplies.oxen} oxen` : null,
    lostSupplies.ammunition ? `${lostSupplies.ammunition} bullets` : null,
  ].filter(Boolean);

  return losses.length > 0 ? ` Lost ${losses.join(", ")}.` : "";
}

function createRiverResultEvent(
  riverName: string,
  result: ReturnType<typeof attemptRiverCrossing>
): GameEvent {
  return {
    id: "river-crossing-result",
    title: result.success ? "Safe Crossing!" : `${riverName} Trouble!`,
    message: `${result.message}${formatLostSupplies(result.lostSupplies)}`,
    category: result.success ? "positive" : "severe",
    probability: 0,
    effect: {},
  };
}

// Type for cloud sync (game state + timestamp)
// Index signature required for AppProgressData compatibility
export type OregonTrailSyncData = GameState & { lastModified: number; [key: string]: unknown };

/**
 * The fields that sync to the account (the whole journey). A change to one
 * of them stamps lastModified (progressStamp), so no action has to stamp it
 * by hand. Before the sync-time fix, getProgress() returned Date.now() on
 * every read: an untouched store always looked newer than the account and
 * replaced the journey on the account with the title screen at sign-in.
 */
const PROGRESS_FIELDS = [
  "gamePhase", "gameStarted", "leaderName", "occupation", "party", "departureMonth",
  "currentDay", "milesTraveled", "currentLandmarkIndex", "pace", "supplies", "weather",
  "currentEvent", "currentRiver", "huntingFood", "huntingAmmoUsed", "daysRested",
  "foodHunted", "riversCrossed", "eventsEncountered",
] as const satisfies readonly (keyof GameState)[];

const pickProgress = (state: Record<string, unknown>) =>
  Object.fromEntries(PROGRESS_FIELDS.map((field) => [field, state[field]]));

// A save that differs from the title screen only in its phase (the first
// tap of a new journey) holds nothing of a journey.
const UNTOUCHED = defineUntouchedProgress("oregon-trail", {
  defaults: pickProgress(defaultState as unknown as Record<string, unknown>),
  ignore: ["gamePhase"],
  // The save holds the whole store state; the progress is PROGRESS_FIELDS
  // and the time.
  layout: "flat",
  progressOf: (saved) => ({ ...pickProgress(saved), lastModified: saved.lastModified }),
});

interface OregonTrailStore extends GameState {
  /** The player's last change to PROGRESS_FIELDS (0: untouched). */
  lastModified: number;
  setPhase: (phase: GamePhase) => void;
  startGame: (name: string, occ: OccupationType, partyNames: string[], month: Month) => void;
  buySupply: (type: string, amount: number) => void;
  /** Takes back a buy (the store screen only allows what was bought on this visit), at the same price. */
  sellSupply: (type: string, amount: number) => void;
  leaveStore: () => void;
  travel: () => void;
  setPace: (pace: PaceType) => void;
  rest: () => void;
  dismissEvent: () => void;
  hunt: (food: number, ammo: number) => void;
  crossRiver: (method: string) => void;
  continueFromLandmark: () => void;
  resetGame: () => void;
  /** A new journey from its first setup step, with the last journey's names, job and month filled in. */
  newJourney: () => void;

  // Cloud sync
  getProgress: () => OregonTrailSyncData;
  setProgress: (data: OregonTrailSyncData) => void;
}

const stamp = progressStamp<OregonTrailStore>(PROGRESS_FIELDS);

export const useOregonTrailStore = create<OregonTrailStore>()(persist((set, get) => ({
  ...defaultState,
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
  setPhase: (phase) => set({ gamePhase: phase }),
  startGame: (name, occ, partyNames, month) => {
    const init = createInitialState(name, occ, partyNames, month);
    set({ ...init, gameStarted: true, gamePhase: "store" });
  },
  buySupply: (type, amount) => {
    const s = get().supplies; const price = STORE_PRICES[type as keyof typeof STORE_PRICES] || 0;
    const cost = price * amount;
    if (s.money >= cost) {
      const ns = { ...s, money: Math.round((s.money - cost) * 100) / 100 };
      if (type === "food") ns.food += amount;
      else if (type === "oxen") ns.oxen += amount;
      else if (type === "clothing") ns.clothing += amount;
      else if (type === "ammunition") ns.ammunition += amount;
      else if (type === "wheel") ns.spareParts = { ...ns.spareParts, wheels: ns.spareParts.wheels + amount };
      else if (type === "axle") ns.spareParts = { ...ns.spareParts, axles: ns.spareParts.axles + amount };
      else if (type === "tongue") ns.spareParts = { ...ns.spareParts, tongues: ns.spareParts.tongues + amount };
      set({ supplies: ns });
    }
  },
  sellSupply: (type, amount) => {
    const s = get().supplies;
    const price = STORE_PRICES[type as keyof typeof STORE_PRICES] || 0;
    const ns = { ...s, spareParts: { ...s.spareParts } };
    const take = (have: number) => Math.min(have, amount);
    let taken = 0;
    if (type === "food") { taken = take(ns.food); ns.food -= taken; }
    else if (type === "oxen") { taken = take(ns.oxen); ns.oxen -= taken; }
    else if (type === "clothing") { taken = take(ns.clothing); ns.clothing -= taken; }
    else if (type === "ammunition") { taken = take(ns.ammunition); ns.ammunition -= taken; }
    else if (type === "wheel") { taken = take(ns.spareParts.wheels); ns.spareParts.wheels -= taken; }
    else if (type === "axle") { taken = take(ns.spareParts.axles); ns.spareParts.axles -= taken; }
    else if (type === "tongue") { taken = take(ns.spareParts.tongues); ns.spareParts.tongues -= taken; }
    // Round to cents: 50 lbs of food at $0.20 is $10, never $9.999999.
    ns.money = Math.round((ns.money + price * taken) * 100) / 100;
    set({ supplies: ns });
  },
  leaveStore: () => set({ gamePhase: "travel" }),
  travel: () => {
    const st = get();
    const alive = st.party.filter(m => !m.leftBehind).length;
    const miles = calculateDailyTravel(st.pace, st.weather, st.supplies.oxen);
    const food = calculateFoodConsumption(st.pace, st.occupation, alive);
    const newMiles = st.milesTraveled + miles;
    const newFood = Math.max(0, st.supplies.food - food);
    const newWeather = getRandomWeather(st.departureMonth);
    const newParty = updatePartyHealth(st.party, st.pace, st.weather, st.supplies.food, st.supplies.clothing);
    const event = getRandomEvent();
    const landmark = checkLandmarkReached(newMiles, st.currentLandmarkIndex);
    let updates: Partial<GameState> = { currentDay: st.currentDay + 1, milesTraveled: newMiles, weather: newWeather, party: newParty,
      supplies: { ...st.supplies, food: newFood } };
    if (event) { updates = { ...updates, ...applyEventEffect(st, event.effect), currentEvent: event, gamePhase: "event", eventsEncountered: st.eventsEncountered + 1 }; }
    else if (landmark !== null) {
      const lm = LANDMARKS[landmark];
      if (lm.hasRiver) { updates = { ...updates, currentLandmarkIndex: landmark, currentRiver: { name: lm.riverName || "", depth: getRiverDepth() }, gamePhase: "river" }; }
      else { updates = { ...updates, currentLandmarkIndex: landmark, gamePhase: "landmark" }; }
    }
    const result = checkGameOver({ ...st, ...updates } as GameState);
    if (result.gameOver) { updates = { ...updates, gamePhase: result.victory ? "victory" : "game_over" }; }
    set(updates);
  },
  setPace: (pace) => set({ pace }),
  rest: () => {
    const st = get();
    const healed = st.party.map(m => m.isSick && Math.random() < 0.3 ? { ...m, isSick: false, sickDays: 0, health: "fair" as const } : m);
    set({ currentDay: st.currentDay + 1, daysRested: st.daysRested + 1, party: healed });
  },
  dismissEvent: () => set({ currentEvent: null, gamePhase: "travel" }),
  hunt: (food, ammo) => {
    const st = get();
    set({ supplies: { ...st.supplies, food: st.supplies.food + food, ammunition: Math.max(0, st.supplies.ammunition - ammo) }, foodHunted: st.foodHunted + food, gamePhase: "travel" });
  },
  crossRiver: (method) => {
    const st = get();
    const result = attemptRiverCrossing(method, st.currentRiver?.depth || 3);
    const riverName = st.currentRiver?.name || "River";
    const ns = { ...st.supplies };
    if (result.lostSupplies) {
      if (result.lostSupplies.food) ns.food = Math.max(0, ns.food - result.lostSupplies.food);
      if (result.lostSupplies.oxen) ns.oxen = Math.max(0, ns.oxen - result.lostSupplies.oxen);
      if (result.lostSupplies.ammunition) ns.ammunition = Math.max(0, ns.ammunition - result.lostSupplies.ammunition);
    }
    if (method === "ferry") ns.money = Math.max(0, ns.money - 20);
    set({
      supplies: ns,
      currentRiver: null,
      currentEvent: createRiverResultEvent(riverName, result),
      riversCrossed: st.riversCrossed + 1,
      gamePhase: "event",
    });
  },
  continueFromLandmark: () => {
    const st = get();
    const lm = LANDMARKS[st.currentLandmarkIndex];
    set({ gamePhase: lm.hasStore ? "store" : "travel" });
  },
  resetGame: () => set(defaultState),
  newJourney: () => {
    const { leaderName, occupation, party, departureMonth } = get();
    set({ ...defaultState, leaderName, occupation, party, departureMonth, gamePhase: "setup_name" });
  },

  // Cloud sync
  getProgress: () => {
    const state = get();
    return {
      gamePhase: state.gamePhase,
      gameStarted: state.gameStarted,
      leaderName: state.leaderName,
      occupation: state.occupation,
      party: state.party,
      departureMonth: state.departureMonth,
      currentDay: state.currentDay,
      milesTraveled: state.milesTraveled,
      currentLandmarkIndex: state.currentLandmarkIndex,
      pace: state.pace,
      supplies: state.supplies,
      weather: state.weather,
      currentEvent: state.currentEvent,
      currentRiver: state.currentRiver,
      huntingFood: state.huntingFood,
      huntingAmmoUsed: state.huntingAmmoUsed,
      daysRested: state.daysRested,
      foodHunted: state.foodHunted,
      riversCrossed: state.riversCrossed,
      eventsEncountered: state.eventsEncountered,
      lastModified: state.lastModified,
    };
  },

  setProgress: (data) => {
    // Taking progress is not a player action: it keeps the time it gets.
    stamp.adopt(() => set({
      gamePhase: data.gamePhase,
      gameStarted: data.gameStarted,
      leaderName: data.leaderName,
      occupation: data.occupation,
      party: data.party,
      departureMonth: data.departureMonth,
      currentDay: data.currentDay,
      milesTraveled: data.milesTraveled,
      currentLandmarkIndex: data.currentLandmarkIndex,
      pace: data.pace,
      supplies: data.supplies,
      weather: data.weather,
      currentEvent: data.currentEvent,
      currentRiver: data.currentRiver,
      huntingFood: data.huntingFood,
      huntingAmmoUsed: data.huntingAmmoUsed,
      daysRested: data.daysRested,
      foodHunted: data.foodHunted,
      riversCrossed: data.riversCrossed,
      eventsEncountered: data.eventsEncountered,
      lastModified: typeof data.lastModified === "number" ? data.lastModified : 0,
    }));
  },
}), {
  name: "oregon-trail-storage",
  version: 1,
  // The whole state, marked as a save of the new code, with a sum of the
  // progress. The code before the sync-time fix has no partialize: after a
  // rollback it keeps the marker and the time of this code while the kid
  // plays on, and the sum then tells that its time is not true
  // (shared/lib/untouchedProgress.ts).
  partialize: (state) => markSavedWithSum(UNTOUCHED, { ...state }),
  // A save of the code before the sync-time fix gets the real time of its
  // progress. The version stays, so that code still loads a new save
  // (shared/lib/untouchedProgress.ts).
  merge: settleOnLoad(UNTOUCHED),
  migrate: (persisted: unknown, version: number) => {
    const data = persisted as Partial<OregonTrailSyncData>;
    if (version === 0) {
      // Fix old weather values from before the rename
      const weatherMap: Record<string, string> = {
        rainy: 'rain',
        snowy: 'snow',
        stormy: 'storm',
      };
      if (typeof data.weather === 'string' && weatherMap[data.weather]) {
        data.weather = weatherMap[data.weather] as GameState['weather'];
      }
    }
    return data;
  },
}));

stamp.attach(useOregonTrailStore);

// A save of the old code has no time: write the time that the load gave it
// once, so that the next load does not make the old journey newer again.
persistSettledSave(useOregonTrailStore, UNTOUCHED);
