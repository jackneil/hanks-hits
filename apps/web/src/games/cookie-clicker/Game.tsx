"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useCookieClickerStore, type CookieClickerProgress } from "./lib/store";
import {
  BUILDINGS,
  GAME_CONFIG,
  formatNumber,
  formatCps,
  getBuildingById,
  getUpgradeById,
  getAchievementById,
  type BuildingId,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { FullscreenButton } from "@/shared/components/FullscreenButton";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";

// ============================================================================
// MAIN GAME COMPONENT
// ============================================================================

export function CookieClickerGame() {
  const store = useCookieClickerStore();
  const [showOfflinePopup, setShowOfflinePopup] = useState(false);
  const [offlineEarnings, setOfflineEarnings] = useState(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const goldenSpawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goldenExpireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialized = useRef(false);

  // Cloud sync for authenticated users
  useAuthSync<CookieClickerProgress>({
    appId: "cookie-clicker",
    localStorageKey: "cookie-clicker-storage",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 5000, // Cookie clicker state changes frequently
  });

  // Initialize game on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    let popupTimer: ReturnType<typeof setTimeout> | undefined;

    // Apply offline progress
    const earned = store.applyOfflineProgress();
    if (earned > 100) {
      popupTimer = setTimeout(() => {
        setOfflineEarnings(earned);
        setShowOfflinePopup(true);
      }, 0);
    }

    // Recalculate CPS
    const cps = store.calculateCps();
    const clickPower = store.calculateClickPower();
    useCookieClickerStore.setState({
      cookiesPerSecond: cps,
      cookiesPerClick: clickPower,
    });

    return () => {
      if (popupTimer) clearTimeout(popupTimer);
    };
  }, []);

  // Game loop tick
  useEffect(() => {
    tickRef.current = setInterval(() => {
      store.tick();
    }, GAME_CONFIG.TICK_RATE);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
      }
    };
  }, []);

  // Golden cookie spawn loop
  useEffect(() => {
    const scheduleGoldenCookie = () => {
      const delay =
        GAME_CONFIG.GOLDEN_COOKIE_MIN_SPAWN +
        Math.random() *
          (GAME_CONFIG.GOLDEN_COOKIE_MAX_SPAWN -
            GAME_CONFIG.GOLDEN_COOKIE_MIN_SPAWN);

      goldenSpawnRef.current = setTimeout(() => {
        useCookieClickerStore.getState().spawnGoldenCookie();
        goldenExpireRef.current = setTimeout(() => {
          useCookieClickerStore.getState().clearGoldenCookie();
          scheduleGoldenCookie();
        }, GAME_CONFIG.GOLDEN_COOKIE_DURATION);
      }, delay);
    };

    scheduleGoldenCookie();

    return () => {
      if (goldenSpawnRef.current) clearTimeout(goldenSpawnRef.current);
      if (goldenExpireRef.current) clearTimeout(goldenExpireRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-100 to-amber-200 flex flex-col">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* Header with cookie count */}
      <header className="bg-amber-600 text-white p-4 shadow-lg">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">Cookie Clicker</h1>
          <div className="text-5xl font-bold text-yellow-200">
            {formatNumber(store.cookies)} cookies
          </div>
          <div className="text-xl text-amber-200">
            per second: {formatCps(store.cookiesPerSecond)}
          </div>
          {store.frenzyMultiplier > 1 && (
            <div className="text-lg text-green-300 animate-pulse">
              FRENZY! x{store.frenzyMultiplier} CPS!
            </div>
          )}
          {store.clickFrenzyMultiplier > 1 && (
            <div className="text-lg text-pink-300 animate-pulse">
              CLICK FRENZY! x{store.clickFrenzyMultiplier} per click!
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
        {/* Left side - Cookie clicker area */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] lg:min-h-0">
          <CookieButton />
          <div className="mt-4 text-amber-800 text-lg">
            Click power: {formatNumber(store.cookiesPerClick)} per click
          </div>
          <div className="text-amber-600 text-sm">
            Total clicks: {store.totalClicks.toLocaleString()}
          </div>
        </div>

        {/* Right side - Shop */}
        <div className="lg:w-96 flex flex-col gap-4 overflow-hidden">
          {/* Upgrades */}
          <UpgradePanel />

          {/* Buildings */}
          <BuildingPanel />
        </div>
      </main>

      <GoldenCookie />

      {/* Achievement notifications */}
      <AchievementPopups />

      {/* Offline earnings popup */}
      {showOfflinePopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-xl">
            <div className="text-6xl mb-4">Welcome back!</div>
            <p className="text-xl mb-4">
              While you were away, your buildings baked
            </p>
            <div className="text-4xl font-bold text-amber-600 mb-4">
              {formatNumber(offlineEarnings)} cookies!
            </div>
            <button
              onClick={() => setShowOfflinePopup(false)}
              className="btn btn-primary btn-lg"
            >
              Sweet!
            </button>
          </div>
        </div>
      )}

      {/* Stats footer */}
      <footer className="bg-amber-700 text-amber-100 p-2 text-center text-sm">
        All-time cookies baked: {formatNumber(store.totalCookiesBaked)} |
        Achievements: {store.unlockedAchievements.length} |
        Upgrades: {store.purchasedUpgrades.length}
      </footer>
    </div>
  );
}

function GoldenCookie() {
  const store = useCookieClickerStore();
  const goldenCookie = store.goldenCookie;
  if (!goldenCookie) return null;

  return (
    <button
      onClick={() => store.clickGoldenCookie()}
      className="
        fixed z-40 h-20 w-20 -translate-x-1/2 -translate-y-1/2
        rounded-full border-4 border-yellow-200
        bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-600
        text-4xl shadow-2xl shadow-yellow-500/40
        animate-pulse transition-transform hover:scale-110 active:scale-95
      "
      style={{
        left: `${goldenCookie.x}%`,
        top: `${goldenCookie.y}%`,
      }}
      aria-label="Golden cookie"
      title="Golden cookie"
    >
      🍪
    </button>
  );
}

// ============================================================================
// COOKIE BUTTON COMPONENT
// ============================================================================

function CookieButton() {
  const store = useCookieClickerStore();
  const [isPressed, setIsPressed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      // Get click position relative to button for floating text
      let x = 50;
      let y = 50;

      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        if ("clientX" in e) {
          x = ((e.clientX - rect.left) / rect.width) * 100;
          y = ((e.clientY - rect.top) / rect.height) * 100;
        } else if (e.touches && e.touches[0]) {
          x = ((e.touches[0].clientX - rect.left) / rect.width) * 100;
          y = ((e.touches[0].clientY - rect.top) / rect.height) * 100;
        }
      }

      store.clickCookie(x, y);

      // Squish animation
      setIsPressed(true);
      setTimeout(() => setIsPressed(false), 100);
    },
    [store]
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleClick}
        className={`
          w-64 h-64 lg:w-80 lg:h-80
          rounded-full
          bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600
          shadow-2xl
          border-8 border-amber-700
          flex items-center justify-center
          transition-transform duration-100
          hover:from-amber-300 hover:via-amber-400 hover:to-amber-500
          active:shadow-inner
          ${isPressed ? "scale-95" : "scale-100"}
        `}
        style={{
          backgroundImage: `
            radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3) 0%, transparent 50%),
            radial-gradient(circle at 70% 70%, rgba(0,0,0,0.2) 0%, transparent 50%)
          `,
        }}
      >
        <span className="text-8xl lg:text-9xl select-none" role="img" aria-label="cookie">
          🍪
        </span>
      </button>

      {/* Floating text */}
      {store.floatingTexts.map((ft) => (
        <FloatingText
          key={ft.id}
          id={ft.id}
          x={ft.x}
          y={ft.y}
          text={ft.text}
        />
      ))}
    </div>
  );
}

