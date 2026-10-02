/**
 * The tab's clip service reference and the session bus, in a module with no
 * imports, so the public barrel (and the app-wide session watcher) can use
 * them without pulling the service code into every page. ClipService.ts sets
 * the service when ClipProvider starts it (after the flag verdict), with a
 * dynamic import.
 *
 * Session bus: ClipSessionWatcher (mounted once for the whole app, inside
 * next-auth's SessionProvider) publishes the signed-in user id each time the
 * session changes, on every page. The clip service and the library client
 * listen, so an owner change is seen when it happens (for example a sign-in
 * that another tab completes while this tab shows a page with no game), not
 * only when a game page mounts again (plan 7.1 owner rules, plan 8.1 owner
 * partitions). A sign-in in this tab leaves the page for Google and comes
 * back with a full page load.
 * A published null means "next-auth has no session". That is also what
 * next-auth reports when its own fetch failed (offline), so a listener must
 * not treat null as a confirmed guest without its own check.
 */

import type { ClipServiceApi } from "./contract";

let current: ClipServiceApi | null = null;

/** The tab's clip service, or null: on the server, while clips are off, and before a clip-enabled game mounts. */
export function getClipService(): ClipServiceApi | null {
  return current;
}

/** @internal ClipService.ts only. */
export function setClipService(service: ClipServiceApi | null): void {
  current = service;
}

// ---------------------------------------------------------------------------
// Session bus
// ---------------------------------------------------------------------------

type SessionListener = (userId: string | null) => void;

let session: { userId: string | null } | null = null;
const sessionListeners = new Set<SessionListener>();

/** The newest published session, or null before the watcher published one. */
export function currentSessionUser(): { userId: string | null } | null {
  return session;
}

/** Publishes the signed-in user id (null: next-auth has no session). Listeners hear only a change. */
export function publishSessionUser(userId: string | null): void {
  if (session && session.userId === userId) return;
  session = { userId };
  for (const listener of [...sessionListeners]) {
    try {
      listener(userId);
    } catch {
      // One bad listener must not stop the others.
    }
  }
}

/** Calls `listener` with each new session user. Returns the remover. */
export function onSessionUser(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

/** Forgets the published session and every listener (tests). */
export function resetSessionBusForTests(): void {
  session = null;
  sessionListeners.clear();
}
