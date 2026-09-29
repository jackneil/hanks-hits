import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIRM_MS, CONFIRM_TEXT_MIN_REM, InPlayConfirm } from "../InPlayConfirm";
import { RESULT_COPY } from "../copy";
import { createFakeClipService } from "./fakeClipService";
import { renderWithClips } from "./renderClips";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The header title region the integration mounts it in. */
function TitleRegion() {
  return (
    <div data-testid="title-region" className="relative flex-1 min-w-0">
      <span>Snake</span>
      <InPlayConfirm />
    </div>
  );
}

describe("InPlayConfirm (plan 11.1)", () => {
  it("shows a check mark and a small pill for 1.2 s after a clip, then goes", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
    await act(async () => {
      await fake.service.clipLast();
    });
    const confirm = screen.getByTestId("in-play-confirm");
    expect(confirm.querySelector('[data-glyph="check"]')).not.toBeNull();
    expect(screen.getByTestId("in-play-confirm-text")).toHaveTextContent(RESULT_COPY.clip);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_MS - 1);
    });
    expect(screen.getByTestId("in-play-confirm")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
  });

  it("uses the plan's words for each kind of result", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    await act(async () => {
      await fake.service.takePicture();
    });
    expect(screen.getByTestId("in-play-confirm-text")).toHaveTextContent(RESULT_COPY.picture);
    await act(async () => {
      await fake.service.startRecording();
      await fake.service.stopRecording();
    });
    expect(screen.getByTestId("in-play-confirm-text")).toHaveTextContent(RESULT_COPY.record);
  });

  it("stays in the title region, over no control, and takes no taps", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    await act(async () => {
      await fake.service.clipLast();
    });
    const confirm = screen.getByTestId("in-play-confirm");
    expect(confirm.parentElement).toBe(screen.getByTestId("title-region"));
    expect(confirm.className).toContain("absolute");
    expect(confirm.className).toContain("inset-0");
    expect(confirm.className).toContain("overflow-hidden");
    expect(confirm.className).toContain("pointer-events-none");
    expect(confirm.className).toContain("z-[1000]");
    expect(confirm.getAttribute("aria-hidden")).toBe("true");
  });

  /**
   * What the kid sees in a title region `widthRem` wide: jsdom has no
   * container queries, so this reads the Tailwind @min-/@max- width variants
   * (the only ones the part uses) the way the browser applies them.
   */
  function drawnAt(widthRem: number): { pill: boolean; check: boolean; words: boolean } {
    const shown = (element: Element | null): boolean => {
      for (let el = element; el && el !== document.body; el = el.parentElement) {
        const classes = (el.getAttribute("class") ?? "").split(/\s+/);
        let hidden = classes.includes("hidden");
        for (const token of classes) {
          const variant = /^@(min|max)-\[(\d+(?:\.\d+)?)rem\]:(hidden|inline|flex|block)$/.exec(token);
          if (!variant) continue;
          const [, side, size, display] = variant;
          const applies = side === "min" ? widthRem >= Number(size) : widthRem < Number(size);
          if (applies) hidden = display === "hidden";
        }
        if (hidden) return false;
        if (classes.includes("@container")) break;
      }
      return true;
    };
    const pill = screen.getByTestId("in-play-confirm-pill");
    return {
      pill: shown(pill),
      check: shown(pill.querySelector('[data-glyph="check"]')),
      words: shown(screen.getByTestId("in-play-confirm-text")),
    };
  }

  it("draws the check and the words together, or nothing: never a check alone over a phone's emoji title", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    await act(async () => {
      await fake.service.clipLast();
    });
    const confirm = screen.getByTestId("in-play-confirm");
    expect(confirm.className).toContain("@container");
    expect(screen.getByTestId("in-play-confirm-pill").className).toContain("max-w-full");
    // A phone below 480 px: the title is one emoji, about 2.6 rem of room.
    // The emoji stays visible; the button's check and the chip confirm.
    expect(drawnAt(2.6)).toEqual({ pill: false, check: false, words: false });
    expect(drawnAt(CONFIRM_TEXT_MIN_REM - 0.1)).toEqual({ pill: false, check: false, words: false });
    // A wide header: a check mark and the words.
    expect(drawnAt(CONFIRM_TEXT_MIN_REM)).toEqual({ pill: true, check: true, words: true });
    expect(drawnAt(30)).toEqual({ pill: true, check: true, words: true });
    // At no width does a check show without its words.
    for (let rem = 0; rem <= 40; rem += 0.5) {
      const drawn = drawnAt(rem);
      expect(drawn.check, `${rem} rem`).toBe(drawn.words);
    }
  });

  it("does not show a result made before it appeared, or a failure", async () => {
    const fake = createFakeClipService();
    await fake.service.clipLast();
    renderWithClips(<TitleRegion />, { fake });
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
    fake.failNext("mux-failed");
    await act(async () => {
      await fake.service.clipLast();
    });
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
  });
});
