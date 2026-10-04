"use client";

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import { ownerBoundProgress } from "./owner-bound-progress";
import { SIGNOUT_BROADCAST_KEY } from "./storage-keys";
import { safeReturnTo } from "@/shared/clips/ui/clipPublishing";

export { useSession, SessionProvider } from "next-auth/react";

export const PROGRESS_SESSION_CHANNEL = "hanks-hits-progress-session";
export const GUEST_HANDOFF_PARAM = "__hh_guest_handoff";
let authNavigationPending = false;
let navigationTarget: string | null = null;

/** The provider must not reload before an in-flight auth request completes. */
export function isAuthNavigationPending(): boolean { return authNavigationPending; }

/** Also used by the visible retry control when navigation did not complete. */
export function reloadProgressPage(): void {
  if (navigationTarget) window.location.assign(new URL(navigationTarget, window.location.origin).href);
  else window.location.reload();
}

function revokeForNavigation(target: string): void {
  authNavigationPending = true;
  navigationTarget = target;
  ownerBoundProgress.revoke();
}

function cleanCallbackUrl(callbackUrl: string): string {
  const target = new URL(safeReturnTo(callbackUrl), window.location.origin);
  target.searchParams.delete(GUEST_HANDOFF_PARAM);
  return `${target.pathname}${target.search}${target.hash}`;
}

function guestCallbackUrl(callbackUrl: string): string {
  ownerBoundProgress.prepareGuestHandoff();
  const target = new URL(cleanCallbackUrl(callbackUrl), window.location.origin);
  const proof = ownerBoundProgress.getGuestHandoffProof();
  if (proof) target.searchParams.set(GUEST_HANDOFF_PARAM, proof);
  return `${target.pathname}${target.search}${target.hash}`;
}

/** Remove navigation authority before a denied storage write can strand it. */
export function consumeGuestHandoffNavigation(): void {
  let cleanTarget = "/";
  try {
    const target = new URL(window.location.href);
    const proofs = target.searchParams.getAll(GUEST_HANDOFF_PARAM);
    if (!proofs.length) return;
    target.searchParams.delete(GUEST_HANDOFF_PARAM);
    cleanTarget = `${target.pathname}${target.search}${target.hash}`;
    window.history.replaceState(window.history.state, "", cleanTarget);
    if (proofs.length === 1 && /^[a-f0-9]{48}$/.test(proofs[0])) {
      ownerBoundProgress.authorizeGuestHandoff(proofs[0]);
    } else ownerBoundProgress.reportGuestHandoffFailure();
  } catch {
    // Without successful URL consumption, no stored unbound receipt is eligible.
    ownerBoundProgress.reportGuestHandoffFailure();
    ownerBoundProgress.cancelGuestHandoff();
    // Retain only a clean retry target, even if navigation is also denied.
    revokeForNavigation(cleanTarget);
    try { window.location.replace(new URL(cleanTarget, window.location.origin).href); }
    catch { /* Revoked consumers stay hidden behind the explicit Reload control. */ }
  }
}

/** Only an explicit sign-in action may carry confirmed guest progress forward. */
export async function signInWithCredentials(email: string, password: string, callbackUrl = "/") {
  const target = guestCallbackUrl(callbackUrl);
  authNavigationPending = true;
  navigationTarget = cleanCallbackUrl(callbackUrl);
  let result;
  try {
    result = await nextAuthSignIn("credentials", { email, password, redirect: false });
  } catch (error) {
    ownerBoundProgress.cancelGuestHandoff();
    authNavigationPending = false;
    navigationTarget = null;
    throw error;
  }
  if (!result || result.error || !result.ok) {
    ownerBoundProgress.cancelGuestHandoff();
    authNavigationPending = false;
    navigationTarget = null;
    return result;
  }
  revokeForNavigation(cleanCallbackUrl(callbackUrl));
  // The source document can be restored from bfcache. Its retry never replays proof.
  try { window.location.assign(new URL(target, window.location.origin).href); }
  catch { /* The provider exposes a Reload control with the clean return path. */ }
  return result;
}

export async function signInWithGoogle(callbackUrl = "/") {
  const target = guestCallbackUrl(callbackUrl);
  // OAuth leaves this document. No subsequent work may reuse its stores.
  revokeForNavigation(cleanCallbackUrl(callbackUrl));
  try {
    return await nextAuthSignIn("google", { callbackUrl: target });
  } catch (error) {
    ownerBoundProgress.cancelGuestHandoff();
    throw error;
  }
}

/** Sign-out never removes frozen originals or another owner's durable partition. */
export async function signOutAndClear(callbackUrl = "/") {
  revokeForNavigation(callbackUrl);
  if (typeof window !== "undefined") {
    // Independent attempts: denied storage must not suppress the other signal
    // or prevent authentication sign-out. Messages contain no player data.
    try { localStorage.setItem(SIGNOUT_BROADCAST_KEY, String(Date.now())); } catch { /* Retain sources. */ }
    try {
      const channel = new BroadcastChannel(PROGRESS_SESSION_CHANNEL);
      channel.postMessage("signout");
      channel.close();
    } catch { /* Session updates still invalidate this document. */ }
  }
  return nextAuthSignOut({ callbackUrl });
}

export { nextAuthSignIn as signIn, nextAuthSignOut as signOut };
