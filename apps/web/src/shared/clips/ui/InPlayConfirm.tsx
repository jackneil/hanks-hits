"use client";

/**
 * The in-play confirmation (plan 11.1): during play the only feedback is a
 * compact check mark and a small pill in the header row. The full card
 * waits for a break.
 *
 * GameShell mounts it INSIDE the header's title region (the flex-1 element
 * between the home button and the control cluster, which is `relative`),
 * through the shell mount (see ClipUiRuntime.tsx). It then lies over the
 * title, never over a control, and takes no taps. It is part of the header
 * row (z-1000), so it needs no portal. Like the header, it is below the
 * Retro Arcade emulator view (1100) and the celebrations (1150).
 *
 * Fit: the pill is all or nothing, a check mark AND the words. A container
 * query shows it only when the title region has room for the words
 * (CONFIRM_TEXT_MIN_REM). Below that (a phone, where the title is one
 * emoji), nothing covers the title: the clip button's own check mark and
 * the new-clip chip under the header are the confirmation. A check-only
 * pill there would hide the title and show a second check mark beside the
 * button's.
 *
 * The clip button announces the result to screen readers, so this part is
 * visual only (aria-hidden).
 */

import { useEffect, useState } from "react";

import { useClipSnapshot } from "../service/context";
import { useClipUi } from "./uiContext";
import { RESULT_COPY } from "./copy";
import { CheckGlyph } from "./glyphs";

/** How long the confirmation stays (the same 1.2 s as the button's "made" state). */
export const CONFIRM_MS = 1200;
/** The region needs this width (rem) to show the pill. "Clip made! (longer)" needs about 11.3 rem. */
export const CONFIRM_TEXT_MIN_REM = 12;

export function InPlayConfirm() {
  const ui = useClipUi();
  const snapshot = useClipSnapshot();
  const result = snapshot.lastResult;
  const key = result && result.ok ? `${result.action}:${result.atMs}` : null;

  // A result from before this part appeared is old news.
  const [firstKey] = useState(key);
  const [expiredKey, setExpiredKey] = useState<string | null>(null);

  useEffect(() => {
    if (!key || key === firstKey) return;
    const timer = setTimeout(() => setExpiredKey(key), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [key, firstKey]);

  if (!ui || !result || !result.ok || !key || key === firstKey || key === expiredKey) return null;

  return (
    <div
      data-testid="in-play-confirm"
      aria-hidden="true"
      className="@container pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center overflow-hidden"
    >
      <span
        data-testid="in-play-confirm-pill"
        className="flex h-7 max-w-full items-center gap-1.5 rounded-full bg-white px-2 text-sm font-bold text-slate-900 @max-[12rem]:hidden motion-safe:transition-opacity motion-safe:duration-150 motion-safe:starting:opacity-0"
      >
        <CheckGlyph size={16} className="shrink-0" />
        <span data-testid="in-play-confirm-text" className="truncate whitespace-nowrap">
          {RESULT_COPY[result.action]}
        </span>
      </span>
    </div>
  );
}
