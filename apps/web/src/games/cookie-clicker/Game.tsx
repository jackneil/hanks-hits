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
import { useCoarsePointer } from "@/shared/hooks/useCoarsePointer";
import { usePlayBox } from "@/shared/hooks/usePlayBox";
import { COUNT_BAR, EDGE, GAP, bakeryLayout, touchWords } from "./lib/layout";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { usePointerTap, type TapEvent } from "@/shared/lib/input";

// ============================================================================
// MAIN GAME COMPONENT
// ============================================================================

export function CookieClickerGame() {
  const store = useCookieClickerStore();
  const isCoarse = useCoarsePointer();
  // The bakery is live from mount, so a local gate gives the player a real
  // start moment. Nothing bakes and no golden cookie appears before Play.
  const [hasStarted, setHasStarted] = useState(false);
  const [showOfflinePopup, setShowOfflinePopup] = useState(false);
  const [offlineEarnings, setOfflineEarnings] = useState(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const goldenSpawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goldenExpireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialized = useRef(false);

  // The page started on the device's copy of the bakery (the account could
  // not be reached for READY_FALLBACK_MS), and the first sync then ended:
  // bake the time away on the bakery that the sync left (the account's).
  // This runs inside the sync's own step, before a tick moves lastTick, so
  // the time away of the account's bakery is not lost.
  const bakeAfterLateSync = useCallback(() => {
    if (!hasInitialized.current) return;
    const earned = useCookieClickerStore.getState().applyOfflineProgress(true);
    if (earned > 100) {
      setOfflineEarnings(earned);
      setShowOfflinePopup(true);
    }
  }, []);

  // Cloud sync for authenticated users
  const { ready, synced } = useAuthSync<CookieClickerProgress>({
    appId: "cookie-clicker",
    localStorageKey: "cookie-clicker-storage",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 5000, // Cookie clicker state changes frequently
    onSyncComplete: bakeAfterLateSync,
  });

  // Read by the start step below, which runs once (a change of `synced`
  // must not run its cleanup, which stops the popup's timer).
  const syncedRef = useRef(synced);
  useEffect(() => {
    syncedRef.current = synced;
  }, [synced]);

  // Initialize the game once the sync is ready: the bake while away goes
  // onto the account's progress, not onto an old copy on this device. When
  // the page runs on the device's copy (`synced` is false: the account
  // cannot be reached, or a guest), the bake keeps the time.
  useEffect(() => {
    if (!ready || hasInitialized.current) return;
    hasInitialized.current = true;
    let popupTimer: ReturnType<typeof setTimeout> | undefined;

    // Apply offline progress
    const game = useCookieClickerStore.getState();
    const earned = game.applyOfflineProgress(syncedRef.current);
    if (earned > 100) {
      popupTimer = setTimeout(() => {
        setOfflineEarnings(earned);
        setShowOfflinePopup(true);
      }, 0);
    }

    // Recalculate CPS
    const cps = game.calculateCps();
    const clickPower = game.calculateClickPower();
    useCookieClickerStore.setState({
      cookiesPerSecond: cps,
      cookiesPerClick: clickPower,
    });

    return () => {
      if (popupTimer) clearTimeout(popupTimer);
    };
  }, [ready]);

  // Game loop tick. It starts after the bake while away (the effect above
  // runs first when the sync is ready): a tick moves lastTick, and a tick
  // before that bake took the whole time away from it. A tick before the
  // sync also baked onto an old copy of the bakery.
  useEffect(() => {
    if (!hasStarted || !ready) return;

    tickRef.current = setInterval(() => {
      useCookieClickerStore.getState().tick();
    }, GAME_CONFIG.TICK_RATE);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
      }
    };
  }, [hasStarted, ready]);

  // Golden cookie spawn loop
  useEffect(() => {
    if (!hasStarted) return;

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
  }, [hasStarted]);

  const box = usePlayBox();
  const layout = bakeryLayout(box);

  const cookieArea = (
    <div
      data-testid="cookie-area"
      className="relative flex shrink-0 flex-col items-center justify-center"
      style={layout.sideways ? { flex: 1, minWidth: 0 } : { height: layout.cookieArea }}
    >
      <CookieButton disabled={!hasStarted} size={layout.cookie} />
      {/* A phone kid taps; the words say so (audit S5). */}
      <div className="mt-1 text-center text-base leading-tight text-amber-900">
        {isCoarse
          ? `Tap power: ${formatNumber(store.cookiesPerClick)} per tap`
          : `Click power: ${formatNumber(store.cookiesPerClick)} per click`}
        <span className="text-amber-700">
          {" "}· {isCoarse ? "Taps" : "Clicks"}: {store.totalClicks.toLocaleString()}
        </span>
      </div>
    </div>
  );

  return (
    <div data-testid="cookie-root" className="relative flex h-full flex-col bg-amber-100">
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* The cookie count: always at the top, never scrolled away. */}
      <header
        data-testid="cookie-count"
        className="flex shrink-0 flex-col items-center justify-center bg-amber-600 px-3 text-white shadow-md"
        style={{ minHeight: COUNT_BAR }}
      >
        <div className="flex flex-wrap items-baseline justify-center gap-x-2">
          <span className="text-2xl font-bold text-yellow-100">
            {formatNumber(store.cookies)} {Math.floor(store.cookies) === 1 ? "cookie" : "cookies"}
          </span>
          <span className="text-base text-amber-100">{formatCps(store.cookiesPerSecond)}/sec</span>
        </div>
        {store.frenzyMultiplier > 1 && (
          <div className="text-base font-bold text-green-200">FRENZY! x{store.frenzyMultiplier} cookies a second!</div>
        )}
        {store.clickFrenzyMultiplier > 1 && (
          <div className="text-base font-bold text-pink-200">
            {isCoarse
              ? `TAP FRENZY! x${store.clickFrenzyMultiplier} per tap!`
              : `CLICK FRENZY! x${store.clickFrenzyMultiplier} per click!`}
          </div>
        )}
      </header>

      {/* The cookie and the shop: side by side sideways, stacked upright. */}
      <main
        className={`flex min-h-0 flex-1 ${layout.sideways ? "flex-row" : "flex-col"}`}
        style={{ padding: EDGE, gap: GAP }}
      >
        {cookieArea}
        <div
          data-testid="cookie-shop"
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl"
          style={layout.sideways ? { flex: "none", width: layout.shopWidth } : undefined}
        >
          <UpgradePanel />
          <BuildingPanel />
          <p className="px-1 pb-1 text-center text-sm text-amber-800">
            All-time cookies baked: {formatNumber(store.totalCookiesBaked)} · Achievements:{" "}
            {store.unlockedAchievements.length} · Upgrades: {store.purchasedUpgrades.length}
          </p>
        </div>
      </main>

      {/* Achievement notices hang from the bottom edge of the count bar:
          they never hide the count, the cookie or the shop, and go after 3
          seconds. */}
      <AchievementPopups />

      <GoldenCookie />

      {/* Offline earnings popup - held back until the player presses Play so
          it never covers the start card. It fits a phone held sideways (its
          title was cut under the header at 844x340). */}
      {hasStarted && showOfflinePopup && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div
            role="dialog"
            aria-label="Welcome back"
            className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-center shadow-xl short:p-3"
          >
            <div className="mb-2 text-3xl font-bold short:mb-1 short:text-2xl">Welcome back!</div>
            <p className="mb-2 text-lg short:mb-1">While you were away, your buildings baked</p>
            <div className="mb-3 text-3xl font-bold text-amber-600 short:mb-2 short:text-2xl">
              {formatNumber(offlineEarnings)} cookies!
            </div>
            <button onClick={() => setShowOfflinePopup(false)} className="btn btn-primary btn-lg short:btn-md">
              Sweet!
            </button>
          </div>
        </div>
      )}

      {/* Shared DOM start screen (renders the title once) */}
      {!hasStarted && (
        <GameStartOverlay
          title="Cookie Clicker"
          emoji="🍪"
          subtitle="Bake a mountain of cookies!"
          touchHints={["🍪 Tap the cookie to bake", "🏪 Buy helpers in the shop"]}
          keyboardHints={["🍪 Click the cookie to bake", "🏪 Buy helpers in the shop"]}
          onStart={() => setHasStarted(true)}
        >
          <div className="text-base font-medium opacity-90">
            🏆 Cookies baked: {formatNumber(store.totalCookiesBaked)}
          </div>
        </GameStartOverlay>
      )}
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

