import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useShellOverlay, useShellOverlays } from "../shellOverlays";

function Overlay({ open }: { open: boolean }) {
  useShellOverlay(open);
  return null;
}

beforeEach(() => {
  useShellOverlays.setState({ count: 0 });
});

describe("shellOverlays", () => {
  it("counts an overlay while it is open, and lets it go when it closes or unmounts", () => {
    const { rerender, unmount } = render(<Overlay open />);
    expect(useShellOverlays.getState().count).toBe(1);
    rerender(<Overlay open={false} />);
    expect(useShellOverlays.getState().count).toBe(0);
    rerender(<Overlay open />);
    expect(useShellOverlays.getState().count).toBe(1);
    unmount();
    expect(useShellOverlays.getState().count).toBe(0);
  });

  it("counts two overlays as two, and never goes below zero", () => {
    const { unmount } = render(
      <>
        <Overlay open />
        <Overlay open />
      </>
    );
    expect(useShellOverlays.getState().count).toBe(2);
    unmount();
    expect(useShellOverlays.getState().count).toBe(0);
    useShellOverlays.getState().close();
    expect(useShellOverlays.getState().count).toBe(0);
  });
});
