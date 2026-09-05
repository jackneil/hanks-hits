import { fireEvent, render, screen } from "@testing-library/react";
import { DRAWING_APP_INSTRUCTIONS } from "../lib/readAloud";
import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    // The shared GameShell owns the centered app name now - no in-app title.
    expect(
      screen.queryByRole("heading", { name: /drawing app/i })
    ).not.toBeInTheDocument();
  });
});

describe("drawing app read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
  });

  it("shows the read-aloud button when the browser can speak", async () => {
    installSpeechMock();
    render(<DrawingApp />);

    expect(await screen.findByTestId("read-aloud-button")).toBeInTheDocument();
  });

  it("speaks the drawing app instructions when tapped", async () => {
    const speech = installSpeechMock();
    render(<DrawingApp />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.lastUtterance().text).toBe(DRAWING_APP_INSTRUCTIONS);
  });

  it("hides the button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<DrawingApp />);

    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});
