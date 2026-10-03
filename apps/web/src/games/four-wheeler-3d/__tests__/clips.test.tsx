import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const html = vi.hoisted(() => vi.fn());
vi.mock("@react-three/drei", () => ({ Html: (props: { children: ReactNode }) => { html(props); return <div data-testid="private-html-layer">{props.children}</div>; } }));
import { OutfitText } from "../components/models/OutfitText";
import { useFourWheeler3dStore } from "../lib/store";
import { adventureClipState } from "../lib/clipState";

const initial = useFourWheeler3dStore.getState();
afterEach(() => { cleanup(); useFourWheeler3dStore.setState(initial, true); vi.restoreAllMocks(); html.mockClear(); });

describe("Four-Wheeler recording phases", () => {
  const active = { hasStarted: true, isPaused: false };
  it("waits for Play and the R3F canvas", () => {
    expect(adventureClipState(active, false, false, false, 1).phase).toBe("idle");
    expect(adventureClipState({ ...active, hasStarted: false }, false, true, false, 1).phase).toBe("idle");
    expect(adventureClipState(active, false, true, false, 1).phase).toBe("playing");
  });
  it("holds during site pause, a shell overlay, and every adventure panel", () => {
    expect(adventureClipState({ ...active, isPaused: true }, false, true, false, 1).phase).toBe("hold");
    expect(adventureClipState(active, true, true, false, 1).phase).toBe("hold");
    expect(adventureClipState(active, false, true, true, 1).phase).toBe("hold");
  });
  it("uses the real adventure generation to split a restart", () => {
    expect(adventureClipState(active, false, true, false, 17).runId).toBe(17);
    expect(adventureClipState(active, false, true, false, 18).runId).toBe(18);
  });
});

describe("private outfit text", () => {
  it("keeps customization readable locally without creating a canvas or GPU texture", () => {
    useFourWheeler3dStore.setState({ progress: { ...initial.progress, adventure: { ...initial.progress.adventure, outfit: { ...initial.progress.adventure.outfit, text: "MY NAME" } } } });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const { container } = render(<OutfitText position={[0, 1, .15]} back width={.24} />);
    expect(screen.getByText("MY NAME")).toBeInTheDocument();
    expect(getContext).not.toHaveBeenCalled();
    expect(container.querySelector("canvas, mesh, meshStandardMaterial")).toBeNull();
    expect(html).toHaveBeenCalledWith(expect.objectContaining({ transform: true, occlude: true, pointerEvents: "none", position: [0, 1, .15], rotation: [0, Math.PI, 0], distanceFactor: .24 * 400 / 512 }));
  });
  it("creates no private HTML surface for an empty outfit", () => {
    useFourWheeler3dStore.setState({ progress: { ...initial.progress, adventure: { ...initial.progress.adventure, outfit: { ...initial.progress.adventure.outfit, text: "" } } } });
    render(<OutfitText position={[0, 1, .15]} />);
    expect(html).not.toHaveBeenCalled();
  });
});
