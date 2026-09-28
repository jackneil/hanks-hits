/**
 * Page lifecycle for the clip service (plan 7, 7.1).
 *
 * - Visibility: a hidden page suspends capture. On iOS and iPadOS the encoders
 *   are also flushed and closed at once (WebKit reclaims them in the
 *   background). Elsewhere a hidden page keeps its encoder. Encoder errors in
 *   the first seconds after the page shows again do not count toward the
 *   disable limit (RESUME_GRACE_MS).
 * - pagehide / pageshow (bfcache): "persisted" pagehide means the page may
 *   come back from the back/forward cache. At pageshow with persisted true the
 *   service reads the signed-in user again, because another person may have
 *   signed in meanwhile.
 * - Web Locks election: only the focused tab captures. A tab that wants to
 *   capture takes the lock "hh-clips-capture" with steal when it is visible
 *   and focused; the tab it took the lock from stops ("other-tab"). A hidden
 *   tab lets the lock go. Without Web Locks every tab captures.
 * - Owner changes (ownerChangeAction): the ring of a guest run is kept only
 *   when sign-in completes within 60 s of that run's end, in this tab, with no
 *   new run. Every other change purges the ring: user to other user, user to
 *   guest, and a bfcache restore with a different owner.
 *
 * Nothing touches window, document or navigator at import time.
 */

import { GUEST_OWNER_KEY } from "../library/ownerKey";
import { holdLock, type LockHold, type WebLocksLike } from "./webLocks";

export const CAPTURE_LOCK = "hh-clips-capture";
/** Keep a guest run for a sign-in that completes this soon after the run ended (plan 7.1). */
export const GUEST_KEEP_MS = 60_000;
/** Encoder errors this soon after the page shows again do not count (plan 7.1). */
export const RESUME_GRACE_MS = 5_000;

// ---------------------------------------------------------------------------
// Owner changes (pure)
// ---------------------------------------------------------------------------

export interface OwnerChange {
  from: string;
  to: string;
  nowMs: number;
  /** Page time of the last runPhase("end"), or null. */
  lastRunEndAtMs: number | null;
  /** A run started after the last end (runPhase("start") with no end yet). */
  runActive: boolean;
  /** The change was seen at a pageshow from the back/forward cache. */
  bfcacheRestore: boolean;
}

/** "keep" the ring for the new owner, or "purge" it first. */
export function ownerChangeAction(change: OwnerChange): "keep" | "purge" {
  if (change.from === change.to) return "keep";
  if (change.bfcacheRestore) return "purge";
  if (change.from !== GUEST_OWNER_KEY) return "purge";
  const end = change.lastRunEndAtMs;
  if (end === null || change.runActive) return "purge";
  const since = change.nowMs - end;
  return since >= 0 && since <= GUEST_KEEP_MS ? "keep" : "purge";
}

/**
 * The signed-in user id from next-auth's session endpoint, read fresh (no
 * cache), or null for a guest. Throws when the endpoint cannot be read, so
 * the caller keeps capture suspended rather than guess the owner.
 */
export async function readSessionUserId(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`session status ${response.status}`);
  const body = (await response.json()) as { user?: { id?: unknown } } | null;
  const id = body?.user?.id;
  return typeof id === "string" && id !== "" ? id : null;
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/**
 * True on iOS and iPadOS, where a hidden page must flush and close its
 * encoders at once (plan 7.1). A platform check, never a version parse:
 * iPadOS reports "MacIntel" with touch points (the same rule as the memory
 * class in runtime/capabilities.ts).
 */
export function hiddenClosesEncoder(nav: { platform?: string; maxTouchPoints?: number } | undefined): boolean {
  const platform = nav?.platform ?? "";
  if (platform === "iPhone" || platform === "iPod" || platform === "iPad") return true;
  return platform === "MacIntel" && (nav?.maxTouchPoints ?? 0) > 1;
}

// ---------------------------------------------------------------------------
// Page events and the capture election
// ---------------------------------------------------------------------------

type Listen = (type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions) => void;

export interface LifecycleEnv {
  doc: { visibilityState: DocumentVisibilityState; hasFocus?: () => boolean; addEventListener: Listen; removeEventListener: Listen } | null;
  win: { addEventListener: Listen; removeEventListener: Listen } | null;
  locks: WebLocksLike | null;
  now: () => number;
}

