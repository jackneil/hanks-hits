import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LoginPage from "../page";

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

/**
 * "Continue with Google" on this page makes a new account the first time
 * a Google account signs in (the Drizzle adapter in lib/auth.ts has no
 * sign-in gate). So this page collects a child's information, and COPPA
 * 16 CFR 312.4(d) needs a clear link to the notice next to that request.
 */
describe("LoginPage", () => {
  it("shows the grown-up note and the privacy notice link before the Google button", () => {
    render(<LoginPage />);

    const note = screen.getByText("For grown-ups").parentElement as HTMLElement;
    expect(note).toHaveTextContent(/The first time a Google account signs in here, it makes a new account/);
    expect(note).toHaveTextContent(/get permission first/);

    const link = within(note).getByRole("link", {
      name: /^Read our privacy notice\s*\(opens in a new tab\)$/,
    });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.className).toMatch(/min-h-\[44px\]/);

    const google = screen.getByRole("button", { name: /Continue with Google/ });
    expect(
      note.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
