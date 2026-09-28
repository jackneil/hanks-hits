import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClipServiceContext, useClipService, useClipSnapshot } from "../context";
import { HIDDEN_SNAPSHOT, type ClipServiceApi, type ClipSnapshot } from "../contract";

function Probe() {
  const snapshot = useClipSnapshot();
  const service = useClipService();
  return (
    <p data-testid="probe">
      {snapshot.button}|{snapshot.version}|{service ? "service" : "none"}
    </p>
  );
}

/** Only the store part of the contract; the hooks touch nothing else. */
function storeOnly() {
  let snapshot: ClipSnapshot = { ...HIDDEN_SNAPSHOT, version: 1, button: "warming", engine: "warming" };
  const listeners = new Set<() => void>();
  const service = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => HIDDEN_SNAPSHOT,
  } as unknown as ClipServiceApi;
  const set = (next: Partial<ClipSnapshot>) => {
    snapshot = { ...snapshot, ...next, version: snapshot.version + 1 };
    listeners.forEach((listener) => listener());
  };
  return { service, set, listeners };
}

describe("clip service context hooks", () => {
  it("gives the hidden snapshot and no service without a provider", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("hidden|0|none");
  });

  it("reads the live snapshot, follows changes, and unsubscribes on unmount", () => {
    const { service, set, listeners } = storeOnly();
    const view = render(
      <ClipServiceContext.Provider value={service}>
        <Probe />
      </ClipServiceContext.Provider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("warming|1|service");

    act(() => set({ button: "ready", engine: "buffering" }));
    expect(screen.getByTestId("probe").textContent).toBe("ready|2|service");

    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it("keeps the hidden snapshot frozen", () => {
    expect(Object.isFrozen(HIDDEN_SNAPSHOT)).toBe(true);
    expect(HIDDEN_SNAPSHOT.button).toBe("hidden");
    expect(HIDDEN_SNAPSHOT.tier).toBe("none");
  });
});
