"use client";

import { useEffect, useRef, useState } from "react";
import { useVirtualPetStore, type VirtualPetProgress } from "./lib/store";
import {
  PET_SPECIES,
  SHOP_ITEMS,
  calculateMood,
  getMoodEmoji,
  getStage,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// ============================================
// STAT BAR
// ============================================
function StatBar({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">{label}</span>
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
function MiniGame({ onEnd }: { onEnd: (score: number) => void }) {
  const [score, setScore] = useState(0);
  const [treats, setTreats] = useState<{ id: number; x: number; y: number }[]>([]);
  const [timeLeft, setTimeLeft] = useState(15);
  const nextId = useRef(1);

  // Timer
  useEffect(() => {
    if (timeLeft <= 0) {
      onEnd(score);
      return;
    }

    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, score, onEnd]);

  // Spawn treats
  useEffect(() => {
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
  }, [timeLeft]);

  // Move treats down
  useEffect(() => {
    const moveInterval = setInterval(() => {
      setTreats(prev =>
        prev
          .map(t => ({ ...t, y: t.y + 3 }))
          .filter(t => t.y < 100)
      );
    }, 50);

    return () => clearInterval(moveInterval);
  }, []);

  const catchTreat = (id: number) => {
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
            className="absolute text-4xl transition-transform hover:scale-125 active:scale-90"
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

  // Update stats on mount and periodically
  useEffect(() => {
    store.updateFromTime();

    const interval = setInterval(() => {
      store.updateFromTime();
    }, 60000); // Every minute

    return () => clearInterval(interval);
  }, []);

  // Auth sync
  useAuthSync({
    appId: "virtual-pet",
    localStorageKey: "virtual-pet-state",
    getState: store.getProgress,
    setState: store.setProgress,
    debounceMs: 1000,
  });

  const toggleSound = () => {
    store.setProgress({
      ...store.progress,
      settings: {
        ...store.progress.settings,
        soundEnabled: !store.progress.settings.soundEnabled,
      },
    });
  };

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
    return <MiniGame onEnd={(score) => store.endMiniGame(score)} />;
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center min-h-screen bg-amber-50 p-4 select-none"
    >
      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-center mb-4">
        <div className="text-amber-800">
          <span className="font-bold">Day {store.progress.stats.daysCaredFor + 1}</span>
          <span className="ml-2">🔥 {store.progress.stats.currentStreak} streak</span>
        </div>
        <div className="flex items-center gap-2 text-amber-800 font-bold">
          <span>💰</span>
          <span>{store.progress.coins}</span>
        </div>
      </div>

      {/* Pet display */}
      <div className="relative bg-amber-100 rounded-3xl p-8 shadow-lg mb-6 w-full max-w-md">
        {/* Cosmetics */}
        <div className="absolute top-4 right-4 flex gap-1">
          {store.progress.equippedCosmetics.map(id => {
            const item = SHOP_ITEMS.find(i => i.id === id);
            return <span key={id} className="text-2xl">{item?.emoji}</span>;
          })}
        </div>

        {/* Pet */}
        <div className="text-center">
          <div className="text-8xl mb-4 animate-bounce">
            {petEmoji}
          </div>
          <div className="text-2xl mb-2 flex items-center justify-center gap-2">
            <span className="font-bold text-amber-800">{store.progress.pet.name}</span>
            <span>{moodEmoji}</span>
          </div>
          <div className="text-sm text-amber-600 capitalize">
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
      <div className="w-full max-w-md space-y-3 mb-6 bg-white rounded-2xl p-4 shadow">
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

      {/* Action buttons */}
      <div className="grid grid-cols-5 gap-3 w-full max-w-md mb-6">
        {/* Feed button */}
        <div className="relative">
          <button
            onClick={() => {
              if (foodItems.length > 0) {
                store.feed(foodItems[0].itemId);
              }
            }}
            disabled={foodItems.length === 0 || store.progress.pet.sleeping}
            className="w-full aspect-square bg-green-500 hover:bg-green-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
          >
            <span className="text-3xl">🍎</span>
            <span className="text-xs font-bold">Feed</span>
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
            className="w-full aspect-square bg-orange-500 hover:bg-orange-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
          >
            <span className="text-3xl">⚽</span>
            <span className="text-xs font-bold">Toy</span>
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
          className="aspect-square bg-blue-500 hover:bg-blue-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
        >
          <span className="text-3xl">🎮</span>
          <span className="text-xs font-bold">Play</span>
        </button>

        {/* Sleep/Wake button */}
        <button
          onClick={() => store.progress.pet.sleeping ? store.wake() : store.sleep()}
          className={`aspect-square ${
            store.progress.pet.sleeping ? "bg-amber-500 hover:bg-amber-400" : "bg-indigo-500 hover:bg-indigo-400"
          } rounded-2xl flex flex-col items-center justify-center text-white shadow-lg`}
        >
          <span className="text-3xl">{store.progress.pet.sleeping ? "☀️" : "💤"}</span>
          <span className="text-xs font-bold">{store.progress.pet.sleeping ? "Wake" : "Sleep"}</span>
        </button>

        {/* Clean button */}
        <button
          onClick={() => store.clean()}
          disabled={store.progress.pet.sleeping}
          className="aspect-square bg-purple-500 hover:bg-purple-400 disabled:bg-gray-300 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg disabled:shadow-none"
        >
          <span className="text-3xl">🛁</span>
          <span className="text-xs font-bold">Clean</span>
        </button>
      </div>

      {/* Shop button */}
      <button
        onClick={() => store.toggleShop()}
        className="w-full max-w-md bg-amber-500 hover:bg-amber-400 text-white py-3 rounded-xl font-bold shadow-lg mb-4"
      >
        🏪 Shop
      </button>

      {/* Control row */}
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSound}
          className="w-12 h-12 bg-amber-200 hover:bg-amber-300 rounded-full flex items-center justify-center"
        >
          {store.progress.settings.soundEnabled ? "🔊" : "🔇"}
        </button>
        <button
          onClick={() => store.toggleStats()}
          className="w-12 h-12 bg-amber-200 hover:bg-amber-300 rounded-full flex items-center justify-center"
        >
          📊
        </button>
        <FullscreenButton />
        <IOSInstallPrompt />
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
