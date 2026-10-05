import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import { progressSyncPresentation, type RecoveryOption } from "@/shared/lib/progressSyncPresentation";
import { ProgressRecoveryNotice } from "../ProgressRecoveryNotice";

beforeEach(async () => {
  await ownerBoundProgress.updateSession("authenticated", "summary-owner");
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); act(() => progressSyncPresentation.remove("test")); });

it.each(["drawing-app", "drum-machine"] as const)("identifies distinct %s collections even when settings match", appId => {
  const lease = ownerBoundProgress.captureLease()!;
  const item = (name: string) => ({ id: name, name, createdAt: "2026-10-04T12:00:00.000Z" });
  const collection = appId === "drawing-app" ? "savedArtworks" : "savedBeats";
  const options: RecoveryOption[] = [
    { id: "local", label: "This device", data: { settings: { soundEnabled: true }, [collection]: [item("My rocket")] } },
    { id: "server", label: "Cloud save", data: { settings: { soundEnabled: true }, [collection]: [item("My dinosaur")] } },
  ];
  progressSyncPresentation.publish({ id: "test", appId, ownerKey: lease.ownerKey, generation: lease.generation,
    status: "conflict", localDurable: true, retry: async () => {},
    open: () => ({ options, cloudMissing: false, close: vi.fn(), choose: vi.fn() }) });
  render(<ProgressRecoveryNotice />);
  fireEvent.click(screen.getByRole("button", { name: "Review saves" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("My rocket")).toBeVisible();
  expect(within(dialog).getByText("My dinosaur")).toBeVisible();
});
