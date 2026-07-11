import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, syncStatus: "idle" }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { DrumMachine } from "../DrumMachine";
import { useDrumMachineStore } from "../lib/store";

function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  mockPointer(false);
  useDrumMachineStore.setState({ mode: "pads", isPlaying: false, isRecording: false });
});

describe("drum-machine pads on touch", () => {
  it("prevents touchstart's default so the compat mousedown can't double-trigger the pad", () => {
    // Regression: preventDefault lived inside React's synthetic onTouchStart,
    // which React attaches passive — it silently failed, logging a console
    // error per tap and letting the compatibility mouse events re-trigger
    // the pad. The listener is native and non-passive now.
    render(<DrumMachine />);

    const pad = screen.getByRole("button", { name: "Kick" });
    const notPrevented = fireEvent.touchStart(pad, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    expect(notPrevented).toBe(false);

    const endNotPrevented = fireEvent.touchEnd(pad);
    expect(endNotPrevented).toBe(false);
  });

  it("triggers the pad state on touchstart and releases on touchend", () => {
    render(<DrumMachine />);
    const pad = screen.getByRole("button", { name: "Kick" });

    fireEvent.touchStart(pad, { touches: [{ clientX: 10, clientY: 10 }] });
    expect(useDrumMachineStore.getState().activePads.size).toBe(1);

    fireEvent.touchEnd(pad);
    expect(useDrumMachineStore.getState().activePads.size).toBe(0);
  });
});

describe("drum-machine mobile layout", () => {
  it("shows touch copy on coarse pointers instead of keyboard shortcuts", () => {
    mockPointer(true);
    render(<DrumMachine />);

    expect(
      screen.getByText("Tap the pads to play the drums!")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Space = Play\/Stop/)).not.toBeInTheDocument();
  });

  it("keeps keyboard copy on fine pointers", () => {
    mockPointer(false);
    render(<DrumMachine />);

    expect(screen.getByText(/Space = Play\/Stop/)).toBeInTheDocument();
  });

  it("docks the transport controls so Play never falls below the phone fold", () => {
    // Regression: in sequencer view the Play button rendered at y=845 on an
    // 844px viewport — reachable only by discovering scroll.
    render(<DrumMachine />);
    const play = screen.getByRole("button", { name: "▶" });
    expect(play.parentElement?.className).toContain("sticky");
    expect(play.parentElement?.className).toContain("bottom-0");
  });
});
