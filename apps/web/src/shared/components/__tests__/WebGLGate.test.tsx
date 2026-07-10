import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WebGLGate, detectWebGL, resetWebGLSupportCache } from "../WebGLGate";

// Simulated context-creation failure — the audit's black-void scenario.
function stubGetContext(result: unknown) {
  return vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(result as never);
}

beforeEach(() => {
  resetWebGLSupportCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebGLGate", () => {
  it("shows the kid-friendly fallback when a WebGL context cannot be created", async () => {
    stubGetContext(null);

    render(
      <WebGLGate gameName="Monster Truck">
        <div data-testid="scene">3D scene</div>
      </WebGLGate>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/needs 3D powers this device/i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to games/i })).toHaveAttribute(
      "href",
      "/"
    );
  });

  it("renders the game scene when WebGL is available", async () => {
    stubGetContext({});

    render(
      <WebGLGate gameName="Monster Truck">
        <div data-testid="scene">3D scene</div>
      </WebGLGate>
    );

    await waitFor(() => {
      expect(screen.getByTestId("scene")).toBeInTheDocument();
    });
    expect(screen.queryByText(/needs 3D powers/i)).not.toBeInTheDocument();
  });

  it("detectWebGL returns false when context creation throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("blocked");
      }
    );
    expect(detectWebGL()).toBe(false);
  });
});
