"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { AppProgressData } from "@hank-neil/db/schema";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import { progressSyncPresentation, type ProgressPresentation, type RecoveryDialog } from "@/shared/lib/progressSyncPresentation";
import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";
import { extractGameStats } from "@/shared/lib/gameStatExtractor";
import { useShellOverlay } from "@/shared/lib/shellOverlays";

function Summary({ appId, data }: { appId: string; data: AppProgressData }) {
  const stats = extractGameStats(appId, data as Record<string, unknown>, new Date().toISOString());
  const details = [stats.primaryStat, ...stats.secondaryStats].filter(row => row !== null);
  const settings = data.settings;
  if (settings && typeof settings === "object") {
    for (const [key, value] of Object.entries(settings)) {
      if (!["boolean", "string", "number"].includes(typeof value)) continue;
      details.push({ label: key.replace(/([a-z])([A-Z])/g, "$1 $2"), value: typeof value === "boolean" ? value ? "On" : "Off" : String(value) });
    }
  }
  if (appId === "cookie-clicker") {
    if (typeof data.cookies === "number") details.unshift({ label: "Cookies available", value: Math.floor(data.cookies).toLocaleString() });
    if (data.buildings && typeof data.buildings === "object") details.push({ label: "Helpers", value: Object.values(data.buildings).reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0).toLocaleString() });
    if (Array.isArray(data.purchasedUpgrades)) details.push({ label: "Upgrades", value: data.purchasedUpgrades.length.toLocaleString() });
  }
  const collection = appId === "drawing-app" ? data.savedArtworks : appId === "drum-machine" ? data.savedBeats : null;
  const items = Array.isArray(collection) ? collection.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
  return <>
    {details.length ? <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
    {details.map((row, index) => <div key={`${row.label}:${index}`} className="contents">
      <dt className="capitalize text-slate-600">{row.label}</dt><dd className="break-words text-right font-medium text-slate-950">{row.value}</dd>
    </div>)}
    </dl> : !collection && <p className="mt-2 text-sm text-slate-600">Saved progress and preferences.</p>}
    {collection && <details open={items.length <= 5} className="mt-3 text-sm text-slate-700">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">{items.length} saved {appId === "drawing-app" ? "drawings" : "beats"}</summary>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => <li key={index} className="flex items-center gap-2 break-words">
          {typeof item.thumbnail === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(item.thumbnail)
            // Local saved-artwork thumbnails do not need the Next image service.
            // eslint-disable-next-line @next/next/no-img-element
            && <img src={item.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded border border-slate-300 object-contain" />}
          <span>{typeof item.name === "string" ? item.name : "Untitled"}
            {typeof item.bpm === "number" && <span className="block text-xs">{item.bpm} beats per minute</span>}
          </span>
        </li>)}
      </ul>
    </details>}
  </>;
}

