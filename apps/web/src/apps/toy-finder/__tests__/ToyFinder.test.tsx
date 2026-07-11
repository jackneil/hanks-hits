import type { AnchorHTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToyFinder } from "../ToyFinder";
import { useToyFinderStore } from "../lib/store";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => null,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

describe("ToyFinder", () => {
  beforeEach(() => {
    useToyFinderStore.setState({
      wishlistItems: [],
      recentlyViewed: [],
      lastModified: Date.now(),
      selectedCategory: "all",
      selectedAgeRange: "all",
      showWishlist: false,
      addedToyId: null,
    });
  });

  it("lets users filter visible toys by age range", () => {
    render(<ToyFinder />);

    expect(
      screen.getByText("LEGO Star Wars Millennium Falcon")
    ).toBeInTheDocument();
    expect(
      screen.getByText("LEGO Technic Monster Jam Megalodon")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ages 9-12" }));

    expect(
      screen.getByText("LEGO Star Wars Millennium Falcon")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("LEGO Technic Monster Jam Megalodon")
    ).not.toBeInTheDocument();
    expect(useToyFinderStore.getState().selectedAgeRange).toBe("9-12");
  });

  it("frames toy saving as an idea list, not a purchase request", () => {
    render(<ToyFinder />);

    expect(screen.getByText("Idea list, not a store")).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing can be bought here/)
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Save Idea/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/I WANT THIS/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NEED IT/i)).not.toBeInTheDocument();
  });

  it("defers home + title to the app shell (no in-app title or home link)", () => {
    render(<ToyFinder />);

    // The shared GameShell owns the home button and centered app name now.
    expect(
      screen.queryByRole("heading", { name: /toy finder/i })
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/"]')).toBeNull();

    // The idea-list (wishlist) button survived the header removal.
    expect(
      screen.getByRole("button", { name: /view idea list/i })
    ).toBeInTheDocument();
  });
});
