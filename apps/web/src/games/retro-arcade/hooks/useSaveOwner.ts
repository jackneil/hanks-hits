"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { ownerKeyFor } from "../lib/ownerKey";

/**
 * The owner key of the save states on this device: "guest" when nobody is
 * signed in, else "u_" + a hash of the user id. Null while the session is
 * still loading, so no save goes to the wrong owner.
 */
export function useSaveOwner(): string | null {
  const { data: session, status } = useSession();
  const userId = status === "authenticated" ? (session?.user?.id ?? "") : "";
  const [owner, setOwner] = useState<{ userId: string; key: string } | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    void ownerKeyFor(userId).then((key) => {
      if (!cancelled) setOwner({ userId, key });
    });
    return () => {
      cancelled = true;
    };
  }, [status, userId]);

  if (status === "loading") return null;
  // Never give out a key that was made for a different user id.
  if (!owner || owner.userId !== userId) return null;
  return owner.key;
}
