import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
