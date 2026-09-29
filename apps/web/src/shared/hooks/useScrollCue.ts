"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Rounding room in px. A box whose content is less than this much taller
 * than the box does not scroll in a way the kid can see.
 */
const EDGE_SLACK = 1;

/** Which edges of a scroll box have more content past them. */
export function scrollCueEdges(box: HTMLElement): { above: boolean; below: boolean } {
  const hidden = box.scrollHeight - box.clientHeight;
  if (hidden <= EDGE_SLACK) return { above: false, below: false };
  return {
    above: box.scrollTop > EDGE_SLACK,
    below: box.scrollTop < hidden - EDGE_SLACK,
  };
}

/**
 * Keeps the `.scroll-cue` shadows (globals.css) true to the box: it sets
 * `data-more-above` and `data-more-below` on the box only while there is
 * more content past that edge. It measures when it starts, on every
 * scroll, and when the box or its content changes size.
 *
 * The attributes go straight onto the element (no React state), so a
 * scroll does not render the component again, and the first measure
 * happens before the browser paints.
 *
 * @param boxRef the scroll box (it has the `scroll-cue` class)
 * @param contentRef the box's content wrapper, so content that grows is seen
 * @param active false while the box is not rendered yet
 */
export function useScrollCue(
  boxRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null> | null,
  active: boolean
): void {
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!active || !box) return;

    const update = () => {
      const { above, below } = scrollCueEdges(box);
      box.toggleAttribute("data-more-above", above);
      box.toggleAttribute("data-more-below", below);
    };
    update();

    box.addEventListener("scroll", update, { passive: true });
    const sizes = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    sizes?.observe(box);
    const content = contentRef?.current;
    if (content) sizes?.observe(content);

    return () => {
      box.removeEventListener("scroll", update);
      sizes?.disconnect();
    };
  }, [boxRef, contentRef, active]);
}
