import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...actual,
    useSession: () => ({
      data: { user: { id: "u1", name: "Hank", email: null } },
      status: "authenticated",
      update: vi.fn(),
    }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ProfilePage } from "../components/ProfilePage";
import { LEADERBOARD_NAME_LABEL } from "../components/LeaderboardNameToggle";

function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      switch (input) {
        case "/api/profile":
          return json({
            id: "u1",
            name: "Hank",
            email: null,
            image: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            emailVerified: false,
          });
        case "/api/progress":
          return json({ progress: [] });
        case "/api/leaderboards/my-ranks":
          return json({ handle: "TurboFox42", ranks: [] });
        case "/api/gaming-profile":
          return json({ handle: "TurboFox42", showOnLeaderboards: true });
        default:
          return Promise.reject(new Error(`unexpected fetch ${input}`));
      }
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfilePage leaderboard name setting", () => {
  it("is findable in the profile card, next to the kid's name", async () => {
    render(<ProfilePage />);

    const toggle = await screen.findByRole("switch", { name: LEADERBOARD_NAME_LABEL });
    await waitFor(() => expect(toggle).toBeEnabled());

    const card = screen.getByRole("heading", { name: "Hank" }).closest("section");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole("switch")).toBe(toggle);
  });
});
