import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { HintToast, HINT_SECONDS } from "../components/hud/HintToast";
import { useFourWheeler3dStore } from "../lib/store";

/** Move the clock on inside React, so the toast's timer fires. */
function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

function say(hint: string | null) {
  act(() => {
    useFourWheeler3dStore.getState().setHint(hint);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useFourWheeler3dStore.getState().setHint(null);
});

afterEach(() => {
  vi.useRealTimers();
  useFourWheeler3dStore.getState().setHint(null);
});

describe("the hint toast", () => {
  it("says nothing when there is no hint", () => {
    render(<HintToast />);
    expect(screen.queryByText(/./)).toBeNull();
  });

  it("shows the hint the game sets", () => {
    render(<HintToast />);
    say("🔄 Flipped back over!");
    expect(screen.getByText("🔄 Flipped back over!")).toBeTruthy();
  });

  it("takes the hint away by itself", () => {
    render(<HintToast />);
    say("🌤️ A new day! It is sunny.");
    advance(HINT_SECONDS - 0.5);
    // Still readable a moment before the time is up.
    expect(screen.getByText("🌤️ A new day! It is sunny.")).toBeTruthy();
    advance(1);
    expect(screen.queryByText("🌤️ A new day! It is sunny.")).toBeNull();
    expect(useFourWheeler3dStore.getState().hint).toBeNull();
  });

  it("starts the clock again for a second hint", () => {
    render(<HintToast />);
    say("First one");
    advance(HINT_SECONDS - 0.5);
    say("Second one");
    // The first one's time is nearly up, but the second one just arrived.
    advance(HINT_SECONDS - 0.5);
    expect(screen.getByText("Second one")).toBeTruthy();
    advance(1);
    expect(screen.queryByText("Second one")).toBeNull();
  });

  it("asks a screen reader to read it out, politely", () => {
    render(<HintToast />);
    say("Hello there");
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Hello there");
  });

  it("sits above the touch controls on a phone", () => {
    const { container, rerender } = render(<HintToast raised />);
    const raised = container.firstElementChild as HTMLElement;
    const raisedBottom = Number.parseInt(raised.style.bottom, 10);
    rerender(<HintToast />);
    const flat = container.firstElementChild as HTMLElement;
    const flatBottom = Number.parseInt(flat.style.bottom, 10);
    // Clear of the JUMP and HORN row, which starts 96 px up.
    expect(raisedBottom).toBeGreaterThan(150);
    expect(raisedBottom).toBeGreaterThan(flatBottom);
  });
});