export interface LifecycleListener {
  /** The page became visible (true) or hidden (false). */
  visibility(visible: boolean): void;
  /** pagehide. persisted: the page may come back from the bfcache. */
  pageHide(persisted: boolean): void;
  /** pageshow. persisted: the page came back from the bfcache. */
  pageShow(persisted: boolean): void;
  /** This tab won (true) or lost (false) the capture election. */
  election(owns: boolean): void;
}

export function browserLifecycleEnv(locks: WebLocksLike | null): LifecycleEnv {
  const hasWindow = typeof window !== "undefined";
  return {
    doc: typeof document !== "undefined" ? (document as unknown as LifecycleEnv["doc"]) : null,
    win: hasWindow ? (window as unknown as LifecycleEnv["win"]) : null,
    locks,
    now: () => performance.now(),
  };
}

export class Lifecycle {
  private listener: LifecycleListener | null = null;
  private want = false;
  private owns: boolean;
  private hold: LockHold | null = null;
  /** The browser refused the lock request itself: no election, every tab captures. */
  private electionBroken = false;
  private shownAtMs: number;
  private readonly removers: Array<() => void> = [];

  constructor(private readonly env: LifecycleEnv) {
    // Without Web Locks there is no election: this tab always captures.
    this.owns = !env.locks;
    this.shownAtMs = env.now();
  }

  get visible(): boolean {
    return (this.env.doc?.visibilityState ?? "visible") === "visible";
  }

  /** True when this tab may capture (it holds the capture lock, or there are no locks). */
  get ownsCapture(): boolean {
    return this.owns;
  }

  /** True while encoder errors must not count: shortly after the page showed again, or while it is hidden. */
  inResumeGrace(): boolean {
    return !this.visible || this.env.now() - this.shownAtMs < RESUME_GRACE_MS;
  }

  start(listener: LifecycleListener): void {
    this.stop();
    this.listener = listener;
    const on = (target: { addEventListener: Listen; removeEventListener: Listen } | null, type: string, fn: (e: Event) => void) => {
      if (!target) return;
      target.addEventListener(type, fn);
      this.removers.push(() => target.removeEventListener(type, fn));
    };
    on(this.env.doc, "visibilitychange", () => {
      const visible = this.visible;
      if (visible) this.shownAtMs = this.env.now();
      this.listener?.visibility(visible);
      this.elect();
    });
    on(this.env.win, "focus", () => this.elect());
    on(this.env.win, "pagehide", (event) => {
      const persisted = Boolean((event as PageTransitionEvent).persisted);
      this.listener?.pageHide(persisted);
      // A held lock keeps a page out of Chrome's bfcache. It is taken again at pageshow.
      this.releaseLock();
    });
    on(this.env.win, "pageshow", (event) => {
      const persisted = Boolean((event as PageTransitionEvent).persisted);
      if (!persisted) return;
      this.shownAtMs = this.env.now();
      this.listener?.pageShow(true);
      this.elect();
    });
  }

  stop(): void {
    for (const remove of this.removers.splice(0)) remove();
    this.listener = null;
    this.releaseLock();
  }

  /** The service wants to capture (a clip-enabled game is attached) or not. */
  wantCapture(want: boolean): void {
    this.want = want;
    if (want) this.elect();
    else this.releaseLock();
  }

  private focused(): boolean {
    if (!this.visible) return false;
    try {
      return this.env.doc?.hasFocus ? this.env.doc.hasFocus() : true;
    } catch {
      return true;
    }
  }

  /** Takes the capture lock when this tab wants it and is the focused tab. */
  private elect(): void {
    const locks = this.env.locks;
    if (!locks || this.electionBroken) return;
    if (!this.want || !this.visible) {
      this.releaseLock();
      return;
    }
    if (this.hold || !this.focused()) return;
    const hold = holdLock(locks, CAPTURE_LOCK, { steal: true });
    this.hold = hold;
    // A steal is granted at once (it never waits), so this tab owns capture
    // from now on. The hold ends when another tab steals the lock.
    this.setOwns(true);
    void hold.lost.then((reason) => {
      if (this.hold !== hold) return;
      this.hold = null;
      if (reason === "failed" || reason === "not-granted") {
        // The browser refused the request itself (not another tab): run with
        // no election, as a browser with no Web Locks does.
        this.electionBroken = true;
        this.setOwns(true);
        return;
      }
      this.setOwns(false);
    });
  }

  private releaseLock(): void {
    const hold = this.hold;
    this.hold = null;
    hold?.release();
    if (this.env.locks && !this.electionBroken) this.setOwns(false);
  }

  private setOwns(owns: boolean): void {
    if (this.owns === owns) return;
    this.owns = owns;
    this.listener?.election(owns);
  }
}
