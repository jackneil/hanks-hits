import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The profile card shows the made-up gamer name. An account keeps no
 * name, email or photo (COPPA, issue #26i), so the card has none to show
 * and no name to edit. A response from an old server that still sends
 * them must not put them on the screen either.
 */

vi.mock("next-auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...actual,
    useSession: () => ({
      data: { user: { id: "u1", handle: "TurboFox42" } },
      status: "authenticated",
      update: vi.fn(),
    }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ProfilePage } from "../components/ProfilePage";

function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

let profileBody: Record<string, unknown>;

beforeEach(() => {
  profileBody = {
    handle: "TurboFox42",
    // Mid-month at noon, so the month is the same in every time zone.
    createdAt: "2026-01-15T12:00:00.000Z",
    // Fields an old server sent. The page must ignore them.
    name: "Kid Example",
    email: "kid@example.com",
    image: "https://lh3.googleusercontent.com/a/photo",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") {
        return Promise.reject(new Error(`unexpected ${init.method} ${input}`));
      }
      switch (input) {
        case "/api/profile":
          return json(profileBody);
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

describe("ProfilePage card", () => {
  it("shows the gamer name, its first letter and the member-since date", async () => {
    render(<ProfilePage />);
    const heading = await screen.findByRole("heading", { name: "TurboFox42" });
    const card = heading.closest("section") as HTMLElement;
    expect(within(card).getByText("Your gamer name")).toBeInTheDocument();
    expect(within(card).getByTestId("gamer-avatar")).toHaveTextContent("T");
    expect(within(card).getByText(/Member since January 2026/)).toBeInTheDocument();
  });

  it("shows no real name, email or photo, and has no name to edit", async () => {
    const { container } = render(<ProfilePage />);
    await screen.findByRole("heading", { name: "TurboFox42" });
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    expect(container.textContent).not.toMatch(/Kid Example|kid@example\.com/);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(screen.queryByText("✏️")).toBeNull();
  });

  it("has Delete this account in a For grown-ups part, for the parent's right to delete (COPPA 312.6)", async () => {
    render(<ProfilePage />);
    await screen.findByRole("heading", { name: "TurboFox42" });
    const part = screen.getByRole("heading", { name: "For grown-ups" }).closest("section") as HTMLElement;
    expect(within(part).getByRole("button", { name: "Delete this account" })).toBeInTheDocument();
  });

  it("says Player if the gamer name could not be made", async () => {
    profileBody = { handle: null, createdAt: null };
    render(<ProfilePage />);
    expect(await screen.findByRole("heading", { name: "Player" })).toBeInTheDocument();
  });
});