function RecoveryModal({ entry, view, close, refresh }: {
  entry: ProgressPresentation; view: RecoveryDialog; close: () => void; refresh: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true);
  useShellOverlay(true);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // StrictMode replays setup synchronously. Retire the token only when the
      // dialog really left, rather than invalidating the still-visible choice.
      queueMicrotask(() => { if (!alive.current) view.close(); });
    };
  }, [view]);
  const choose = async (id: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await view.choose(id);
      if (!alive.current) return;
      if (result.ok) close();
      else setError(result.status === 409 ? "The saves changed. Refresh the choices before choosing again."
        : "The save could not finish. Keep this page open and try again.");
    } catch { if (alive.current) setError("The save could not finish. Keep this page open and try again."); }
    finally { if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} aria-labelledby="progress-recovery-title" aria-describedby="progress-recovery-description"
    onCancel={event => { event.preventDefault(); close(); }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-300 bg-white p-5 text-slate-950 shadow-2xl backdrop:bg-slate-950/70">
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-sm font-bold text-blue-700">{getGameMetadata(entry.appId).name}</p>
        <h2 id="progress-recovery-title" className="mt-1 text-xl font-bold">Choose a save</h2></div>
      <button type="button" aria-label="Close save choices" onClick={close} className="min-h-11 min-w-11 rounded-lg border border-slate-300 text-xl focus-visible:outline-2 focus-visible:outline-blue-700">×</button>
    </div>
    <p id="progress-recovery-description" className="mt-3 text-sm leading-6 text-slate-700">Review these copies, then choose which one to use on this device and your account.</p>
    {view.cloudMissing && <p className="mt-2 text-sm text-slate-700">There is no cloud save to load.</p>}
    {error && <div role="alert" className="mt-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-950">
      <p>{error}</p><button type="button" disabled={busy} onClick={refresh} className="mt-2 min-h-11 rounded-lg border border-amber-900 px-3 font-bold">Refresh choices</button>
    </div>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {view.options.map(option => <section key={option.id} className="flex flex-col rounded-xl border border-slate-300 bg-slate-50 p-4">
        <h3 className="font-bold">{option.label}</h3>
        <Summary appId={entry.appId} data={option.data} />
        <button type="button" disabled={busy} onClick={() => { void choose(option.id); }}
          className="mt-4 min-h-11 rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
          {busy ? "Saving..." : `Use ${option.label.toLowerCase()}`}
        </button>
      </section>)}
    </div>
    <button type="button" onClick={close} className="mt-4 min-h-11 rounded-lg px-4 font-semibold text-slate-700 underline">Decide later</button>
  </dialog>;
}

/** One owner-fenced notice above fixed game canvases, shared by every mounted app. */
export function ProgressRecoveryNotice() {
  const entries = useSyncExternalStore(progressSyncPresentation.subscribe, progressSyncPresentation.getSnapshot, progressSyncPresentation.getServerSnapshot);
  const owner = useSyncExternalStore(ownerBoundProgress.subscribe, ownerBoundProgress.getSnapshot, ownerBoundProgress.getSnapshot);
  const [selected, setSelected] = useState<{ id: string; generation: number; view: RecoveryDialog } | null>(null);
  const generation = useRef(0);
  const visible = owner.status === "ready" ? entries.filter(row => row.ownerKey === owner.ownerKey && row.generation === owner.generation) : [];
  const entry = visible.find(row => row.id === selected?.id);
  const warnings = visible.filter(row => ["conflict", "storage-error", "network-error"].includes(row.status));
  const open = (row: ProgressPresentation) => {
    selected?.view.close();
    const view = row.open();
    setSelected(view ? { id: row.id, generation: ++generation.current, view } : null);
  };
  const close = () => { selected?.view.close(); setSelected(null); };
  if (typeof document === "undefined") return null;
  return createPortal(<>
    {!!warnings.length && <aside aria-label="Save status" className="pointer-events-none fixed inset-x-0 bottom-0 z-[3900] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto max-h-[35dvh] w-full max-w-xl space-y-2 overflow-y-auto rounded-xl border border-amber-300 bg-amber-100 p-3 text-amber-950 shadow-lg">
        {warnings.map(row => <div key={row.id} className="flex items-center justify-between gap-3">
          <p role="status" className="text-sm leading-5"><strong>{getGameMetadata(row.appId).name}: </strong>
            {row.status === "conflict" ? "Choose which save to use." : row.localDurable ? "Saved on this device. Waiting to sync." : "Keep this page open. Your latest progress is not saved yet."}
          </p>
          <button type="button" onClick={() => { if (row.status === "conflict") open(row); else void row.retry(); }}
            className="min-h-11 shrink-0 rounded-lg bg-amber-950 px-3 py-2 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-950">
            {row.status === "conflict" ? "Review saves" : "Retry"}
          </button>
        </div>)}
      </div>
    </aside>}
    {entry && selected && <RecoveryModal key={`${selected.id}:${selected.generation}`} entry={entry} view={selected.view} close={close} refresh={() => open(entry)} />}
  </>, document.body);
}
