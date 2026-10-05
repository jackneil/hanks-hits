"use client";

import { useEffect, useRef, useState } from "react";
import { useVirtualPetStore } from "./lib/store";
import {
  PET_SPECIES,
  SHOP_ITEMS,
  calculateMood,
  getMoodEmoji,
  getStage,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { AppNotesSlot } from "@/shared/components/AppNotesSlot";
import { useShortViewport } from "@/shared/hooks/useShortViewport";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { VIRTUAL_PET_INSTRUCTIONS } from "./lib/readAloud";

// ============================================
// STAT BAR
// ============================================
function StatBar({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xl" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-gray-700">{label}</span>
          <span className="font-bold">{Math.round(value)}%</span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${value}%`,
              backgroundColor: color,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================
// MINI GAME (Catch treats)
// ============================================
function MiniGame({ onEnd, paused }: { onEnd: (score: number) => void; paused: boolean }) {
  const [score, setScore] = useState(0);
  const [treats, setTreats] = useState<{ id: number; x: number; y: number }[]>([]);
  const [timeLeft, setTimeLeft] = useState(15);
  const nextId = useRef(1);

  // Timer
  useEffect(() => {
    if (paused) return;
    if (timeLeft <= 0) {
      onEnd(score);
      return;
    }

    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, score, onEnd, paused]);

  // Spawn treats
  useEffect(() => {
    if (paused) return;
    const spawnInterval = setInterval(() => {
      if (timeLeft <= 0) return;

      setTreats(prev => [
        ...prev,
        {
          id: nextId.current++,
          x: 10 + Math.random() * 80,
          y: -10,
        },
      ]);
    }, 800);

    return () => clearInterval(spawnInterval);
  }, [timeLeft, paused]);

  // Move treats down
  useEffect(() => {
    if (paused) return;
    const moveInterval = setInterval(() => {
      setTreats(prev =>
        prev
          // 2% a step: about 2.5 s to fall (it was 1.7 s, fast for a
          // six-year-old).
          .map(t => ({ ...t, y: t.y + 2 }))
          .filter(t => t.y < 100)
      );
    }, 50);

    return () => clearInterval(moveInterval);
  }, [paused]);

  const catchTreat = (id: number) => {
    if (paused) return;
    setTreats(prev => prev.filter(t => t.id !== id));
    setScore(s => s + 1);
  };

  return (
    <div className="fixed inset-0 bg-amber-100 z-50 flex flex-col items-center justify-center">
      <div className="absolute top-4 left-4 text-2xl font-bold text-amber-800">
        Score: {score}
      </div>
      <div className="absolute top-4 right-4 text-2xl font-bold text-amber-800">
        Time: {timeLeft}s
      </div>

      <div className="relative w-full h-full max-w-md mx-auto overflow-hidden">
        {treats.map(treat => (
          <button
            key={treat.id}
            onClick={() => catchTreat(treat.id)}
            aria-label="Catch the cookie"
            className="absolute flex h-14 w-14 -translate-x-1/2 items-center justify-center text-4xl transition-transform active:scale-90"
            style={{
              left: `${treat.x}%`,
              top: `${treat.y}%`,
            }}
          >
            🍪
          </button>
        ))}
      </div>

      <div className="absolute bottom-8 text-center">
        <p className="text-amber-800 font-bold">Tap the cookies!</p>
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export function VirtualPet() {
  const containerRef = useRef<HTMLDivElement>(null);
  const store = useVirtualPetStore();
  // A phone held sideways: the pet on the left, the care buttons beside it.
  const short = useShortViewport();

  const species = PET_SPECIES.find(s => s.id === store.progress.pet.speciesId) || PET_SPECIES[0];
  const stage = getStage(store.progress.stats.daysCaredFor);
  const mood = calculateMood(
    store.progress.pet.hunger,
    store.progress.pet.happiness,
    store.progress.pet.energy,
    store.progress.pet.cleanliness,
    store.progress.pet.sleeping
  );

  const petEmoji = species.evolutions[stage];
  const moodEmoji = getMoodEmoji(mood);

  const recoveryPaused = useRef(false);
  const [recoveryHeld, setRecoveryHeld] = useState(false);

  // Auth sync
  const { ready, synced } = useAuthSync({
    appId: "virtual-pet",
    localStorageKey: "virtual-pet-state",
    getState: store.getProgress,
    setState: store.setProgress,
    debounceMs: 1000,
    pauseForRecovery: () => {
      recoveryPaused.current = true;
      setRecoveryHeld(true);
      return (canonical) => {
        recoveryPaused.current = false;
        setRecoveryHeld(false);
        if (canonical !== undefined) useVirtualPetStore.getState().updateFromTime(canonical);
      };
    },
  });

  // Update stats on mount and periodically, once the sync is ready: the
  // time update (and the daily-visit streak) goes onto the account's pet,
  // not onto an old copy on this device. A visit stamps the time only on
  // the account's pet (`synced`). When the first sync ends after the page
  // ran on the device's copy (the account could not be reached), the effect
  // runs again at once on the account's pet.
  useEffect(() => {
    if (!ready) return;
    if (!recoveryPaused.current) useVirtualPetStore.getState().updateFromTime(synced);

    const interval = setInterval(() => {
      if (!recoveryPaused.current) useVirtualPetStore.getState().updateFromTime(synced);
    }, 60000); // Every minute

    return () => clearInterval(interval);
  }, [ready, synced]);

  const toggleSound = () => store.toggleSound();

  // Get food inventory
  const foodItems = store.progress.inventory.filter(inv => {
    const item = SHOP_ITEMS.find(i => i.id === inv.itemId);
    return item?.type === "food";
  });
  const toyItems = store.progress.inventory.filter(inv => {
    const item = SHOP_ITEMS.find(i => i.id === inv.itemId);
    return item?.type === "toy";
  });

  if (store.isPlaying) {
    return <MiniGame onEnd={(score) => store.endMiniGame(score)} paused={recoveryHeld} />;
  }

  // Care, the shop, the sound and the stats: always on screen (the care
  // buttons started at y=672 on a 549 px phone, under the pet and the
  // stats: phone UX audit 2026-09-29).
  const dock = (
    <div className="flex w-full max-w-md flex-col gap-2">
      {/* Action buttons */}
        <div data-testid="pet-actions" className={`grid w-full max-w-md gap-2 ${short ? "grid-cols-3" : "grid-cols-5"}`}>
          {/* Feed button */}
          <div className="relative">
            <button
              onClick={() => {
                if (foodItems.length > 0) {
                  store.feed(foodItems[0].itemId);
                }
              }}
              disabled={foodItems.length === 0 || store.progress.pet.sleeping}
              className="w-full h-16 bg-green-500 hover:bg-green-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
            >
              <span className="text-2xl" aria-hidden="true">🍎</span>
              <span className="text-sm font-bold">Feed</span>
            </button>
            {foodItems.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">
                {foodItems.reduce((sum, i) => sum + i.quantity, 0)}
              </span>
            )}
          </div>

          {/* Toy button */}
          <div className="relative">
            <button
              onClick={() => {
                if (toyItems.length > 0) {
                  store.useToy(toyItems[0].itemId);
                }
              }}
              disabled={toyItems.length === 0 || store.progress.pet.sleeping}
              className="w-full h-16 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
            >
              <span className="text-2xl" aria-hidden="true">⚽</span>
              <span className="text-sm font-bold">Toy</span>
            </button>
            {toyItems.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">
                {toyItems.reduce((sum, i) => sum + i.quantity, 0)}
              </span>
            )}
          </div>

          {/* Play button */}
          <button
            onClick={() => store.startMiniGame()}
            disabled={store.progress.pet.sleeping || store.progress.pet.energy < 10}
            className="h-16 bg-blue-500 hover:bg-blue-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
          >
            <span className="text-2xl" aria-hidden="true">🎮</span>
            <span className="text-sm font-bold">Play</span>
          </button>

          {/* Sleep/Wake button */}
          <button
            onClick={() => store.progress.pet.sleeping ? store.wake() : store.sleep()}
            className={`h-16 ${
              store.progress.pet.sleeping ? "bg-amber-500 hover:bg-amber-400" : "bg-indigo-500 hover:bg-indigo-400"
            } rounded-2xl flex flex-col items-center justify-center text-white shadow-lg`}
          >
            <span className="text-2xl" aria-hidden="true">{store.progress.pet.sleeping ? "☀️" : "💤"}</span>
            <span className="text-sm font-bold">{store.progress.pet.sleeping ? "Wake" : "Sleep"}</span>
          </button>

          {/* Clean button */}
          <button
            onClick={() => store.clean()}
            disabled={store.progress.pet.sleeping}
            className="h-16 bg-purple-500 hover:bg-purple-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
          >
            <span className="text-2xl" aria-hidden="true">🛁</span>
            <span className="text-sm font-bold">Clean</span>
          </button>
        </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <button
          type="button"
          onClick={() => store.toggleShop()}
          className="min-h-12 rounded-xl bg-amber-500 font-bold text-white shadow-lg hover:bg-amber-400"
        >
          🏪 Shop
        </button>
        <button
          type="button"
          onClick={toggleSound}
          aria-label={store.progress.settings.soundEnabled ? "Sound on" : "Sound off"}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-200 hover:bg-amber-300"
        >
          {store.progress.settings.soundEnabled ? "🔊" : "🔇"}
        </button>
        <button
          type="button"
          onClick={() => store.toggleStats()}
          aria-label="Stats"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-200 hover:bg-amber-300"
        >
          📊
        </button>
      </div>
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-testid="pet-root"
      className={`flex h-full select-none bg-amber-50 ${short ? "flex-row gap-3 p-2" : "flex-col p-3"}`}
    >
      {/* The pet and how it feels: this part scrolls if it must. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-3 overflow-y-auto overscroll-contain pb-2">
        {/* The install pill and a trophy show here, as rows of the page,
            never over the buttons. */}
        <IOSInstallPrompt />
        <AppNotesSlot className="w-full max-w-md" />
        {/* Header: the day, the streak, the coins, and Read it to me. */}
        <div className="flex w-full max-w-md items-center gap-2 text-amber-900">
          <ReadAloudButton text={VIRTUAL_PET_INSTRUCTIONS} variant="icon" />
          <div className="min-w-0 flex-1 text-base">
            <span className="font-bold">Day {store.progress.stats.daysCaredFor + 1}</span>
            <span className="ml-2">🔥 {store.progress.stats.currentStreak} streak</span>
          </div>
          <div className="flex items-center gap-1 font-bold">
            <span aria-hidden="true">💰</span>
            <span>{store.progress.coins}</span>
          </div>
        </div>

      {/* Pet display */}
      <div className="relative w-full max-w-md rounded-3xl bg-amber-100 p-4 shadow-lg short:p-3">
        {/* Cosmetics */}
        <div className="absolute top-4 right-4 flex gap-1">
          {store.progress.equippedCosmetics.map(id => {
            const item = SHOP_ITEMS.find(i => i.id === id);
            return <span key={id} className="text-2xl">{item?.emoji}</span>;
          })}
        </div>

        {/* Pet */}
        <div className="text-center">
          <div className="mb-2 text-7xl short:text-6xl">
            {petEmoji}
          </div>
          <div className="text-2xl mb-2 flex items-center justify-center gap-2">
            <span className="font-bold text-amber-800">{store.progress.pet.name}</span>
            <span>{moodEmoji}</span>
          </div>
          <div className="text-base text-amber-700 capitalize">
            {stage} {species.name} • {mood}
          </div>
        </div>

        {/* Sleeping overlay */}
        {store.progress.pet.sleeping && (
          <div className="absolute inset-0 bg-slate-900/50 rounded-3xl flex items-center justify-center">
            <div className="text-6xl animate-pulse">💤</div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div data-testid="pet-stats" className="grid w-full max-w-md grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-white p-3 shadow">
        <StatBar
          label="Hunger"
          value={store.progress.pet.hunger}
          color={store.progress.pet.hunger < 30 ? "#ef4444" : "#22c55e"}
          icon="🍖"
        />
        <StatBar
          label="Happiness"
          value={store.progress.pet.happiness}
          color={store.progress.pet.happiness < 30 ? "#ef4444" : "#3b82f6"}
          icon="❤️"
        />
        <StatBar
          label="Energy"
          value={store.progress.pet.energy}
          color={store.progress.pet.energy < 30 ? "#ef4444" : "#eab308"}
          icon="⚡"
        />
        <StatBar
          label="Clean"
          value={store.progress.pet.cleanliness}
          color={store.progress.pet.cleanliness < 30 ? "#ef4444" : "#8b5cf6"}
          icon="✨"
        />
      </div>

      {/* Empty-inventory hint - points kids to the shop when Feed/Toy are disabled */}
      {(foodItems.length === 0 || toyItems.length === 0) && (
        <div className="w-full max-w-md text-center text-base font-semibold text-amber-800">
          {foodItems.length === 0 && toyItems.length === 0
            ? "Out of food and toys? Buy some in the 🏪 Shop!"
            : foodItems.length === 0
              ? "Out of food? Buy some in the 🏪 Shop!"
              : "Out of toys? Buy some in the 🏪 Shop!"}
        </div>
      )}

      </div>
      <div className={`shrink-0 ${short ? "flex w-[17rem] flex-col justify-center" : "flex justify-center border-t border-amber-200 pt-2"}`}>
        {dock}
      </div>

      {/* Shop modal */}
      {store.showShop && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-amber-50 rounded-3xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-amber-800">🏪 Shop</h2>
              <div className="flex items-center gap-2 text-amber-800 font-bold">
                <span>💰</span>
                <span>{store.progress.coins}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {SHOP_ITEMS.map(item => (
                <button
                  key={item.id}
                  onClick={() => store.buyItem(item.id)}
                  disabled={store.progress.coins < item.price}
                  className="bg-white rounded-xl p-4 shadow hover:shadow-lg disabled:opacity-50 disabled:hover:shadow text-center"
                >
                  <div className="text-4xl mb-2">{item.emoji}</div>
                  <div className="font-bold text-amber-800">{item.name}</div>
                  <div className="text-amber-600">{item.price} 💰</div>
                </button>
              ))}
            </div>

            <button
              onClick={() => store.toggleShop()}
              className="w-full mt-4 bg-amber-500 hover:bg-amber-400 text-white py-3 rounded-xl font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Stats modal */}
      {store.showStats && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-amber-50 rounded-3xl p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-amber-800 mb-4">📊 Stats</h2>

            <div className="space-y-2 text-amber-800">
              <div className="flex justify-between">
                <span>Days Cared For:</span>
                <span className="font-bold">{store.progress.stats.daysCaredFor}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Feedings:</span>
                <span className="font-bold">{store.progress.stats.totalFeedings}</span>
              </div>
              <div className="flex justify-between">
                <span>Play Sessions:</span>
                <span className="font-bold">{store.progress.stats.totalPlaySessions}</span>
              </div>
              <div className="flex justify-between">
                <span>Current Streak:</span>
                <span className="font-bold">{store.progress.stats.currentStreak} days</span>
              </div>
              <div className="flex justify-between">
                <span>Longest Streak:</span>
                <span className="font-bold">{store.progress.stats.longestStreak} days</span>
              </div>
            </div>

            <h3 className="text-lg font-bold text-amber-800 mt-4 mb-2">Unlocked Pets</h3>
            <div className="flex gap-2">
              {store.progress.unlockedSpecies.map(id => {
                const sp = PET_SPECIES.find(s => s.id === id);
                return (
                  <span key={id} className="text-3xl" title={sp?.name}>
                    {sp?.emoji}
                  </span>
                );
              })}
            </div>

            <button
              onClick={() => store.toggleStats()}
              className="w-full mt-4 bg-amber-500 hover:bg-amber-400 text-white py-3 rounded-xl font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VirtualPet;
