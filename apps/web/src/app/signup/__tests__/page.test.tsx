import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SignUpPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  signInWithCredentials: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

describe("SignUpPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows parent and account-data context before account creation", () => {
    render(<SignUpPage />);

    expect(screen.getByText("For grown-ups")).toBeInTheDocument();
    expect(
      screen.getByText(/Accounts save game progress for this player/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Leaderboard scores may show the player's display name/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/get permission before creating an account/)
    ).toBeInTheDocument();
  });

  it("rejects a 7-character password before ever calling the API", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));

    render(<SignUpPage />);

    fireEvent.change(screen.getByPlaceholderText("your@email.com"), {
      target: { value: "kid@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/at least 8 characters/i), {
      target: { value: "short77" },
    });
    fireEvent.change(screen.getByPlaceholderText("Type it again"), {
      target: { value: "short77" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /create account/i }).closest("form")!
    );

    expect(
      screen.getByText(/at least 8 characters/i, { selector: "p, div, span" })
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells players up front that passwords need 8 characters", () => {
    render(<SignUpPage />);

    const passwordInput = screen.getByPlaceholderText(/at least 8 characters/i);
    expect(passwordInput).toHaveAttribute("minLength", "8");
  });
});
