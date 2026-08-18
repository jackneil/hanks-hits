import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RestartConfirmationDialog } from "../RestartConfirmationDialog";

describe("RestartConfirmationDialog", () => {
  it("focuses Cancel first, traps Tab, and cancels on Escape", () => {
    const onCancel = vi.fn();
    render(
      <RestartConfirmationDialog
        isOpen
        gameName="Breakout"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm restart" });
    expect(document.activeElement).toBe(cancel);

    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger when it closes", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const triggerRef = { current: trigger };
    const { rerender } = render(
      <RestartConfirmationDialog
        isOpen
        gameName="Breakout"
        triggerRef={triggerRef}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    rerender(
      <RestartConfirmationDialog
        isOpen={false}
        gameName="Breakout"
        triggerRef={triggerRef}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
