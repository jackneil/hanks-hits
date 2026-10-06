"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import type { ValidAppId, AppProgressData } from "@hank-neil/db/schema";
import { extractTimestamp } from "@/lib/progress-merge";
import { isClearedOnSignOut } from "@/lib/storage-keys";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import { LocalWordsDatabase } from "@/lib/local-words/database";
import { reportProgressToAchievements } from "@/shared/lib/achievements";
import { isUntouchedProgress } from "@/shared/lib/untouchedProgress";
import { sameProgress } from "@/shared/lib/progressStamp";
import { ProgressJournalDatabase } from "@/shared/lib/progressJournalDatabase";
import { ProgressJournalRepository } from "@/shared/lib/progressJournalRepository";
import { cloneProgress, newProvisionalJournal } from "@/shared/lib/progressJournal";
import { ProgressSyncRuntime, exceedsProgressBeaconBudget, progressBeaconDataBudget,
  type ProgressSaveResult } from "@/shared/lib/progressSyncRuntime";
import { acknowledgeResolvedGuests, inventoryGuestJournals } from "@/shared/lib/guestProgressRecovery";
import { inventoryBakeryJournals } from "@/games/cookie-clicker/lib/import-progress-journals";
import { progressSyncPresentation, type RecoveryDialog } from "@/shared/lib/progressSyncPresentation";

export const READY_FALLBACK_MS = 10_000;
const RETRY_FIRST_MS = 2_000, RETRY_MAX_MS = 30_000;
const LARGE_SAVE_MS = 500;
type SyncStatus = "idle" | "syncing" | "synced" | "error";
type Options<T extends AppProgressData> = {
  appId: ValidAppId;
  localStorageKey: string;
  getState: () => T;
  setState: (data: T) => void;
  debounceMs?: number;
  onSyncComplete?: (source: "local" | "server") => void;
  /** Suspend automatic progress synchronously, before the displayed choice is captured. */
  pauseForRecovery?: () => ((synced?: boolean) => void);
  freshProgress?: () => T;
};
type View = { generation: number; syncStatus: SyncStatus; lastSynced: Date | null; initialized: boolean; synced: boolean; offline: boolean };
const initialView = (generation: number): View => ({ generation, syncStatus: "idle", lastSynced: null, initialized: false, synced: false, offline: false });

/** Compatibility for old test fixtures; owner revocation now lives in the document authority. */
export function __unsafeResetForeignPurgeLockForTests() { /* No hook-global authority remains. */ }
const retryable = ({ status }: ProgressSaveResult) => status === null || status >= 500 || status === 408 || status === 429;

