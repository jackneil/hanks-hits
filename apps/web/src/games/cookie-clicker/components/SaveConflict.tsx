"use client";

import { useEffect, useRef, useState } from "react";
import type { BakerySyncView } from "../lib/useCookieSync";
import type { BakerySnapshot } from "../lib/sync-session";
import type { CookieClickerProgress } from "../lib/store";
import { formatNumber } from "../lib/constants";

export function SaveConflict({ view, local, choose, retry }: {
  view: BakerySyncView;
  local: CookieClickerProgress;
  choose: (snapshot: BakerySnapshot, selected: "local" | "server" | number) => Promise<void>;
  retry: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && view.conflict) element.showModal?.();
    else element.close?.();
  }, [open, view.conflict]);
  const summary = (data: CookieClickerProgress) =>
    `${formatNumber(data.cookies)} cookies · ${Object.values(data.buildings).reduce((total, n) => total + n, 0)} helpers · ${data.purchasedUpgrades.length} upgrades`;
  const option = (label: string, data: CookieClickerProgress, selected: "local" | "server" | number) => (
    <div key={label} className="rounded-xl border border-amber-300 bg-white p-3">
      <h3 className="font-bold">{label}</h3>
      <p className="my-2 text-sm">{summary(data)}</p>
      <button className="btn btn-primary min-h-11 w-full" disabled={view.busy}
        onClick={() => { if (view.conflict) void choose(view.conflict, selected); }}>
        Use {label.toLowerCase()}
      </button>
    </div>
  );

  if (!view.conflict && !view.error && view.storageAvailable) return null;
  return (
    <section aria-label="Bakery save" className="shrink-0 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      {!view.storageAvailable && <p role="status">This browser could not keep a recovery copy. Keep this page open while we save your bakery.</p>}
      {view.conflict ? (
        <button className="min-h-11 w-full font-bold underline" onClick={() => setOpen(true)}>
          Your bakeries have different saves. Choose a bakery
        </button>
      ) : view.error ? (
        <div className="flex items-center justify-between gap-2"><p role="status">Your bakery is on this device. Cloud saving needs another try.</p>
          <button className="btn min-h-11" disabled={view.busy} onClick={() => { void retry(); }}>Try saving</button></div>
      ) : null}
      <dialog ref={dialog} onClose={() => setOpen(false)} onCancel={() => setOpen(false)}
        aria-labelledby="bakery-choice-title"
        className="m-auto max-h-[85dvh] w-[min(30rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl bg-amber-50 p-4 text-amber-950 shadow-xl backdrop:bg-black/50">
        <h2 id="bakery-choice-title" className="text-xl font-bold">Which bakery should we keep?</h2>
        <p className="my-3 text-sm">Choose a cookie balance. Helpers, upgrades and records from all copies are kept. Your original copy stays available until saving finishes.</p>
        <div className="grid gap-3 min-[600px]:grid-cols-2">
          {option("This bakery", local, "local")}
          {view.conflict?.data ? option("Saved bakery", view.conflict.data, "server") : <p>The account has no saved bakery now.</p>}
          {view.choices.map((choice, index) => option(choice.label, choice.data, index))}
        </div>
        {view.busy && <p role="status" className="mt-3">Saving your choice...</p>}
        <button className="btn mt-3 min-h-11 w-full" onClick={() => setOpen(false)}>Keep playing here for now</button>
      </dialog>
    </section>
  );
}
