"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

/** Device-level failures must remain visible above fixed game and header layers. */
export function ProgressStorageNotice({ memoryOnly, guestHandoffUnavailable }: {
  memoryOnly: boolean;
  guestHandoffUnavailable: boolean;
}) {
  const [acknowledged, setAcknowledged] = useState(0);
  const active = (memoryOnly ? 1 : 0) | (guestHandoffUnavailable ? 2 : 0);
  const pending = active & ~acknowledged;
  if (!pending || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[4000] flex justify-center pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <section role="status" aria-label="Progress storage notice" className="pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-amber-300 bg-amber-100 p-3 text-amber-950 shadow-xl">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-2 text-sm leading-5">
            {!!(pending & 2) && <p>Guest progress could not be carried into this account. Your guest save is still on this device.</p>}
            {!!(pending & 1) && <p>Some device saves are unavailable. Keep this page open until your save status is confirmed.</p>}
          </div>
          <button type="button" className="min-h-11 min-w-11 shrink-0 rounded-lg bg-amber-950 px-4 py-2 font-bold text-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-950" onClick={() => setAcknowledged(previous => previous | active)}>Got it</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
