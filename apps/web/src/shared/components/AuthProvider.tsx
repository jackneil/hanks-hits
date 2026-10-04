"use client";

import { getSession, SessionProvider, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ClipSessionWatcher } from "@/shared/clips/service/ClipSessionWatcher";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import { localWords } from "@/lib/local-words";
import { SIGNOUT_BROADCAST_KEY } from "@/lib/storage-keys";
import { consumeGuestHandoffNavigation, isAuthNavigationPending, PROGRESS_SESSION_CHANNEL, reloadProgressPage } from "@/lib/auth-client";
import { ProgressHydrationBoundary, ProgressReloadNotice } from "./ProgressHydrationBoundary";
import { ProgressStorageNotice } from "./ProgressStorageNotice";

const loadAchievements = () => import("./AchievementCelebrations");
const Achievements = dynamic(() => loadAchievements().then(module => module.AchievementCelebrations), { ssr: false });

export function ProgressSessionBoundary({ children }: { children: ReactNode }) {
  const { data, status } = useSession();
  const userId = data?.user?.id;
  const pathname = usePathname();
  const snapshot = useSyncExternalStore(ownerBoundProgress.subscribe, ownerBoundProgress.getSnapshot, ownerBoundProgress.getSnapshot);
  const navigationAttempted = useRef(false);
  const restoreRequest = useRef(0);
  const navigationProofRead = useRef(false);
  // This render check hides A immediately when NextAuth renders B, before the
  // effect can publish B. A passive watcher alone permits a stale render.
  const matches = ownerBoundProgress.matchesSession(status, userId);

  useLayoutEffect(() => {
    localWords.install();
    if (!navigationProofRead.current) {
      navigationProofRead.current = true;
      consumeGuestHandoffNavigation();
    }
    // A newer context observation supersedes any bfcache refresh in flight.
    restoreRequest.current += 1;
    void ownerBoundProgress.updateSession(status, userId);
  }, [status, userId, data]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const request = ++restoreRequest.current;
      // Capture phase runs before game pageshow listeners: they must see their
      // old leases suspended, even when no sign-out broadcast reached the tab.
      void ownerBoundProgress.updateSession("loading");
      const generation = ownerBoundProgress.getSnapshot().generation;
      const current = () => request === restoreRequest.current
        && generation === ownerBoundProgress.getSnapshot().generation;
      void getSession({ broadcast: false }).then(fresh => {
        if (!current()) return;
        return ownerBoundProgress.updateSession(fresh?.user?.id ? "authenticated" : "unauthenticated", fresh?.user?.id);
      }).catch(() => {
        if (current()) ownerBoundProgress.revoke();
      });
    };
    window.addEventListener("pageshow", onPageShow, true);
    return () => {
      restoreRequest.current += 1;
      window.removeEventListener("pageshow", onPageShow, true);
    };
  }, []);

  useEffect(() => {
    const invalidate = () => ownerBoundProgress.revoke();
    const onStorage = (event: StorageEvent) => { if (event.key === SIGNOUT_BROADCAST_KEY) invalidate(); };
    window.addEventListener("storage", onStorage);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(PROGRESS_SESSION_CHANNEL);
      channel.onmessage = event => { if (event.data === "signout") invalidate(); };
    } catch { /* Storage events and session confirmation remain available. */ }
    return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
  }, []);

  useEffect(() => {
    if (!snapshot.needsNavigation || navigationAttempted.current || isAuthNavigationPending()) return;
    navigationAttempted.current = true;
    // A failed navigation leaves the explicit retry control visible. No timer
    // can prove that a new document replaced the old module-level stores.
    try { reloadProgressPage(); } catch { /* Keep stale consumers hidden. */ }
  }, [snapshot.needsNavigation]);

  if (snapshot.status === "revoked") return <ProgressReloadNotice />;
  const publicBeforeBinding = snapshot.ownerKey === null && ["/", "/login", "/signup", "/licenses"].includes(pathname);
  const authPage = pathname === "/login" || pathname === "/signup";
  if (!matches && !publicBeforeBinding && !authPage) {
    return <div role="status" className="min-h-dvh bg-slate-950 text-white flex items-center justify-center p-6">Getting your page ready...</div>;
  }
  return (
    <>
      <ProgressStorageNotice memoryOnly={snapshot.memoryOnly} guestHandoffUnavailable={snapshot.guestHandoffUnavailable} />
      {children}
      {matches && snapshot.status === "ready" && (
        <ProgressHydrationBoundary appId="achievements" loadModule={loadAchievements} fallback={null}>
          <Achievements />
        </ProgressHydrationBoundary>
      )}
    </>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {/* Session publication must never wait for a store hydration boundary. */}
      <ClipSessionWatcher />
      <ProgressSessionBoundary>{children}</ProgressSessionBoundary>
    </SessionProvider>
  );
}

export default AuthProvider;
