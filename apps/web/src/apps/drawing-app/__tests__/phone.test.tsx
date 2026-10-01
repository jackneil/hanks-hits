/**
 * The drawing app on a phone (PR-G8): nothing is ever laid over the
 * canvas. The colors and the brush open in a panel that closes when a
 * color is picked (it pushed the canvas down to a 15 px sliver), and a
 * phone held sideways gets the tools in a rail beside the canvas (they sat
 * on the canvas, so a stroke drew nothing).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/Canvas", () => ({ Canvas: () => <div data-testid="canvas">Canvas</div> }));
vi.mock("../components/Gallery", () => ({ Gallery: () => <div>Gallery</div> }));
vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));

import { DrawingApp } from "../DrawingApp";
import { useDrawingStore } from "../lib/store";

function mockShort(short: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: /max-height/.test(query) ? short : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

afterEach(() => vi.restoreAllMocks());

describe("Drawing app on a phone", () => {
  it("opens the colors in a panel that closes when a color is picked", () => {
    mockShort(false);
    render(<DrawingApp />);
    fireEvent.click(screen.getByRole("button", { name: "Colors and brush" }));
    const panel = screen.getByTestId("drawing-settings");
    fireEvent.click(within(panel).getByRole("button", { name: "Red" }));
    expect(useDrawingStore.getState().color).toBe("#EF4444");
    expect(screen.queryByTestId("drawing-settings")).toBeNull();
  });

  it("sideways puts every tool in a rail beside the canvas, none over it", () => {
    mockShort(true);
    render(<DrawingApp />);
    const rail = screen.getByTestId("drawing-rail");
    for (const name of ["Undo", "Redo", "Pencil", "Colors and brush", "Gallery", "Save", "Clear", "Download", "Print"]) {
      expect(within(rail).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByTestId("drawing-canvas-area").contains(rail)).toBe(false);
  });
});
