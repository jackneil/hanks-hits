import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";

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

  it("does not focus the trigger on an initially closed render", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const triggerRef = { current: trigger };
    render(
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


describe("RestartConfirmationDialog read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
    vi.restoreAllMocks();
  });

  it("reads the question and both choices out loud", async () => {
    const synth = installSpeechMock();
    render(
      <RestartConfirmationDialog
        isOpen
        gameName="Snake"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Restart game? Start Snake again from the beginning? Cancel. Restart"
    );
  });

  it("keeps Cancel focused first and cycles Tab through the read-aloud button", async () => {
    installSpeechMock();
    render(
      <RestartConfirmationDialog
        isOpen
        gameName="Snake"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const readAloud = await screen.findByTestId("read-aloud-button");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm restart" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(readAloud);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(confirm);
    // Tab from Restart wraps back to Cancel
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    // Shift+Tab from Cancel wraps back to Restart
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});
