import { fireEvent, render, screen, within } from "@testing-library/react";
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
    // Leaderboards show the random handle (gaming_profiles.handle), never
    // users.name, so the page must not claim the typed name goes public.
    expect(
      screen.getByText(/Leaderboards show a random player name, never the name typed here/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/display name/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/get permission before creating an account/)
    ).toBeInTheDocument();
  });

  it("links the privacy notice from the grown-up note and next to the email field", () => {
    render(<SignUpPage />);

    const noteLink = screen.getByRole("link", { name: "Read our privacy notice" });
    expect(noteLink).toHaveAttribute("href", "/privacy");

    const emailInput = screen.getByPlaceholderText("your@email.com");
    const noteId = emailInput.getAttribute("aria-describedby");
    expect(noteId).toBeTruthy();
    const emailNote = document.getElementById(noteId!);
    expect(emailNote).toHaveTextContent(/We never send email/);
    const emailNoteLink = within(emailNote!).getByRole("link", {
      name: "Privacy notice",
    });
    expect(emailNoteLink).toHaveAttribute("href", "/privacy");
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
