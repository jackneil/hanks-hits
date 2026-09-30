import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/components/ReadAloudButton", () => ({
  ReadAloudButton: () => null,
}));

import { StartScreen } from "../components/StartScreen";
import { RidePanel } from "../components/ui/RidePanel";
import { useFourWheeler3dStore } from "../lib/store";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";

/** No active ride: the panel shows its "walk up to a ride" line. */
function parkEveryRide() {
  useFourWheeler3dStore.getState().updateProgress((p) => ({
    ...p,
    adventure: { ...p.adventure, activeVehicleId: null },
  }));
}

// Regression (2026 phone audit, four-wheeler-3d): the start screen showed
// only "W A S D Drive / E Use / M Map / P Phone" key chips on a phone (the
// touch note was hidden by CSS under 580 px tall), and the panels said
// "press E" to a finger.

afterEach(() => {
  resetPointerMock();
});

describe("four-wheeler-3d touch copy", () => {
  it("the start screen shows the on-screen controls note to a finger and the key chips to a keyboard", () => {
    mockPointer(true);
    const { unmount } = render(<StartScreen />);
    expect(screen.getByText(/Hold GAS to drive/)).toBeInTheDocument();
    expect(screen.queryByText("W A S D")).not.toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<StartScreen />);
    expect(screen.getByText("W A S D")).toBeInTheDocument();
    expect(screen.queryByText(/Hold GAS to drive/)).not.toBeInTheDocument();
  });

  it("the ride panel says tap Use to a finger and press E to a keyboard", () => {
    parkEveryRide();
    mockPointer(true);
    const { unmount } = render(<RidePanel />);
    expect(screen.getByText("Walk up to a ride and tap Use to get started.")).toBeInTheDocument();
    unmount();

    mockPointer(false);
    render(<RidePanel />);
    expect(screen.getByText("Walk up to a ride and press E to get started.")).toBeInTheDocument();
  });
});
