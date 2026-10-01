"use client";

import type { ReactNode } from "react";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

/**
 * One Oregon Trail screen inside the GameShell play box: a title row, the
 * content (it scrolls when it is taller than the box), and the actions,
 * always on screen at the bottom.
 *
 * Why: each screen was a page taller than the phone. Continue Trail sat at
 * y=652 on a 549 px screen on most days, Leave Store 260 px under the fold,
 * Next under the fold held sideways, and after the store the page stayed
 * scrolled with the wagon off screen (phone UX audit 2026-09-29). Here the
 * action a kid needs next is never under the fold, and a new screen starts
 * at its top.
 *
 * `speak` is what the "Read it to me" button says: every screen a kid must
 * read to decide gets one.
 */

const TONES = {
  amber: "bg-amber-900 text-amber-50",
  green: "bg-green-900 text-green-50",
  blue: "bg-sky-900 text-sky-50",
  red: "bg-red-950 text-red-50",
} as const;

export type ScreenTone = keyof typeof TONES;

export function Screen({
  title,
  speak,
  tone = "amber",
  actions,
  children,
  testId,
}: {
  title?: ReactNode;
  speak?: string | (() => string);
  tone?: ScreenTone;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={`flex h-full flex-col ${TONES[tone]}`}>
      {(title || speak) && (
        <div className="flex shrink-0 items-center gap-2 px-3 pt-2 short:pt-1">
          {title && <h2 className="min-w-0 flex-1 text-xl font-bold leading-tight short:text-lg">{title}</h2>}
          {speak && <ReadAloudButton text={speak} variant="icon" />}
        </div>
      )}
      {/* Keyed by the screen: a new screen starts at its top, even when React
          keeps the element (the setup steps are one component). */}
      <div key={testId} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 short:py-1.5">
        {children}
      </div>
      {actions && (
        <div
          data-testid="oregon-actions"
          className="shrink-0 border-t border-black/20 bg-black/25 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * The main action and the line that says why it waits ("Type your name to
 * go on"): stacked upright, side by side on a phone held sideways. The line
 * on its own row cost 29 px of the 130 px a sideways iPhone SE had left for
 * the screen, and hid the job buttons under the bar (seen on the real
 * phone, 2026-09-30).
 */
export function MainAction({ hint, hintTestId, children }: { hint?: ReactNode; hintTestId?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 short:flex-row short:items-center short:gap-3">
      {hint && (
        <p data-testid={hintTestId} className="text-center text-base font-bold text-amber-200 short:flex-1 short:text-left">
          {hint}
        </p>
      )}
      <div className={hint ? "short:w-56 short:shrink-0" : "w-full"}>{children}</div>
    </div>
  );
}

/** The big button of a screen (Next, Continue Trail, Leave the store). */
export const MAIN_ACTION =
  "btn btn-primary h-12 min-h-12 w-full text-lg short:h-11 short:min-h-11 disabled:border-2 disabled:border-white/25 disabled:bg-black/30 disabled:text-white/70";

/**
 * A choice a kid picks from a list (a job, a month, a river crossing):
 * light text on the screen colour with a full outline, or dark on amber
 * when picked. The unpicked jobs were dark blue on brown (btn-ghost),
 * which a kid could not read.
 */
export function choiceClass(picked: boolean): string {
  return `btn h-auto min-h-12 w-full justify-start gap-3 whitespace-normal border-2 px-3 py-2 text-left normal-case ${
    picked ? "border-amber-300 bg-amber-300 text-amber-950" : "border-amber-200/70 bg-transparent text-amber-50"
  }`;
}
