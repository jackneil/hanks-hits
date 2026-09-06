import { fireEvent, render, screen } from "@testing-library/react";
import { DRUM_MACHINE_INSTRUCTIONS } from "../lib/readAloud";
import { toSpeakable } from "@/shared/hooks/useReadAloud";
import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, syncStatus: "idle" }),
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

import { DrumMachine } from "../DrumMachine";
import { useDrumMachineStore } from "../lib/store";
import { mockPointer } from "@/__tests__/pointer-mock";

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

  it("releases the pad on touchcancel so an interrupted touch can't stick it active", () => {
    render(<DrumMachine />);
    const pad = screen.getByRole("button", { name: "Kick" });

    fireEvent.touchStart(pad, { touches: [{ clientX: 10, clientY: 10 }] });
    expect(useDrumMachineStore.getState().activePads.size).toBe(1);

    fireEvent.touchCancel(pad);
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

describe("drum machine read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
  });

  it("shows the read-aloud button when the browser can speak", async () => {
    installSpeechMock();
    render(<DrumMachine />);

    expect(await screen.findByTestId("read-aloud-button")).toBeInTheDocument();
  });

  it("speaks the drum machine instructions when tapped", async () => {
    const speech = installSpeechMock();
    render(<DrumMachine />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(speech.speak).toHaveBeenCalledTimes(1);
    // The hook strips emoji before speaking, so compare against the words the
    // voice really says, not the raw constant.
    const spoken = speech.lastUtterance().text;
    expect(spoken).toBe(toSpeakable(DRUM_MACHINE_INSTRUCTIONS));
    // And those words must describe the real flow: Record first, then pads.
    expect(spoken).toContain("Tap the pads to make sounds");
    expect(spoken).toContain("Tap Record. The beat plays while you tap the pads");
    expect(spoken).toContain("Tap the red button to stop");
    expect(spoken).toContain("Tap the green button to hear your beat again");
  });

  it("hides the button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<DrumMachine />);

    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});

describe("drum-machine keyboard focus", () => {
  it("lets a focused button keep its own Space key instead of starting playback", () => {
    // Regression: the window keydown handler mapped Space to play/stop for
    // every target, so Space on a focused button (the read-aloud speaker)
    // started the beat instead of pressing the button.
    render(<DrumMachine />);

    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    const notPrevented = fireEvent.keyDown(button, { code: "Space", key: " " });

    expect(notPrevented).toBe(true);
    expect(useDrumMachineStore.getState().isPlaying).toBe(false);
    button.remove();
  });
});
