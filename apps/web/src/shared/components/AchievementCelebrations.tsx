"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useAuthSync } from "@/shared/hooks/useAuthSync";
import {
  getAchievementInfo,
  useAchievementsStore,
  type AchievementInfo,
  type AchievementsProgress,
} from "@/shared/lib/achievements";
import { useNudgePlacement } from "@/shared/lib/gameBreaks";

/** How long the strip stays on a page with no play. */
const SHOW_MS = 4000;
/**
 * A card in a break surface counts as seen after this long on screen. A
 * card that leaves sooner (the kid tapped Play at once, or the start card
 * had no room and removed the slot before paint) waits for the next break.
 */
export const SEEN_MS = 1500;

// Deterministic confetti burst — CSS keyframes only, no dependencies.
const CONFETTI = [
  { left: "12%", delay: "0s", emoji: "🎉" },
  { left: "28%", delay: "0.15s", emoji: "⭐" },
  { left: "44%", delay: "0.05s", emoji: "🎊" },
  { left: "58%", delay: "0.2s", emoji: "✨" },
  { left: "72%", delay: "0.1s", emoji: "⭐" },
  { left: "86%", delay: "0.25s", emoji: "🎉" },
] as const;

/**
 * Global celebration layer for the Trophy Case: mounts once in the root
 * layout, syncs the achievements blob to the cloud for signed-in kids, and
 * shows each unlock in the session queue.
 *
 * Where it shows (gameBreaks.ts, useNudgePlacement):
 * - At a break (the start card, the pause menu, the result chip): as a
 *   card INSIDE that surface, part of it. The surface reads the card's
 *   words out loud with its own. The card stays for the whole break; the
 *   kid taps Yay! to close it, or the break ends. A card that was in view
 *   for SEEN_MS or longer counts as seen when the break ends; a card the
 *   kid never scrolled to comes back at the next break. On a short
 *   screen the card is one row, so the start card's slot can hold it
 *   under the install tip.
 * - During play: nothing. The unlock waits in the queue for the next
 *   break. The queue is persisted (achievements/store.ts), so a kid who
 *   closes the tab mid-run gets the card on the next visit. Before this, a
 *   fixed toast under the header covered the top of the play area for 4 s
 *   the moment a first run started: on a real iPhone SE the bird of Flappy
 *   Bird died behind it before the first tap (phone UX audit, S9).
 * - On a page with no play (the home page, an app with no start card): a
 *   thin strip at the bottom of the screen, gone after SHOW_MS. The strip
 *   is pointer-events-none so it can never eat a tap (the cookie-clicker
 *   toast lesson); its single interactive element is the 44 px Yay!
 *   button.
 *
 * Stacking contract of the site (z-index, low to high; design/ARCHITECTURE.md
 * has the same list, and src/__tests__/stacking-contract.test.ts keeps the
 * code and that list in step):
 * - 100 and below: game layers (60 at most), the start card (90) and the
 *   rotate-your-phone card (100).
 * - 1000: the GameShell header, and the clip confirmation in its title
 *   region.
 * - 1050: toasts (the clip toast slot, and a game's own short notes, for
 *   example "Saved!").
 * - 1100: the Retro Arcade's full-screen emulator view. It covers the
 *   header and the toasts.
 * - 1150: celebrations (the strip of this layer). A trophy earned while a
 *   retro game runs shows over the emulator view. Before this, the layer
 *   shared 1100 with the emulator view, so page order decided which one
 *   was on top.
 * - 1200: the result chip.
 * - 1500: modals (leaderboards, tutorials).
 * - 2000: the pause menu.
 * - 2500: sheets the kid opens (the clip sheets, and the install steps
 *   from the 📲 button).
 * - 3000: dialogs (the restart question).
 * The strip stays under the result chip, modals, sheets and dialogs, so it
 * never covers a question the kid must answer. The card inside a break
 * surface has no level of its own: it is part of the surface.
 */
// More queued unlocks than this collapses into one summary card — a
// retroactive burst (existing progress evaluated for the first time) would
// otherwise show one card after another for minutes.
const SUMMARY_THRESHOLD = 3;

/** The words of one celebration, on screen and for the voice. */
function celebrationWords(current: AchievementInfo, summary: boolean, queueLength: number) {
  if (summary) {
    return {
      emoji: "🏆",
      title: `You earned ${queueLength} trophies!`,
      description: "See them all in your Trophy Case!",
    };
  }
  return { emoji: current.emoji, title: `🏆 ${current.name}`, description: current.description };
}

const DISMISS_BUTTON =
  "shrink-0 min-w-[44px] min-h-[44px] rounded-xl bg-white/40 hover:bg-white/60 active:scale-95 font-bold text-yellow-950 px-3 transition-all";

function Confetti() {
  return (
    <>
      {CONFETTI.map((piece, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: piece.left, animationDelay: piece.delay }}
          aria-hidden="true"
        >
          {piece.emoji}
        </span>
      ))}
    </>
  );
}

