import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressStorageNotice } from "../ProgressStorageNotice";

afterEach(cleanup);

describe("progress storage warning", () => {
  it("portals the touch-accessible warning outside the game stacking context and dismisses it", () => {
    const view = render(<div style={{ transform: "translateZ(0)" }}><ProgressStorageNotice memoryOnly guestHandoffUnavailable={false} /></div>);
    const notice = screen.getByRole("status", { name: "Progress storage notice" });
    expect(view.container).not.toContainElement(notice);
    expect(notice.parentElement?.parentElement).toBe(document.body);
    expect(notice.parentElement).toHaveClass("fixed", "z-[4000]");
    expect(notice.parentElement?.className).toContain("env(safe-area-inset-top)");
    expect(notice.parentElement?.className).toContain("env(safe-area-inset-left)");
    expect(notice.parentElement?.className).toContain("env(safe-area-inset-right)");
    const acknowledge = screen.getByRole("button", { name: "Got it" });
    expect(acknowledge).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(acknowledge);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a newly distinct failure after the first warning was acknowledged", () => {
    const view = render(<ProgressStorageNotice memoryOnly guestHandoffUnavailable={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    view.rerender(<ProgressStorageNotice memoryOnly guestHandoffUnavailable />);
    expect(screen.getByRole("status")).toHaveTextContent("Guest progress could not be carried into this account");
    expect(screen.queryByText(/Some device saves are unavailable/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    view.rerender(<ProgressStorageNotice memoryOnly guestHandoffUnavailable />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("acknowledges both present failures together without blocking gameplay", () => {
    render(<><button>Play</button><ProgressStorageNotice memoryOnly guestHandoffUnavailable /></>);
    expect(screen.getByRole("status")).toHaveTextContent("Your guest save is still on this device");
    expect(screen.getByRole("status")).toHaveTextContent("Some device saves are unavailable. Keep this page open until your save status is confirmed.");
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  });
});
