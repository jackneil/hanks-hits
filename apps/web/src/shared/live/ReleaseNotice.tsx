"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useLive } from "./LiveProvider";
import { useNudgePlacement } from "@/shared/lib/gameBreaks";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import { progressSyncPresentation } from "@/shared/lib/progressSyncPresentation";

export function ReleaseNotice({ inbox = false }: { inbox?: boolean }) {
  const { update } = useLive();
  const placement = useNudgePlacement("tip");
  const pathname = usePathname();
  const surface = useRef({ pathname, kind: placement.kind });
  surface.current = { pathname, kind: placement.kind };
  const epoch = useRef(0);
  const cancelPending = useRef<(() => void) | null>(null);
  useEffect(() => () => { epoch.current++; cancelPending.current?.(); }, []);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!update || (!inbox && (pathname === "/notifications" || dismissed === update.id || placement.kind === "wait"))) return null;
  async function refresh() {
    cancelPending.current?.();
    const attempt = ++epoch.current;
    const startedAt = pathname;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setBusy(true); setError(null);
    try {
      const lease = ownerBoundProgress.captureLease();
      if (!lease || !ownerBoundProgress.prepareReload()) throw new Error("save");
      const entries = progressSyncPresentation.getSnapshot();
      await Promise.race([
        Promise.all(entries.filter(entry => entry.ownerKey === lease.ownerKey && entry.generation === lease.generation).map(entry => entry.retry())),
        new Promise<never>((_, reject) => {
          cancelPending.current = () => reject(new Error("refresh cancelled"));
          deadline = setTimeout(() => reject(new Error("save timeout")), 8000);
        }),
      ]);
      if (epoch.current !== attempt || surface.current.pathname !== startedAt || (!inbox && surface.current.kind === "wait")) return;
      if (!ownerBoundProgress.isCurrent(lease) || !ownerBoundProgress.prepareReload()
        || progressSyncPresentation.getSnapshot().some(entry => entry.ownerKey === lease.ownerKey
          && (!entry.localDurable || entry.status === "conflict" || entry.status === "storage-error"))) throw new Error("save");
      window.location.reload();
    } catch { if (epoch.current === attempt) setError("Your save needs a moment. Keep playing and try refreshing later."); }
    finally {
      if (deadline) clearTimeout(deadline);
      if (epoch.current === attempt) { cancelPending.current = null; setBusy(false); }
    }
  }
  const card = <aside aria-label="New update available" className="mx-auto my-2 max-w-4xl rounded-xl border border-cyan-300/40 bg-slate-900 p-3 text-white">
    <p className="font-bold">✨ New updates are ready!</p>
    <p className="text-sm text-slate-200">Refresh to get the latest games and improvements.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-11 rounded-lg bg-cyan-300 px-4 font-bold text-slate-950 disabled:opacity-50">{busy ? "Saving..." : "Refresh"}</button>
      {!inbox && <button type="button" disabled={busy} onClick={() => setDismissed(update.id)} className="min-h-11 rounded-lg border border-slate-500 px-4">Later</button>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-amber-200">{error}</p>}
  </aside>;
  return !inbox && placement.kind === "slot" ? createPortal(card, placement.slot) : card;
}
