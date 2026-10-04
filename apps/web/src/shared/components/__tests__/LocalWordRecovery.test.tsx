import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  session: { status: "authenticated", data: { user: { id: "A" } } },
  snapshot: { ownerKey: "owner-A", generation: 1, status: "ready", apps: { "oregon-trail": { status: "loading", pendingWrites: false, revision: 0 } } },
  lease: { ownerKey: "owner-A", generation: 1 },
  current: true, canonical: false, listeners: new Set<() => void>(),
  candidates: [] as Array<{ id: string; ownerKey: string; value: string; unmatched?: boolean }>,
  choices: vi.fn(), prepare: vi.fn(), recover: vi.fn(), retry: vi.fn(), commit: vi.fn(), confirm: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => mock.session }));
vi.mock("@/lib/owner-bound-progress", () => ({ ownerBoundProgress: { matchesSession: () => mock.current } }));
vi.mock("@/lib/local-words", () => ({ localWords: {
  subscribe: (listener: () => void) => { mock.listeners.add(listener); return () => mock.listeners.delete(listener); },
  getSnapshot: () => mock.snapshot, captureLease: () => mock.lease, isCurrent: () => mock.current,
  candidates: () => mock.candidates, prepare: mock.prepare, recover: mock.recover, retry: mock.retry, commitCandidate: mock.commit,
} }));
vi.mock("@/shared/lib/localWordRecovery", () => ({
  subscribeWordRecovery: () => () => {}, wordRecoverySynced: () => mock.canonical,
  wordRecoveryActions: () => ({
    candidateChoices: mock.choices,
    mapCandidate: (source: { value: string; unmatched?: boolean }) => source.unmatched ? null : [{ entityKey: '["journey","j"]', field: "leaderName", value: source.value }],
    previewCandidate: (source: { value: string }) => [{ entityKey: '["journey"]', field: "leaderName", value: source.value }],
    confirmUnmatched: mock.confirm,
  }),
}));
import { useShellOverlays } from "@/shared/lib/shellOverlays";
import { LocalWordRecovery } from "../LocalWordRecovery";

beforeEach(() => {
  vi.clearAllMocks(); mock.choices.mockReturnValue(undefined); mock.current = true; mock.canonical = false; mock.candidates = [];
  mock.snapshot = { ownerKey: "owner-A", generation: 1, status: "ready", apps: { "oregon-trail": { status: "loading", pendingWrites: false, revision: 0 } } };
  mock.prepare.mockReturnValue(new Promise(() => {})); mock.recover.mockReturnValue(new Promise(() => {}));
  mock.retry.mockResolvedValue("durable"); mock.commit.mockResolvedValue("durable"); mock.confirm.mockResolvedValue("durable");
});
afterEach(cleanup);

describe("local word recovery surface", () => {
  it("keeps gameplay mounted while local preparation and network recovery are unresolved", () => {
    render(<><LocalWordRecovery appId="oregon-trail" /><button>Play</button></>);
    expect(screen.getByRole("button", { name: "Play" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("You can keep playing");
    expect(mock.prepare).toHaveBeenCalledWith("oregon-trail", mock.lease);
    expect(mock.recover).toHaveBeenCalledWith("oregon-trail", "A", mock.lease);
  });
  it("shows an accessible failure and explicit retry without inventing a loading timeout", async () => {
    mock.snapshot.apps["oregon-trail"].status = "memory-only";
    render(<LocalWordRecovery appId="oregon-trail" />);
    expect(screen.getByRole("status")).toHaveTextContent("Words need saving");
    fireEvent.click(screen.getByRole("button", { name: "Words need saving" }));
    expect(screen.getByRole("status")).toHaveTextContent("This device could not finish saving or recovering your words. Keep this page open and retry. You can keep playing.");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveClass("min-h-11");
    await act(async () => fireEvent.click(retry));
    expect(mock.retry).toHaveBeenCalledWith(mock.lease, "oregon-trail");
  });
  it("escapes same-owner previews and waits for canonical sync before confirming unmatched journey names", async () => {
    mock.candidates = [{ id: "a", ownerKey: "owner-A", value: "<img src=x onerror=alert(1)>", unmatched: true }, { id: "b", ownerKey: "owner-B", value: "Foreign private name" }];
    const view = render(<LocalWordRecovery appId="oregon-trail" />);
    fireEvent.click(screen.getByRole("button", { name: "Words loading or saving (1)" }));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByText("Foreign private name")).toBeNull();
    expect(screen.getByRole("button", { name: "Use saved version 1" })).toBeDisabled();
    mock.canonical = true; view.rerender(<LocalWordRecovery appId="oregon-trail" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use saved version 1" })));
    expect(mock.confirm).toHaveBeenCalledWith(mock.candidates[0], mock.lease);
    expect(screen.getByRole("status")).toHaveTextContent("saved on this device");
  });
  it("lets a player choose one conflicting alias while retaining the other choice", async () => {
    mock.candidates = [{ id: "a", ownerKey: "owner-A", value: "One" }];
    mock.choices.mockReturnValue([
      { label: "First saved name", edits: [{ entityKey: '["pet","cat","birth"]', field: "name", value: "One" }] },
      { label: "Other saved name", edits: [{ entityKey: '["pet","cat","birth"]', field: "name", value: "Two" }] },
    ]);
    render(<LocalWordRecovery appId="oregon-trail" />);
    fireEvent.click(screen.getByRole("button", { name: "Words loading or saving (2)" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use saved version 1" })));
    expect(mock.commit).toHaveBeenCalledWith("oregon-trail", "a", [expect.objectContaining({ value: "One" })], mock.lease, "confirmed-choice");
    expect(screen.queryByText("One")).toBeNull();
    expect(screen.getByText("Two")).toBeInTheDocument();
  });

  it("holds play only while the player opens recovery and restores keyboard focus", () => {
    mock.candidates = [{ id: "a", ownerKey: "owner-A", value: "Saved name" }];
    render(<LocalWordRecovery appId="oregon-trail" />);
    expect(useShellOverlays.getState().count).toBe(0);
    const trigger = screen.getByRole("button", { name: "Words loading or saving (1)" });
    fireEvent.click(trigger);
    expect(useShellOverlays.getState().count).toBe(1);
    const close = screen.getByRole("button", { name: "Keep playing" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useShellOverlays.getState().count).toBe(0);
    expect(trigger).toHaveFocus();
  });

  it("hides all prior-owner words immediately when authority becomes unresolved", () => {
    mock.candidates = [{ id: "a", ownerKey: "owner-A", value: "Private label" }];
    const view = render(<LocalWordRecovery appId="oregon-trail" />);
    fireEvent.click(screen.getByRole("button", { name: "Words loading or saving (1)" }));
    expect(screen.getByText("Private label")).toBeInTheDocument();
    mock.snapshot = { ...mock.snapshot, status: "unresolved" }; mock.current = false;
    view.rerender(<LocalWordRecovery appId="oregon-trail" />);
    expect(screen.queryByText("Private label")).toBeNull();
  });
});
