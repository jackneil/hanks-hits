"use client";

import dynamic from "next/dynamic";
import { ProgressHydrationBoundary } from "@/shared/components/ProgressHydrationBoundary";
import { GameShell } from "@/shared/components";
import { useCookieClickerStore } from "@/games/cookie-clicker/lib/store";

const loadProgressModule = () => import("@/games/cookie-clicker");

const CookieClickerGame = dynamic(
  loadProgressModule,
  {
    ssr: false,
    loading: () => (
      <div className="min-h-full bg-gradient-to-b from-amber-100 to-amber-200 flex flex-col items-center justify-center">
        <div className="text-9xl mb-4 animate-bounce">🍪</div>
        <h1 className="text-4xl font-bold text-amber-800 mb-4">Cookie Clicker</h1>
        <div className="w-64 h-2 bg-amber-300 rounded-full overflow-hidden">
          <div className="h-full bg-amber-600 rounded-full animate-pulse" style={{ width: "30%" }} />
        </div>
        <p className="text-amber-700 mt-4">Loading cookies...</p>
      </div>
    ),
  }
);

function CookieClickerPageContent() {
  return (
    <GameShell
      gameName="Cookie Clicker"
      appId="cookie-clicker"
      canPause={false}
      // Header restart resets only the active session, never saved progress.
      onRestart={() => useCookieClickerStore.getState().resetSession()}
      restartConfirmationMessage="This resets the current session effects and stats. Your cookies, buildings, upgrades, achievements, and settings stay saved."
    >
      <CookieClickerGame />
    </GameShell>
  );
}

export default function CookieClickerPage() {
  return (
    <ProgressHydrationBoundary appId="cookie-clicker" loadModule={loadProgressModule}>
      <CookieClickerPageContent />
    </ProgressHydrationBoundary>
  );
}
