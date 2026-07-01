import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DrawingApp } from "../DrawingApp";

vi.mock("../components/Canvas", () => ({
  Canvas: () => <div>Canvas</div>,
}));

vi.mock("../components/Toolbar", () => ({
  Toolbar: () => <div>Toolbar</div>,
}));

vi.mock("../components/ColorPicker", () => ({
  ColorPicker: () => <div>Color picker</div>,
}));

vi.mock("../components/BrushSettings", () => ({
  BrushSettings: () => <div>Brush settings</div>,
}));

vi.mock("../components/Gallery", () => ({
  Gallery: () => <div>Gallery</div>,
}));

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    syncStatus: "idle",
  }),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => <button>Enter fullscreen</button>,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

describe("DrawingApp", () => {
  it("fills the game shell content area instead of escaping under the shared header", () => {
    render(<DrawingApp />);

    expect(screen.getByTestId("drawing-app-root")).toHaveClass(
      "h-[calc(100vh-3rem)]"
    );
    expect(screen.queryByRole("link", { name: "Back to home" })).not.toBeInTheDocument();
  });
});
