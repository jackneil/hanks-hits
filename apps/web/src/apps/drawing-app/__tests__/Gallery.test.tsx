import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { Gallery } from "../components/Gallery";
import { useDrawingStore } from "../lib/store";

function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const artwork = {
  id: "art-1",
  name: "Truck Drawing",
  thumbnail: "data:image/png;base64,",
  dataUrl: "data:image/png;base64,",
  createdAt: new Date().toISOString(),
  editedAt: new Date().toISOString(),
};

beforeEach(() => {
  useDrawingStore.setState({ savedArtworks: [artwork] });
});

describe("drawing-app Gallery delete button", () => {
  it("stays visible on coarse (touch) pointers — fingers can't hover", () => {
    // Regression: the delete button was opacity-0 + group-hover:opacity-100,
    // i.e. invisible and undiscoverable on a phone (verified opacity 0 at
    // 32x32 in a touch-emulated browser).
    mockPointer(true);
    render(<Gallery onLoadArtwork={() => {}} onClose={() => {}} />);

    const del = screen.getByRole("button", { name: "Delete artwork" });
    expect(del.className).toContain("opacity-100");
    expect(del.className).not.toContain("opacity-0");
    // 44px touch target (w-11 h-11)
    expect(del.className).toContain("w-11");
  });

  it("keeps the hover reveal on fine (mouse) pointers", () => {
    mockPointer(false);
    render(<Gallery onLoadArtwork={() => {}} onClose={() => {}} />);

    const del = screen.getByRole("button", { name: "Delete artwork" });
    expect(del.className).toContain("opacity-0");
    expect(del.className).toContain("group-hover:opacity-100");
  });
});