function CookieButton({ disabled = false, size }: { disabled?: boolean; size: number }) {
  const clickCookie = useCookieClickerStore((s) => s.clickCookie);
  const floatingTexts = useCookieClickerStore((s) => s.floatingTexts);
  const [isPressed, setIsPressed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Every finger counts: the tap runs on pointerdown, so two thumbs mashing
  // at once give two taps. The button used to count onClick only, and a
  // browser sends no click for either finger of a two-finger gesture, so a
  // two-thumb mash counted nothing.
  const handleTap = useCallback(
    (e: TapEvent<HTMLButtonElement>) => {
      // The start overlay covers the cookie; ignore anything that reaches it.
      if (disabled) return;

      // Get tap position relative to button for floating text
      let x = 50;
      let y = 50;

      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        x = ((e.clientX - rect.left) / rect.width) * 100;
        y = ((e.clientY - rect.top) / rect.height) * 100;
      }

      clickCookie(x, y);

      // Squish animation
      setIsPressed(true);
      setTimeout(() => setIsPressed(false), 100);
    },
    [disabled, clickCookie]
  );
  const cookieTap = usePointerTap<HTMLButtonElement>(handleTap);

  return (
    <div className="relative">
      {/* touch-none: the browser must never turn a second thumb into a
          pinch or a scroll and cancel the press. */}
      <button
        ref={buttonRef}
        {...cookieTap}
        className={`
          touch-none select-none
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
          width: size,
          height: size,
          backgroundImage: `
            radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3) 0%, transparent 50%),
            radial-gradient(circle at 70% 70%, rgba(0,0,0,0.2) 0%, transparent 50%)
          `,
        }}
      >
        <span className="select-none" style={{ fontSize: Math.round(size * 0.5) }} role="img" aria-label="cookie">
          🍪
        </span>
      </button>

      {/* Floating text */}
      {floatingTexts.map((ft) => (
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
  // The action, not the whole store: the store changes every 50 ms tick,
  // and an effect keyed on it restarted this 1 s timer forever, so no
  // "+1" was ever removed (every tap left a div behind).
  const clearFloatingText = useCookieClickerStore((s) => s.clearFloatingText);

  useEffect(() => {
    const timeout = setTimeout(() => clearFloatingText(id), 1000);
    return () => clearTimeout(timeout);
  }, [id, clearFloatingText]);

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
  return (
    <section className="rounded-xl bg-white/85 p-3 shadow">
      <h2 className="mb-2 text-lg font-bold text-amber-900">🏪 Buildings</h2>
      <div className="grid gap-2">
        {BUILDINGS.map((building) => (
          <BuildingItem key={building.id} buildingId={building.id} />
        ))}
      </div>
    </section>
  );
}

function BuildingItem({ buildingId }: { buildingId: BuildingId }) {
  // Only what this row shows: the store changes every 50 ms tick.
  const owned = useCookieClickerStore((s) => s.buildings[buildingId]);
  const cost = useCookieClickerStore((s) => s.getBuildingCost(buildingId));
  const canAfford = useCookieClickerStore((s) => s.cookies >= s.getBuildingCost(buildingId));
  const buyBuilding = useCookieClickerStore((s) => s.buyBuilding);
  const touch = useCoarsePointer();
  const building = getBuildingById(buildingId);

  return (
    <button
      type="button"
      onClick={() => buyBuilding(buildingId)}
      disabled={!canAfford}
      aria-label={`Buy ${building.name} for ${formatNumber(cost)} cookies. You have ${owned}.`}
      className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 touch-manipulation ${
        canAfford ? "bg-amber-100 active:bg-amber-300" : "cursor-not-allowed bg-gray-100 opacity-60"
      }`}
    >
      <span aria-hidden="true" className="text-3xl">
        {building.emoji}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="font-bold text-amber-950">{building.name}</div>
        <div className="text-sm text-amber-800">
          {touchWords(building.description, touch)} · +{formatCps(building.baseCps)}/s
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className="text-lg font-bold text-amber-900">{owned}</div>
        <div className={`text-sm font-bold ${canAfford ? "text-green-700" : "text-red-700"}`}>🍪 {formatNumber(cost)}</div>
      </div>
    </button>
  );
}

