import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/clips/replay/useSemanticClips", () => ({ useSemanticClips: vi.fn() }));
import { useSemanticClips } from "@/shared/clips/replay/useSemanticClips";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: vi.fn(() => ({ ready: true })),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => null,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { CookieClickerGame } from "../Game";
import { useCookieClickerStore } from "../lib/store";
import { fingerDown, fingerUp, liftAllFingers } from "@/__tests__/finger-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

// Regression (2026 phone audit, cookie-clicker): the cookie counted onClick
// only. A browser sends no click for either finger of a two-finger gesture,
// so a kid mashing with both thumbs saw the counter freeze (12 finger-downs,
// +0 cookies). The tap now counts on pointerdown, once per finger. The play
// screen also talked mouse ("Click power", "Total clicks") to a finger.

function start() {
  fireEvent.click(screen.getByRole("button", { name: "▶ Play!" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(useSemanticClips).mockClear();
  vi.useFakeTimers();
  act(() => {
    useCookieClickerStore.setState({ totalClicks: 0, cookies: 0 });
  });
});

afterEach(() => {
  liftAllFingers();
  vi.useRealTimers();
  resetPointerMock();
});

describe("Cookie Clicker taps", () => {
  it("records the same actual 100 ms pressed state shown by a real finger tap", () => {
    mockPointer(true);
    render(<CookieClickerGame />);
    start();
    const cookie = screen.getByRole("button", { name: "cookie" });
    const capturePressed = () => (vi.mocked(useSemanticClips).mock.calls.at(-1)?.[0] as { pressed: boolean }).pressed;
    expect(capturePressed()).toBe(false);
    fingerDown(cookie, { id: 1, x: 20, y: 20 });
    expect(useCookieClickerStore.getState().totalClicks).toBe(1);
    expect(cookie).toHaveClass("scale-95");
    expect(capturePressed()).toBe(true);
    act(() => { vi.advanceTimersByTime(99); });
    expect(capturePressed()).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(cookie).toHaveClass("scale-100");
    expect(capturePressed()).toBe(false);
    fingerUp(cookie, { id: 1 });
    expect(useCookieClickerStore.getState().totalClicks).toBe(1);
  });
  it("counts a two-thumb mash: every finger down is a tap, with no click at all", () => {
    mockPointer(true);
    render(<CookieClickerGame />);
    start();
    // Exact: "Golden cookie" is another button.
    const cookie = screen.getByRole("button", { name: "cookie" });

    // Alternating, overlapping thumbs: left down, right down, left up, right up.
    for (let round = 0; round < 3; round += 1) {
      fingerDown(cookie, { id: 1, x: 10, y: 10 });
      fingerDown(cookie, { id: 2, x: 30, y: 30 });
      fingerUp(cookie, { id: 1 });
      fingerUp(cookie, { id: 2 });
    }
    expect(useCookieClickerStore.getState().totalClicks).toBe(6);
  });

  it("says tap to a finger and click to a mouse", () => {
    mockPointer(true);
    const { unmount } = render(<CookieClickerGame />);
    start();
    expect(screen.getByText(/Tap power: /)).toBeInTheDocument();
    expect(screen.getByText(/Taps: /)).toBeInTheDocument();
    expect(screen.queryByText(/Click power/)).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<CookieClickerGame />);
    start();
    expect(screen.getByText(/Click power: /)).toBeInTheDocument();
    expect(screen.getByText(/Clicks: /)).toBeInTheDocument();
  });
});
