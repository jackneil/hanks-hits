import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ value: { data: null as null | { user: { id: string } }, status: "loading" as string } }));
vi.mock("next-auth/react", () => ({ useSession: () => session.value }));

import { ClipSessionWatcher } from "../ClipSessionWatcher";
import { currentSessionUser, onSessionUser, publishSessionUser, resetSessionBusForTests } from "../registry";

beforeEach(() => {
  resetSessionBusForTests();
  session.value = { data: null, status: "loading" };
});
afterEach(() => {
  resetSessionBusForTests();
});

describe("session bus (registry)", () => {
  it("tells each listener about a change once, and keeps the newest value", () => {
    const heard = vi.fn();
    const stop = onSessionUser(heard);
    expect(currentSessionUser()).toBeNull();
    publishSessionUser(null);
    publishSessionUser(null);
    publishSessionUser("kid-1");
    expect(heard.mock.calls).toEqual([[null], ["kid-1"]]);
    expect(currentSessionUser()).toEqual({ userId: "kid-1" });
    stop();
    publishSessionUser("kid-2");
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("keeps going when a listener throws", () => {
    const after = vi.fn();
    onSessionUser(() => {
      throw new Error("bad listener");
    });
    onSessionUser(after);
    publishSessionUser("kid-1");
    expect(after).toHaveBeenCalledWith("kid-1");
  });
});

describe("ClipSessionWatcher", () => {
  it("publishes nothing while next-auth loads, then each session user, on any page (no game needed)", () => {
    const heard = vi.fn();
    onSessionUser(heard);
    const view = render(<ClipSessionWatcher />);
    expect(heard).not.toHaveBeenCalled();
    expect(view.container.innerHTML).toBe("");
    session.value = { data: null, status: "unauthenticated" };
    view.rerender(<ClipSessionWatcher />);
    expect(heard).toHaveBeenLastCalledWith(null);
    // A sign-in completes (another tab did it; next-auth tells this tab).
    session.value = { data: { user: { id: "kid-1" } }, status: "authenticated" };
    act(() => view.rerender(<ClipSessionWatcher />));
    expect(heard).toHaveBeenLastCalledWith("kid-1");
    view.rerender(<ClipSessionWatcher />);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
