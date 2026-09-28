"use client";

/**
 * Publishes the signed-in user id on the clip session bus (registry.ts), on
 * every page. AuthProvider mounts it once, inside next-auth's
 * SessionProvider. It renders nothing, loads no clip code (registry.ts has
 * no imports), and runs one effect per session change.
 *
 * Why on every page: the clip service and the library client must see an
 * owner change when it happens (plan 7.1, 8.1). A sign-in on the /login page
 * has no game mounted, so a watcher inside ClipProvider would miss it.
 */

import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { publishSessionUser } from "./registry";

export function ClipSessionWatcher(): null {
  const { data, status } = useSession();
  const userId = data?.user?.id ?? null;
  useEffect(() => {
    // "loading": next-auth has not read the session yet. Nothing is known.
    if (status === "loading") return;
    publishSessionUser(userId);
  }, [status, userId]);
  return null;
}