// ============================================================================
// FLOATING TEXT COMPONENT
// ============================================================================

function FloatingText({
  id,
  x,
  y,
  text,
}: {
  id: string;
  x: number;
  y: number;
  text: string;
}) {
  const store = useCookieClickerStore();

  useEffect(() => {
    const timeout = setTimeout(() => {
      store.clearFloatingText(id);
    }, 1000);

    return () => clearTimeout(timeout);
  }, [id, store]);

  return (
    <div
      className="absolute pointer-events-none text-2xl font-bold text-amber-800 animate-float-up"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      {text}
    </div>
  );
}

// ============================================================================
// BUILDING PANEL
// ============================================================================

function BuildingPanel() {
  const store = useCookieClickerStore();

  return (
    <div className="bg-white/80 rounded-xl shadow-lg p-4 flex-1 overflow-auto">
      <h2 className="text-xl font-bold text-amber-800 mb-3">Buildings</h2>
      <div className="space-y-2">
        {BUILDINGS.map((building) => (
          <BuildingItem key={building.id} buildingId={building.id} />
        ))}
      </div>
    </div>
  );
}

function BuildingItem({ buildingId }: { buildingId: BuildingId }) {
  const store = useCookieClickerStore();
  const building = getBuildingById(buildingId);
  const owned = store.buildings[buildingId];
  const cost = store.getBuildingCost(buildingId);
  const canAfford = store.canAffordBuilding(buildingId);

  const handleBuy = () => {
    store.buyBuilding(buildingId);
  };

  return (
    <button
      onClick={handleBuy}
      disabled={!canAfford}
      className={`
        w-full p-3 rounded-lg flex items-center gap-3
        transition-all duration-150
        ${
          canAfford
            ? "bg-amber-100 hover:bg-amber-200 active:bg-amber-300"
            : "bg-gray-100 opacity-50 cursor-not-allowed"
        }
      `}
    >
      <span className="text-3xl">{building.emoji}</span>
      <div className="flex-1 text-left">
        <div className="font-bold text-amber-900">{building.name}</div>
        <div className="text-sm text-amber-700">{building.description}</div>
        <div className="text-xs text-amber-600">
          +{formatCps(building.baseCps)}/s each
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold text-amber-800">{owned}</div>
        <div
          className={`text-sm ${canAfford ? "text-green-600" : "text-red-600"}`}
        >
          {formatNumber(cost)}
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// UPGRADE PANEL
// ============================================================================

function UpgradePanel() {
  const store = useCookieClickerStore();
  const availableUpgrades = store.getAvailableUpgrades();

  if (availableUpgrades.length === 0) {
    return (
      <div className="bg-white/80 rounded-xl shadow-lg p-4">
        <h2 className="text-xl font-bold text-amber-800 mb-2">Upgrades</h2>
        <p className="text-amber-600 text-sm">
          Buy buildings to unlock upgrades!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/80 rounded-xl shadow-lg p-4 max-h-48 overflow-auto">
      <h2 className="text-xl font-bold text-amber-800 mb-3">Upgrades</h2>
      <div className="flex flex-wrap gap-2">
        {availableUpgrades.slice(0, 10).map((upgradeId) => (
          <UpgradeItem key={upgradeId} upgradeId={upgradeId} />
        ))}
      </div>
    </div>
  );
}

function UpgradeItem({ upgradeId }: { upgradeId: string }) {
  const store = useCookieClickerStore();
  const upgrade = getUpgradeById(upgradeId);

  if (!upgrade) return null;

  const canAfford = store.canAffordUpgrade(upgradeId);

  const handleBuy = () => {
    store.buyUpgrade(upgradeId);
  };

  // Determine emoji based on upgrade type
  let emoji = "⬆️";
  if (upgrade.type === "click") emoji = "🖱️";
  if (upgrade.type === "global") emoji = "🌟";
  if (upgrade.targetBuilding) {
    const building = getBuildingById(upgrade.targetBuilding);
    emoji = building.emoji;
  }

  return (
    <button
      onClick={handleBuy}
      disabled={!canAfford}
      className={`
        p-3 rounded-lg flex flex-col items-center min-w-[100px]
        transition-all duration-150 touch-manipulation
        ${
          canAfford
            ? "bg-purple-100 hover:bg-purple-200 active:bg-purple-300 border-2 border-purple-400"
            : "bg-gray-100 opacity-50 cursor-not-allowed border-2 border-gray-300"
        }
      `}
      title={`${upgrade.name}: ${upgrade.description}`}
    >
      <span className="text-2xl">{emoji}</span>
      <div className="text-xs font-bold text-purple-900 truncate max-w-full">
        {upgrade.name}
      </div>
      <div
        className={`text-xs ${canAfford ? "text-green-600" : "text-red-600"}`}
      >
        {formatNumber(upgrade.cost)}
      </div>
    </button>
  );
}

// ============================================================================
// ACHIEVEMENT POPUPS
// ============================================================================

function AchievementPopups() {
  const store = useCookieClickerStore();
  const [displayedAchievements, setDisplayedAchievements] = useState<string[]>(
    []
  );

  useEffect(() => {
    if (store.newAchievements.length > 0) {
      const nextAchievements = store.newAchievements;
      const setupTimer = setTimeout(() => {
        setDisplayedAchievements(nextAchievements);
        store.clearNewAchievements();
      }, 0);

      // Auto-dismiss after 3 seconds
      const timeout = setTimeout(() => {
        setDisplayedAchievements([]);
      }, 3000);

      return () => {
        clearTimeout(setupTimer);
        clearTimeout(timeout);
      };
    }
  }, [store.newAchievements, store]);

  if (displayedAchievements.length === 0) return null;

  return (
    <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 space-y-2">
      {displayedAchievements.map((achievementId) => {
        const achievement = getAchievementById(achievementId);
        if (!achievement) return null;

        return (
          <div
            key={achievementId}
            className="bg-yellow-400 text-yellow-900 px-6 py-4 rounded-xl shadow-xl animate-bounce-in text-center"
          >
            <div className="text-2xl mb-1">🏆 Achievement Unlocked!</div>
            <div className="text-xl font-bold">{achievement.name}</div>
            <div className="text-sm">{achievement.description}</div>
            {achievement.cpsBonus && (
              <div className="text-xs text-yellow-700 mt-1">
                +{achievement.cpsBonus}% CPS bonus!
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// CSS ANIMATIONS (added via style tag)
// ============================================================================

// Add custom animations
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes float-up {
      0% {
        opacity: 1;
        transform: translate(-50%, -50%) translateY(0);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) translateY(-50px);
      }
    }

    @keyframes bounce-in {
      0% {
        opacity: 0;
        transform: scale(0.5);
      }
      50% {
        transform: scale(1.1);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    .animate-float-up {
      animation: float-up 1s ease-out forwards;
    }

    .animate-bounce-in {
      animation: bounce-in 0.5s ease-out forwards;
    }
  `;
  document.head.appendChild(style);
}

export default CookieClickerGame;
