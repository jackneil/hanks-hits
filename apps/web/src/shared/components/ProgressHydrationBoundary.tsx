"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ownerBoundProgress, PROGRESS_STORAGE_KEYS } from "@/lib/owner-bound-progress";
import { reloadProgressPage } from "@/lib/auth-client";

export function ProgressReloadNotice() {
  return (
    <div role="alert" className="min-h-dvh bg-slate-950 text-white flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p>This page needs to reload before you keep playing.</p>
      <button type="button" className="min-h-11 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white" onClick={reloadProgressPage}>Reload</button>
    </div>
  );
}

/** Load outside the blocked children, then wait for the store's actual merge. */
export function ProgressHydrationBoundary({ appId, loadModule, children, fallback }: {
  appId: string;
  loadModule: () => Promise<unknown>;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const snapshot = useSyncExternalStore(ownerBoundProgress.subscribe, ownerBoundProgress.getSnapshot, ownerBoundProgress.getSnapshot);
  const [completed, setCompleted] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const logicalKey = PROGRESS_STORAGE_KEYS[appId];

  useEffect(() => {
    let active = true;
    // The loader imports only this route. Rendering children to cause the import
    // would mount game effects before hydration, or deadlock behind this gate.
    void loadModule().then(async () => {
      if (!logicalKey) throw new Error("Unregistered progress route.");
      await ownerBoundProgress.whenHydrated(logicalKey);
      if (active) setCompleted(snapshot.generation);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [loadModule, logicalKey, snapshot.generation]);

  if (snapshot.status === "revoked" || failed) return <ProgressReloadNotice />;
  if (snapshot.status !== "ready" || completed !== snapshot.generation || !ownerBoundProgress.isHydrated(logicalKey)) {
    if (fallback !== undefined) return fallback;
    return <div role="status" className="min-h-dvh bg-slate-950 text-white flex items-center justify-center p-6">Getting your game ready...</div>;
  }
  return <>{children}</>;
}

const loadAchievementStore = () => import("@/shared/lib/achievements");

/** The trophy route reads the same global store as celebrations. */
export function AchievementsHydrationBoundary({ children }: { children: ReactNode }) {
  return <ProgressHydrationBoundary appId="achievements" loadModule={loadAchievementStore}>{children}</ProgressHydrationBoundary>;
}
