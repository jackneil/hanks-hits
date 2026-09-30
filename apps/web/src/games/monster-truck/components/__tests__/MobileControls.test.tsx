import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTouchControls } from "../../hooks/useControls";
import { MobileControls } from "../MobileControls";

function Harness({
  useTilt,
  onToggleTilt = vi.fn(),
  onCalibrate = vi.fn(),
  tiltNote = null,
}: {
  useTilt: boolean;
  onToggleTilt?: () => void;
  onCalibrate?: () => void;
  tiltNote?: string | null;
}) {
  const touchControls = useTouchControls();
  return (
    <MobileControls
      touchControls={touchControls}
      onHorn={vi.fn()}
      nosCharge={50}
      nosMaxCharge={100}
      useTilt={useTilt}
      onToggleTilt={onToggleTilt}
      onCalibrate={onCalibrate}
      tiltNote={tiltNote}
    />
  );
}

describe("Monster Truck MobileControls", () => {
  it("anchors the control layer below the GameShell header, like hill-climb", () => {
    render(<Harness useTilt={false} />);
    const layer = screen.getByTestId("monster-truck-mobile-controls");

    // The old layer was fixed inset-0 with TILT at top-4: inside the
    // 48 px header box, under the header.
    expect(layer).toHaveClass("fixed", "inset-x-0", "bottom-0", "top-[var(--shell-header-h)]");
    expect(layer).not.toHaveClass("inset-0");
  });

  /** The rem value of a `bottom-[..rem]` or `bottom-3` class, with an optional variant prefix. */
  function bottomRem(el: HTMLElement, variant = ""): number {
    const classes = el.className.split(/\s+/);
    const re = new RegExp(`^${variant.replace(":", "\\:")}bottom-(?:\\[([0-9.]+)rem\\]|([0-9.]+))$`);
    for (const c of classes) {
      const m = re.exec(c);
      if (m) return m[1] ? Number(m[1]) : Number(m[2]) / 4;
    }
    throw new Error(`no ${variant}bottom class on ${el.dataset.testid}`);
  }

  it("keeps TILT above the steering slot, upright and sideways (no overlap)", () => {
    render(<Harness useTilt={false} />);
    const tilt = screen.getByTestId("tilt-slot");
    const steering = screen.getByTestId("steering-slot");
    // Upright: steering 8.75rem up, 4rem tall; TILT starts above it.
    expect(bottomRem(tilt)).toBeGreaterThanOrEqual(bottomRem(steering) + 4);
    // Sideways: steering in the corner, 4.5rem tall; TILT above it.
    expect(bottomRem(tilt, "short:")).toBeGreaterThanOrEqual(bottomRem(steering, "short:") + 4.5);
    expect(tilt.className).not.toMatch(/(^|\s)top-/);
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

    expect(within(steering).getByRole("button", { name: "Steer left" })).toHaveTextContent("◀");
    expect(within(steering).getByRole("button", { name: "Steer right" })).toHaveTextContent("▶");
    expect(screen.queryByRole("button", { name: /CALIBRATE/ })).toBeNull();
  });

  it("shows CALIBRATE instead of the steering buttons when tilt is on", () => {
    const onCalibrate = vi.fn();
    render(<Harness useTilt onCalibrate={onCalibrate} />);

    const calibrate = screen.getByRole("button", { name: /CALIBRATE/ });
    expect(calibrate).toHaveClass("min-h-[44px]");
    expect(screen.queryByTestId("steering-area")).toBeNull();
    expect(screen.queryByRole("button", { name: "Steer left" })).toBeNull();
    expect(screen.getByRole("button", { name: /TILT ON/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(calibrate);
    expect(onCalibrate).toHaveBeenCalledTimes(1);
  });

  it("puts CALIBRATE in the steering slot, where the thumb already is", () => {
    render(<Harness useTilt />);
    const calibrate = screen.getByTestId("calibrate-button");
    expect(within(screen.getByTestId("steering-slot")).getByTestId("calibrate-button")).toBe(calibrate);
    expect(screen.getByText(/Tilt your phone to steer/)).toBeInTheDocument();
  });

  it("shows the tilt note (no permission, or no motion sensor) above TILT", () => {
    render(<Harness useTilt={false} tiltNote="Tilt needs your OK. Use the arrows for now!" />);
    const note = within(screen.getByTestId("tilt-slot")).getByRole("status");
    expect(note).toHaveTextContent("Tilt needs your OK");
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

  it("puts the arrows on the left, NOS and the horn on the right, and the pedals in their bar", () => {
    render(<Harness useTilt={false} />);
    const steering = screen.getByTestId("steering-slot");
    const boost = screen.getByTestId("boost-slot");
    const pedals = screen.getByTestId("pedals");
    expect(steering).toHaveClass("left-3");
    expect(boost).toHaveClass("right-3");
    expect(within(boost).getByRole("button", { name: "NOS boost" })).toBeInTheDocument();
    expect(within(boost).getByRole("button", { name: "Horn" })).toBeInTheDocument();
    expect(within(pedals).getByRole("button", { name: "Brake" })).toBeInTheDocument();
    expect(within(pedals).getByRole("button", { name: "Gas" })).toBeInTheDocument();
    // Sideways the pedals leave the whole bottom for the right corner, so
    // the left corner is free for the arrows.
    expect(pedals).toHaveClass("short:left-auto", "short:right-3");
  });
});