/** One mounted owner lease, one journal writer, one serialized revision-aware runtime. */
export function useAuthSync<T extends AppProgressData>({ appId, localStorageKey, getState, setState,
  debounceMs = 2000, onSyncComplete, pauseForRecovery, freshProgress }: Options<T>) {
  if (process.env.NODE_ENV !== "production" && !isClearedOnSignOut(localStorageKey)) {
    throw new Error(`useAuthSync localStorageKey "${localStorageKey}" is not covered by signOutAndClear`);
  }
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const owner = useSyncExternalStore(ownerBoundProgress.subscribe, ownerBoundProgress.getSnapshot, ownerBoundProgress.getSnapshot);
  const hydrated = ownerBoundProgress.isHydrated(localStorageKey);
  // A game switch gets a different callback cell. Old cleanup cannot capture
  // the next game's getters while React installs the new effect.
  const callbacks = useMemo(() => ({ getState, setState, onSyncComplete, pauseForRecovery, freshProgress }), [appId, localStorageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { Object.assign(callbacks, { getState, setState, onSyncComplete, pauseForRecovery, freshProgress }); },
    [callbacks, getState, setState, onSyncComplete, pauseForRecovery, freshProgress]);
  const [view, setView] = useState(() => initialView(owner.generation));
  const force = useRef<(() => Promise<void>) | null>(null);
  const matches = ownerBoundProgress.matchesSession(status, userId);

  useEffect(() => {
    if (!hydrated || !ownerBoundProgress.matchesSession(status, userId)) return;
    const capturedLease = ownerBoundProgress.captureLease();
    if (!capturedLease) return;
    const lease = capturedLease;
    let mounted = true, preserving = true;
    const current = () => mounted && ownerBoundProgress.isCurrent(lease) && ownerBoundProgress.matchesSession(status, userId);
    const writerId = crypto.randomUUID(), id = `${appId}:${writerId}`;
    let runtime: ProgressSyncRuntime<T> | null = null, repository: ProgressJournalRepository | null = null;
    let construction: Promise<void> | null = null, operation: Promise<void> | null = null;
    let choiceOperation: Promise<ProgressSaveResult> | null = null, departing: T | null = null;
    let refreshRequested = false;
    const database = new ProgressJournalDatabase(), words = new LocalWordsDatabase();
    let timer: ReturnType<typeof setTimeout> | null = null, attempts = 0;
    let timerDue = 0, timerPurpose: "edit" | "retry" = "edit";
    const beaconDataBuffer = new Uint8Array(userId ? progressBeaconDataBudget(userId) : 0);
    let largeSave = false;
    let lastObserved = "", lastReported = "", completed = false, lastSavedRevision: string | null = null;
    let releasePause: ((synced?: boolean) => void) | null = null, choiceBusy = false, dialogClosed = true;
    let dialogGeneration = 0;
    let localView = initialView(lease.generation);
    setView(localView);
    const setLocalView = (patch: Partial<View>) => {
      if (!current()) return;
      const next = { ...localView, ...patch };
      if (Object.keys(next).some(key => next[key as keyof View] !== localView[key as keyof View])) {
        localView = next; setView(next);
      }
    };
    const closeDialog = (dispose = false) => {
      dialogClosed = true;
      if (choiceBusy && !dispose) return;
      const release = releasePause; releasePause = null;
      const snapshot = runtime?.snapshot(), row = snapshot?.journal;
      release?.(!dispose && current() ? snapshot?.phase === "ready" && !!row && !row.provisional && !row.conflict && !row.forceWrite : undefined);
    };
    const openDialog = (): RecoveryDialog | null => {
      if (!current() || !runtime || choiceBusy) return null;
      closeDialog();
      const generation = ++dialogGeneration;
      releasePause = callbacks.pauseForRecovery?.() ?? null;
      dialogClosed = false;
      runtime.capture();
      const displayed = runtime.choice();
      if (!displayed) { closeDialog(); return null; }
      const options = [{ id: "local", label: "This device", data: displayed.local },
        ...(displayed.remote.data ? [{ id: "server", label: "Cloud save", data: displayed.remote.data }] : []),
        ...displayed.alternatives.filter(copy => !sameProgress(copy.data, displayed.local) && !sameProgress(copy.data, displayed.remote.data))
          .map((copy, index) => ({ id: copy.id, label: `Retained save ${index + 1}`, data: copy.data }))];
      const fresh = displayed.remote.data === null ? callbacks.freshProgress?.() : undefined;
      if (fresh) options.push({ id: "fresh", label: "Start fresh", data: fresh });
      return { options, cloudMissing: displayed.remote.data === null,
        close: () => { if (generation === dialogGeneration) closeDialog(); },
        choose: optionId => {
          if (!current() || !runtime || generation !== dialogGeneration || dialogClosed || choiceBusy || !options.some(option => option.id === optionId)) return Promise.resolve({ ok: false, status: null });
          choiceBusy = true;
          choiceOperation = (async () => { try {
            const selected = optionId === "local" || optionId === "server" ? optionId
              : optionId === "fresh" && fresh ? { empty: fresh } : { alternativeId: optionId };
            const result = await runtime!.choose(displayed, selected);
            if (current() && repository) await acknowledgeResolvedGuests({ appId, ownerId: userId!, authority: ownerBoundProgress, lease, repository });
            if (result.ok) dialogClosed = true;
            publish();
            if (!result.ok && retryable(result)) schedule(RETRY_FIRST_MS, "retry");
            return result;
          } finally {
            choiceBusy = false;
            choiceOperation = null;
            if (dialogClosed) closeDialog();
            schedulePending();
            if (refreshRequested && (!timer || timerPurpose === "edit")) queueMicrotask(() => { void run(); });
          } })();
          return choiceOperation;
        } };
    };
    const publish = () => {
      if (!current() || !runtime) return;
      const snapshot = runtime.snapshot(), row = snapshot.journal, state = runtime.status();
      const synced = state === "saved" && !!row;
      const syncStatus: SyncStatus = state === "saved" ? "synced" : state === "saving" || state === "pending" ? "syncing" : "error";
      const revision = state === "saved" ? row?.acknowledged.revision ?? null : null;
      const lastSynced = revision && revision !== lastSavedRevision ? new Date() : localView.lastSynced;
      if (revision) lastSavedRevision = revision;
      setLocalView({ syncStatus, lastSynced, initialized: snapshot.phase === "ready", synced });
      progressSyncPresentation.publish({ id, appId, ownerKey: lease.ownerKey, generation: lease.generation,
        status: state, localDurable: repository?.isDurable() ?? false, retry: run, open: openDialog });
      if (row?.conflict) completed = false;
      if (synced && !completed) {
        completed = true;
        callbacks.onSyncComplete?.(sameProgress(callbacks.getState(), row.acknowledged.data) ? "server" : "local");
      }
    };
    const construct = () => {
      if (construction) return construction;
      construction = (async () => {
        if (!userId || !current()) return;
        repository = await ProgressJournalRepository.open({ authority: ownerBoundProgress, lease, database, words,
          appId, ownerId: userId, writerId, maySave: () => preserving && ownerBoundProgress.isCurrent(lease),
          onDurable: publish, additionalRecovery: async () => {
            const guest = await inventoryGuestJournals({ appId, ownerId: userId, authority: ownerBoundProgress, lease, words });
            const bakery = appId === "cookie-clicker" ? inventoryBakeryJournals(ownerBoundProgress, lease, userId) : { copies: [], unavailable: false };
            return { copies: [...guest.copies, ...bakery.copies], unavailable: guest.unavailable || bakery.unavailable };
          } });
        if (!current()) {
          // A route can leave while IndexedDB opens. Keep the snapshot captured
          // by cleanup, using only the still-valid preservation lease.
          if (departing && preserving && ownerBoundProgress.isCurrent(lease)) {
            repository.persist(JSON.stringify(newProvisionalJournal(appId, userId, writerId, departing)), []);
          }
          return;
        }
        runtime = new ProgressSyncRuntime<T>({ appId, ownerId: userId, ownerKey: lease.ownerKey, writerId, repository,
          maySave: current, getLive: () => callbacks.getState(), applyLive: data => { if (current()) callbacks.setState(data); },
          isUntouched: data => (extractTimestamp(data) ?? 0) <= 0 || isUntouchedProgress(appId, data),
          requestId: () => crypto.randomUUID(), onOwnerChanged: () => ownerBoundProgress.revoke(), onChange: publish });
        runtime.capture();
      })().catch(() => { construction = null; if (current()) setLocalView({ syncStatus: "error" }); });
      return construction;
    };
    const editDelay = () => largeSave ? Math.min(debounceMs, LARGE_SAVE_MS) : debounceMs;
    function schedule(delay: number, purpose: "edit" | "retry" = "edit") {
      if (!current() || !userId) return;
      const due = Date.now() + delay;
      if (timer) {
        // Edits can bring an ordinary deadline forward, but never defeat backoff.
        if (timerPurpose === "retry" && purpose === "edit") return;
        if (timerPurpose === purpose && timerDue <= due) return;
        clearTimeout(timer);
      }
      timerPurpose = purpose; timerDue = due;
      timer = setTimeout(() => { timer = null; timerDue = 0; void run(); }, delay);
    }
    function schedulePending() {
      if (!current() || runtime?.status() !== "pending") return;
      changed();
      schedule(editDelay());
    }
    function run(refresh = false): Promise<void> {
      if (!current() || !userId) return Promise.resolve();
      refreshRequested ||= refresh;
      if (choiceBusy) { runtime?.capture(); return choiceOperation?.then(() => {}) ?? Promise.resolve(); }
      if (operation) { runtime?.capture(); return operation; }
      if (timer) { clearTimeout(timer); timer = null; timerDue = 0; }
      operation = (async () => {
        await construct();
        if (!current() || !runtime || !repository) { schedule(RETRY_FIRST_MS, "retry"); return; }
        const refresh = refreshRequested; refreshRequested = false;
        const result = await runtime.save(refresh);
        if (!current()) return;
        const acknowledged = await acknowledgeResolvedGuests({ appId, ownerId: userId, authority: ownerBoundProgress, lease, repository });
        publish();
        const state = runtime.status();
        if (result.ok) {
          attempts = 0;
          if (!acknowledged) schedule(RETRY_FIRST_MS, "retry");
        } else if (state !== "conflict" && (retryable(result) || result.status === 409)) {
          schedule(Math.min(RETRY_FIRST_MS * 2 ** Math.min(attempts++, 4), RETRY_MAX_MS), "retry");
        }
      })().catch(() => { if (current()) { setLocalView({ syncStatus: "error" }); schedule(RETRY_FIRST_MS, "retry"); } })
        .finally(() => { operation = null; publish(); schedulePending(); if (refreshRequested && !timer) queueMicrotask(() => { void run(); }); });
      return operation;
    }
    const changed = () => {
      if (!current()) return;
      const raw = JSON.stringify(callbacks.getState());
      if (raw === lastObserved) return;
      lastObserved = raw;
      largeSave = exceedsProgressBeaconBudget(raw, beaconDataBuffer);
      runtime?.capture();
      if (userId) schedule(editDelay());
    };
    const off = ownerBoundProgress.subscribeStoreWrites(localStorageKey, changed);
    const poll = setInterval(() => {
      if (!current()) return;
      changed();
      if (appId !== "achievements") {
        const state = callbacks.getState(), raw = JSON.stringify(state);
        if (raw !== lastReported) { lastReported = raw; reportProgressToAchievements(appId, state as Record<string, unknown>); }
      }
    }, 1000);
    const flush = () => { if (current()) runtime?.flush(); };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    const online = () => { void run(true); };
    const storage = (event: StorageEvent) => {
      if (!ownerBoundProgress.isScopedStorageEvent(event, localStorageKey)) return;
      if (event.key === null) { void run(true); return; }
      // A running idle game can write many times per second in another tab.
      // Coalesce those notifications without moving an existing deadline.
      refreshRequested = true; schedule(Math.max(debounceMs, 1000));
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("online", online);
    window.addEventListener("focus", online);
    window.addEventListener("pageshow", online);
    window.addEventListener("storage", storage);
    const fallback = setTimeout(() => setLocalView({ offline: true }), READY_FALLBACK_MS);
    force.current = run;
    if (userId) void run();
    return () => {
      if (current() && !runtime) departing = cloneProgress(callbacks.getState());
      flush(); closeDialog(true); mounted = false;
      runtime?.deactivate();
      if (force.current === run) force.current = null;
      off(); clearInterval(poll); clearTimeout(fallback); if (timer) clearTimeout(timer);
      window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("online", online);
      window.removeEventListener("focus", online); window.removeEventListener("pageshow", online); window.removeEventListener("storage", storage);
      progressSyncPresentation.remove(id);
      // Let already-authorized preservation finish, while runtime deactivation
      // fences all response application and further network work.
      void Promise.allSettled([construction, operation, choiceOperation]).then(async () => { await repository?.settle(); await repository?.drain(); })
        .finally(() => { preserving = false; database.close(); words.close(); });
    };
  }, [appId, localStorageKey, debounceMs, callbacks, hydrated, owner.generation, status, userId]);

  const activeView = view.generation === owner.generation ? view : initialView(owner.generation);
  const forceSync = useCallback(async () => { await force.current?.(); }, []);
  return { isAuthenticated: status === "authenticated" && !!userId, isGuest: status === "unauthenticated",
    syncStatus: matches ? activeView.syncStatus : "idle" as SyncStatus, lastSynced: matches ? activeView.lastSynced : null, forceSync,
    ready: matches && hydrated && (status === "unauthenticated" || activeView.initialized || activeView.offline),
    synced: matches && status === "authenticated" && activeView.synced };
}

export default useAuthSync;
