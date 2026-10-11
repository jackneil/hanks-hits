import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReleaseNotice } from "../ReleaseNotice";
const state = vi.hoisted(() => ({ placement: "page", pathname: "/", durable: false,
  retry: null as null | (() => Promise<void>), prepare: (): boolean => false }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("../LiveProvider", () => ({ useLive: () => ({ update: { id: "new", builtAt: 100 } }) }));
vi.mock("@/shared/lib/gameBreaks", () => ({ useNudgePlacement: () => ({ kind: state.placement }) }));
vi.mock("@/lib/owner-bound-progress", () => ({ ownerBoundProgress: {
  captureLease: () => ({ ownerKey: "guest", generation: 1 }), prepareReload: () => state.prepare(),
  isCurrent: () => true,
} }));
vi.mock("@/shared/lib/progressSyncPresentation", () => ({ progressSyncPresentation: {
  getSnapshot: () => state.retry ? [{ ownerKey: "guest", generation: 1, retry: state.retry, localDurable: true }] : [],
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); state.placement = "page"; state.pathname = "/"; state.durable = false; state.retry = null; state.prepare = () => false; });
describe("release notice", () => {
  it("waits during active gameplay and can be deferred at a safe surface", () => {
    state.placement = "wait"; const view = render(<ReleaseNotice />);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    state.placement = "page"; view.rerender(<ReleaseNotice />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });
  it("refuses a reload when current progress is not durable", async () => {
    render(<ReleaseNotice />); fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Your save needs a moment"));
  });
  it("restores controls when a cloud retry never resolves", async () => {
    vi.useFakeTimers(); state.prepare = () => true; state.retry = () => new Promise(() => {});
    render(<ReleaseNotice />); fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    const { act } = await import("@testing-library/react");
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByRole("alert").textContent).toContain("Your save needs a moment");
    expect(screen.getByRole("button", { name: "Later" })).not.toBeDisabled();
  });
  it.each(["play", "navigate"])("cancels deferred refresh after leaving its safe surface: %s", async action => {
    let finish!: () => void;
    state.prepare = vi.fn(() => true); state.retry = () => new Promise(resolve => { finish = resolve; });
    const view = render(<ReleaseNotice />); fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    if (action === "play") state.placement = "wait"; else state.pathname = "/games/snake";
    view.rerender(<ReleaseNotice />);
    const { act } = await import("@testing-library/react");
    await act(async () => { finish(); });
    // No second durability check or reload is reached after resuming play.
    expect(state.prepare).toHaveBeenCalledOnce();
  });
  it("cancels an inbox refresh immediately on unmount without a stranded deadline", async () => {
    vi.useFakeTimers(); let finish!: () => void;
    state.prepare = vi.fn(() => true); state.retry = () => new Promise(resolve => { finish = resolve; });
    const view = render(<ReleaseNotice inbox />); fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const { act } = await import("@testing-library/react");
    await act(async () => { view.unmount(); finish(); });
    expect(state.prepare).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
