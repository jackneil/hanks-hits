import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfilePage } from "../components/ProfilePage";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", name: "Sam" } },
    status: "authenticated",
    update: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  signOutAndClear: vi.fn(),
}));

vi.mock("@/shared/components/Header", () => ({
  Header: () => <header>Header</header>,
}));

vi.mock("@/shared/components/TrophyCase", () => ({
  TrophyCase: () => null,
}));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The name editor on My Profile collects a name, so COPPA 16 CFR 312.4(d)
 * needs the privacy notice link next to it.
 */
describe("ProfilePage name editor", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/profile") {
        return json({
          id: "user-1",
          name: "Sam",
          email: null,
          image: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          emailVerified: false,
        });
      }
      if (url === "/api/progress") return json({ progress: [] });
      return json({ handle: null, ranks: [] });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a privacy notice link next to the name field, in a new tab", async () => {
    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole("button", { name: /Sam/ }));
    expect(screen.getByPlaceholderText("Your name")).toBeInTheDocument();

    const link = screen.getByRole("link", {
      name: /^Privacy notice\s*\(opens in a new tab\)$/,
    });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.className).toMatch(/min-h-\[44px\]/);
  });
});
