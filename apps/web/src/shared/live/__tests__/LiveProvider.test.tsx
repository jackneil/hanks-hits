import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveProvider, useLive } from "../LiveProvider";
const session = vi.hoisted(() => ({ id: "a", status: "authenticated" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: session.id } }, status: session.status }) }));
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor() { FakeSocket.instances.push(this); }
}
function Probe() { const live = useLive(); return <div><p>{live.items.map(item => item.actorHandle).join(",") || "empty"}</p><button onClick={live.refresh}>Refresh</button></div>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); FakeSocket.instances = []; session.id = "a"; session.status = "authenticated"; });
describe("live provider lifecycle", () => {
  it("shares one connection, coalesces invalidations and closes on unmount", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("ticket") ? { ticket: "signed" } : url.includes("release") ? { id: "dev", builtAt: 0 } : { items: [] }))));
    const view = render(<LiveProvider><Probe /><Probe /></LiveProvider>);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    act(() => { FakeSocket.instances[0].onopen?.(); FakeSocket.instances[0].onmessage?.({ data: '{"type":"inbox"}' }); });
    await waitFor(() => expect(screen.getAllByText("empty")).toHaveLength(2));
    view.unmount(); expect(FakeSocket.instances[0].close).toHaveBeenCalledOnce();
  });
  it("discards a late history response after the account changes", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    let finishA: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("notifications") && session.id === "a") return new Promise<Response>(resolve => { finishA = resolve; });
      return Promise.resolve(new Response(JSON.stringify(url.includes("ticket") ? { ticket: "signed" } : url.includes("release") ? { id: "dev", builtAt: 0 } : { items: [] })));
    }));
    const view = render(<LiveProvider><Probe /></LiveProvider>);
    await waitFor(() => expect(finishA).toBeDefined());
    session.id = "b"; view.rerender(<LiveProvider><Probe /></LiveProvider>);
    await act(async () => { finishA?.(new Response(JSON.stringify({ items: [{ id: "private-a", actorHandle: "OnlyA" }] }))); });
    expect(screen.queryByText("OnlyA")).toBeNull(); expect(screen.getByText("empty")).toBeTruthy();
    expect(FakeSocket.instances[0].close).toHaveBeenCalled();
  });
});
