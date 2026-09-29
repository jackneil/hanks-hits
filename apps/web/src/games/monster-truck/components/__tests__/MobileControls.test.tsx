import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTouchControls } from "../../hooks/useControls";
import { MobileControls } from "../MobileControls";

function Harness({
  useTilt,
  onToggleTilt = vi.fn(),
  onCalibrate = vi.fn(),
}: {
  useTilt: boolean;
  onToggleTilt?: () => void;
  onCalibrate?: () => void;
}) {
  const touchControls = useTouchControls();
  return (
    <MobileControls
      touchControls={touchControls}
      onHorn={vi.fn()}
      onNos={vi.fn()}
      nosCharge={50}
      nosMaxCharge={100}
      useTilt={useTilt}
      onToggleTilt={onToggleTilt}
      onCalibrate={onCalibrate}
    />
  );
}

describe("Monster Truck MobileControls", () => {
  it("anchors the control layer below the GameShell header, like hill-climb", () => {
    render(<Harness useTilt={false} />);
    const layer = screen.getByTestId("monster-truck-mobile-controls");

    // The old layer was fixed inset-0 with TILT at top-4: inside the
    // 48 px header box, under the header.
    expect(layer).toHaveClass("fixed", "inset-x-0", "bottom-0", "top-12", "md:top-14");
    expect(layer).not.toHaveClass("inset-0");
  });

  it("keeps TILT out of the header box and the strip right under it", () => {
    render(<Harness useTilt={false} />);
    const tilt = screen.getByTestId("tilt-toggle");

    // Upright phone: just above the pedals. Sideways phone: 64 px below
    // the top of the layer, clear of the strip under the header.
    expect(tilt).toHaveClass("bottom-[8.5rem]", "short:top-16", "short:bottom-auto");
    expect(tilt.className).not.toMatch(/(^|\s)top-4(\s|$)/);
  });

  it("gives TILT a 44 px target and toggles it", () => {
    const onToggleTilt = vi.fn();
    render(<Harness useTilt={false} onToggleTilt={onToggleTilt} />);
    const tilt = screen.getByRole("button", { name: /TILT OFF/ });

    expect(tilt).toHaveClass("min-h-[44px]");
    expect(tilt).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tilt);
    expect(onToggleTilt).toHaveBeenCalledTimes(1);
  });

  it("shows the steering buttons when tilt is off, and no CALIBRATE", () => {
    render(<Harness useTilt={false} />);
    const steering = screen.getByTestId("steering-area");

    expect(within(steering).getByRole("button", { name: "◀" })).toBeInTheDocument();
    expect(within(steering).getByRole("button", { name: "▶" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CALIBRATE/ })).toBeNull();
  });

  it("shows CALIBRATE instead of the steering buttons when tilt is on", () => {
    const onCalibrate = vi.fn();
    render(<Harness useTilt onCalibrate={onCalibrate} />);

    const calibrate = screen.getByRole("button", { name: /CALIBRATE/ });
    expect(calibrate).toHaveClass("min-h-[44px]");
    expect(screen.queryByTestId("steering-area")).toBeNull();
    expect(screen.queryByRole("button", { name: "◀" })).toBeNull();
    expect(screen.getByRole("button", { name: /TILT ON/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(calibrate);
    expect(onCalibrate).toHaveBeenCalledTimes(1);
  });

  it("puts CALIBRATE where the arrows were upright, and right of TILT sideways", () => {
    render(<Harness useTilt />);
    const calibrate = screen.getByTestId("calibrate-button");

    // Upright phone: the arrow column's place, far below the left HUD.
    expect(calibrate).toHaveClass(
      "left-4",
      "top-[calc(50%-1.5rem)]",
      "md:top-[calc(50%-1.75rem)]",
      "-translate-y-1/2"
    );
    // Phone on its side: the left HUD column (Session, Challenges) fills
    // the left side, so CALIBRATE sits in TILT's row, right of TILT
    // (TILT is 8rem wide and centered), and stops short of the NOS column.
    expect(calibrate).toHaveClass(
      "short:left-[calc(50%+4.5rem)]",
      "short:top-16",
      "short:translate-y-0",
      "short:max-w-[calc(50%-11rem)]"
    );
    expect(screen.getByTestId("tilt-toggle")).toHaveClass("short:top-16", "min-w-[8rem]");
  });

  it("does not move TILT when the kid turns tilt on", () => {
    const { rerender } = render(<Harness useTilt={false} />);
    const off = screen.getByTestId("tilt-toggle");
    const placement = off.className.replace(/bg-\S+/g, "");

    rerender(<Harness useTilt />);
    const on = screen.getByTestId("tilt-toggle");

    // Same element, same place: only its color changes.
    expect(on).toBe(off);
    expect(on.className.replace(/bg-\S+/g, "")).toBe(placement);
    expect(on).toHaveClass("min-w-[8rem]");
  });

  it("draws the NOS meter inside the NOS button, not under the horn", () => {
    render(<Harness useTilt={false} />);
    const meter = screen.getByTestId("nos-meter");
    const nos = meter.closest("button");

    expect(nos).toHaveTextContent("NOS");
    expect(nos).toHaveClass("relative");
  });

  it("keeps the side columns centered on the whole screen, not the lower layer", () => {
    render(<Harness useTilt={false} />);
    expect(screen.getByTestId("steering-area")).toHaveClass(
      "top-[calc(50%-1.5rem)]",
      "md:top-[calc(50%-1.75rem)]"
    );
    expect(
      screen.getByRole("button", { name: "◀" }).closest("[data-testid='steering-area']")
    ).toBeInTheDocument();
  });
});