// ============================================================================
// UPGRADE PANEL
// ============================================================================

/** The upgrades a kid can buy next: one row that scrolls sideways. */
function UpgradePanel() {
  const available = useCookieClickerStore((s) => s.getAvailableUpgrades().slice(0, 10).join(","));
  const upgradeIds = available ? available.split(",") : [];

  if (upgradeIds.length === 0) {
    return (
      <section className="rounded-xl bg-white/85 p-3 shadow">
        <h2 className="text-lg font-bold text-amber-900">⬆️ Upgrades</h2>
        <p className="text-base text-amber-800">Buy buildings to unlock upgrades!</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-white/85 py-3 shadow">
      <h2 className="mb-2 px-3 text-lg font-bold text-amber-900">⬆️ Upgrades</h2>
      <div data-testid="cookie-upgrades" className="flex gap-2 overflow-x-auto overscroll-x-contain px-3 pb-1">
        {upgradeIds.map((upgradeId) => (
          <UpgradeItem key={upgradeId} upgradeId={upgradeId} />
        ))}
      </div>
    </section>
  );
}

function UpgradeItem({ upgradeId }: { upgradeId: string }) {
  const canAfford = useCookieClickerStore((s) => s.canAffordUpgrade(upgradeId));
  const buyUpgrade = useCookieClickerStore((s) => s.buyUpgrade);
  const touch = useCoarsePointer();
  const upgrade = getUpgradeById(upgradeId);

  if (!upgrade) return null;

  // Determine emoji based on upgrade type (a finger, not a mouse, on a phone)
  let emoji = "⬆️";
  if (upgrade.type === "click") emoji = touch ? "👆" : "🖱️";
  if (upgrade.type === "global") emoji = "🌟";
  if (upgrade.targetBuilding) {
    const building = getBuildingById(upgrade.targetBuilding);
    emoji = building.emoji;
  }
  const description = touchWords(upgrade.description, touch);

  return (
    <button
      type="button"
      onClick={() => buyUpgrade(upgradeId)}
      disabled={!canAfford}
      aria-label={`${upgrade.name}: ${description}. ${formatNumber(upgrade.cost)} cookies.`}
      className={`flex w-40 shrink-0 flex-col items-center rounded-lg border-2 px-2 py-2 transition-colors duration-150 touch-manipulation ${
        canAfford
          ? "border-purple-500 bg-purple-100 active:bg-purple-300"
          : "cursor-not-allowed border-gray-300 bg-gray-100 opacity-60"
      }`}
    >
      <span aria-hidden="true" className="text-2xl">
        {emoji}
      </span>
      {/* w-40 fits every name and effect on one line ("Adamantium Mouse",
          "+5 cookies per tap" were cut to "..." in a w-28 tile); a longer
          one wraps, never cut. */}
      <span className="w-full text-balance text-center text-sm leading-tight font-bold text-purple-950">{upgrade.name}</span>
      <span className="w-full text-balance text-center text-sm leading-tight text-purple-900">{description}</span>
      <span className={`text-sm font-bold ${canAfford ? "text-green-700" : "text-red-700"}`}>🍪 {formatNumber(upgrade.cost)}</span>
    </button>
  );
}

// ============================================================================
// ACHIEVEMENT POPUPS
// ============================================================================

/** How long an achievement notice stays. */
export const ACHIEVEMENT_NOTICE_MS = 3000;

/**
 * A new achievement: a slim notice over the top of the cookie's area for
 * three seconds. It takes no taps.
 *
 * Why: the first tap's "First Cookie" box never went away. The effect was
 * keyed on the whole store object, which changes every 50 ms tick, so its
 * cleanup cancelled the 3 s dismiss 50 ms later, and the re-run after the
 * list was cleared scheduled none (phone UX audit 2026-09-29). Now the
 * effect reads only the list, and the dismiss timer lives in a ref that
 * only a newer notice or the unmount clears.
 */
function AchievementPopups() {
  const newAchievements = useCookieClickerStore((s) => s.newAchievements);
  const clearNewAchievements = useCookieClickerStore((s) => s.clearNewAchievements);
  const touch = useCoarsePointer();
  const [displayed, setDisplayed] = useState<string[]>([]);
  const dismiss = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (newAchievements.length === 0) return;
    const next = newAchievements;
    const show = setTimeout(() => {
      setDisplayed(next);
      clearNewAchievements();
      if (dismiss.current) clearTimeout(dismiss.current);
      dismiss.current = setTimeout(() => setDisplayed([]), ACHIEVEMENT_NOTICE_MS);
    }, 0);
    return () => clearTimeout(show);
  }, [newAchievements, clearNewAchievements]);

  useEffect(
    () => () => {
      if (dismiss.current) clearTimeout(dismiss.current);
    },
    []
  );

  if (displayed.length === 0) return null;

  return (
    <div
      data-testid="cookie-achievement"
      role="status"
      className="pointer-events-none absolute inset-x-2 z-30 flex flex-col items-center gap-1"
      style={{ top: COUNT_BAR - 16 }}
    >
      {displayed.map((achievementId) => {
        const achievement = getAchievementById(achievementId);
        if (!achievement) return null;
        return (
          <div
            key={achievementId}
            className="max-w-full truncate rounded-full bg-yellow-300 px-4 py-1 text-center text-base font-bold text-yellow-950 shadow-md animate-bounce-in"
          >
            🏆 {achievement.name}
            <span className="font-normal">
              {" "}
              · {touchWords(achievement.description, touch)}
              {achievement.cpsBonus ? ` · +${achievement.cpsBonus}%` : ""}
            </span>
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
