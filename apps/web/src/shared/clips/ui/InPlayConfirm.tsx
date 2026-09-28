"use client";

/**
 * The in-play confirmation (plan 11.1): during play the only feedback is a
 * compact check mark and a small pill in the header row. The full card
 * waits for a break.
 *
 * Mount it INSIDE the header's title region (the flex-1 element between the
 * home button and the control cluster), which must be `relative`:
 *
 *   <div className="relative flex-1 min-w-0 ...">{title}<InPlayConfirm /></div>
 *
 * It then lies over the title, never over a control, and takes no taps. It
 * is part of the header row (z-1000), so it needs no portal.
 *
 * Fit: the region is narrow on a phone (the title is one emoji below
 * 480 px). A container query shows the words only when the region has room
 * for them (CONFIRM_TEXT_MIN_REM); otherwise only the check mark shows, and
 * in a region too narrow for the check, nothing shows (the clip button's own
 * check mark still does).
 *
 * The clip button announces the result to screen readers, so this part is
 * visual only (aria-hidden).
 */

import { useEffect, useState } from "react";

import { useClipSnapshot } from "../service/context";
import { useClipUi } from "./ClipUiProvider";
import { RESULT_COPY } from "./copy";
import { CheckGlyph } from "./glyphs";

/** How long the confirmation stays (the same 1.2 s as the button's "made" state). */
export const CONFIRM_MS = 1200;
/** The region needs this width (rem) to show the words. "Clip made! (longer)" needs about 11.3 rem. */
export const CONFIRM_TEXT_MIN_REM = 12;
/** Below this width (rem) not even the check mark shows. */
export const CONFIRM_CHECK_MIN_REM = 2;

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
      <span className="flex h-7 max-w-full items-center gap-1.5 rounded-full bg-white px-2 text-sm font-bold text-slate-900 @max-[2rem]:hidden motion-safe:transition-opacity motion-safe:duration-150 motion-safe:starting:opacity-0">
        <CheckGlyph size={16} className="shrink-0" />
        <span data-testid="in-play-confirm-text" className="hidden truncate whitespace-nowrap @min-[12rem]:inline">
          {RESULT_COPY[result.action]}
        </span>
      </span>
    </div>
  );
}
