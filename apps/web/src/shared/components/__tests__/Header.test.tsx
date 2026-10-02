import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth/react")>();
  return { ...actual, useSession: () => ({ data: null, status: "unauthenticated" }) };
});

import { Header } from "../Header";

// The header bar is bg-slate-950. The back arrow set no colour, so it took
// the theme's dark base-content (#1e3a5f, about 1.75:1 on the bar). On a
// phone the word "Home" is hidden (md:inline), so the arrow is the whole
// control (measured on /login and /profile at 375x667, 2026-10-02).

describe("Header back link", () => {
  it("is named Home for a screen reader, also on a phone where the word is hidden", () => {
    render(<Header />);
    const link = screen.getByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("/");
    // The visible word waits for md:, so the label must not depend on it.
    expect(screen.getByText("Home").className.split(/\s+/)).toContain("hidden");
  });

  it("gives the arrow its own light colour, not the theme's dark text colour", () => {
    render(<Header />);
    const arrow = screen.getByText("←");
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(arrow.className.split(/\s+/)).toEqual(expect.arrayContaining(["text-white/80", "group-hover:text-white"]));
  });

  it("has no back link when showBackButton is false", () => {
    render(<Header showBackButton={false} />);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });
});