export function AchievementCelebrations() {
  const dequeueCelebration = useAchievementsStore((s) => s.dequeueCelebration);
  const clearCelebrations = useAchievementsStore((s) => s.clearCelebrations);
  // The queue head IS the current celebration — no mirrored local state.
  const currentId = useAchievementsStore((s) => s.celebrationQueue[0] ?? null);
  const queueLength = useAchievementsStore((s) => s.celebrationQueue.length);
  const summary = queueLength > SUMMARY_THRESHOLD;
  const placement = useNudgePlacement("celebration");

  // Cloud sync for the achievements blob itself (guests stay local-only).
  useAuthSync<AchievementsProgress>({
    appId: "achievements",
    localStorageKey: "achievements-progress",
    getState: () => useAchievementsStore.getState().getProgress(),
    setState: (data) => useAchievementsStore.getState().setProgress(data),
  });

  // The strip: each unlock gets its show window, then the queue shifts.
  // The timer passes the id it was armed for, so a tap racing the timeout
  // can't double-shift and swallow the next card. A summary clears the
  // whole batch when its window ends. The timer runs only while the strip
  // is on screen: a celebration that waits for a break keeps its turn.
  const inStrip = currentId !== null && placement.kind === "page";
  useEffect(() => {
    if (!inStrip || currentId === null) return;
    const timer = setTimeout(() => {
      if (summary) clearCelebrations();
      else dequeueCelebration(currentId);
    }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [inStrip, currentId, summary, dequeueCelebration, clearCelebrations]);

  // The card in a break surface: no timer while the break lasts. When the
  // card leaves the slot (the break ends, or the next break takes it), a
  // card that was IN VIEW (half of it or more, by IntersectionObserver)
  // for SEEN_MS in total counts as seen and leaves the queue. A card under
  // the fold of a long menu (the pause menu on a phone held sideways) was
  // never seen: it comes back at the next break. Where the browser has no
  // IntersectionObserver (tests), on screen counts as in view. A tap on
  // Yay! shifts the queue first, so the cleanup's dequeue for the old id
  // is a no-op.
  const slotEl = currentId !== null && placement.kind === "slot" ? placement.slot : null;
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!slotEl || currentId === null) return;
    const card = cardRef.current;
    let seenMs = 0;
    let inViewSince: number | null = null;
    let observer: IntersectionObserver | null = null;
    if (card && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          const inView = entries.some((entry) => entry.isIntersecting);
          if (inView && inViewSince === null) inViewSince = Date.now();
          if (!inView && inViewSince !== null) {
            seenMs += Date.now() - inViewSince;
            inViewSince = null;
          }
        },
        { threshold: 0.5 }
      );
      observer.observe(card);
    } else {
      inViewSince = Date.now();
    }
    return () => {
      observer?.disconnect();
      if (inViewSince !== null) seenMs += Date.now() - inViewSince;
      if (seenMs < SEEN_MS) return;
      if (summary) clearCelebrations();
      else dequeueCelebration(currentId);
    };
  }, [slotEl, currentId, summary, dequeueCelebration, clearCelebrations]);

  if (currentId === null || placement.kind === "wait") return null;
  const current: AchievementInfo = getAchievementInfo(currentId);
  const words = celebrationWords(current, summary, queueLength);
  const dismiss = () => (summary ? clearCelebrations() : dequeueCelebration(currentId));

  if (placement.kind === "slot") {
    // What the surface's voice says for this card, after its own words.
    const spoken = `${summary ? "" : "New trophy! "}${words.title.replace("🏆 ", "")} ${words.description} Tap Yay! to close it.`;
    return createPortal(
      <div
        className="relative text-left"
        role="status"
        aria-live="polite"
        data-testid="achievement-celebration"
        data-placement="break"
        data-read-aloud={spoken}
      >
        <Confetti />
        {/* One solid trophy-gold surface (the old yellow to orange gradient
            was an AI-design tell). ring-white/70 keeps the card's edge
            visible on a same-hue surface; yellow-950 on amber-300 is
            about 11:1. */}
        <div
          ref={cardRef}
          data-testid="achievement-card"
          className="achievement-pop rounded-2xl bg-amber-300 ring-2 ring-white/70 shadow-lg px-4 py-3 flex items-center gap-3 short:px-3 short:py-1 short:gap-2"
        >
          <span className="text-4xl short:text-2xl" aria-hidden="true">
            {words.emoji}
          </span>
          {/* On a short screen (a phone held sideways) the card is one
              truncated row, like the strip: the start card's slot stacks
              this card under the install tip, and a two-line card ran to
              the bottom edge of a 311 px screen. */}
          <div className="min-w-0 flex-1 text-yellow-950 short:truncate">
            <span className="block font-bold text-lg short:inline short:text-base">{words.title}</span>
            <span className="block text-sm short:ml-1 short:inline">{words.description}</span>
          </div>
          <button type="button" onClick={dismiss} className={DISMISS_BUTTON} aria-label="Dismiss celebration">
            Yay!
          </button>
        </div>
      </div>,
      placement.slot
    );
  }

  // The strip, at the bottom of a page with no play. The layer and the
  // card are pointer-events-none; only Yay! takes a tap.
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[1150] flex justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pointer-events-none"
      role="status"
      aria-live="polite"
      data-testid="achievement-celebration"
      data-placement="strip"
    >
      <div className="relative w-full max-w-sm">
        <Confetti />
        <div
          data-testid="achievement-card"
          className="achievement-pop rounded-2xl bg-amber-300 ring-2 ring-white/70 shadow-lg pl-3 pr-1.5 py-1 flex min-h-11 items-center gap-2"
        >
          <span className="text-2xl" aria-hidden="true">
            {words.emoji}
          </span>
          <div className="min-w-0 flex-1 truncate text-yellow-950">
            <span className="font-bold text-yellow-950">{words.title}</span>{" "}
            <span className="text-sm">{words.description}</span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className={`pointer-events-auto ${DISMISS_BUTTON}`}
            aria-label="Dismiss celebration"
          >
            Yay!
          </button>
        </div>
      </div>
    </div>
  );
}
