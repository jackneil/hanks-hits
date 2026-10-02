import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

const authClient = vi.hoisted(() => ({ signInWithGoogle: vi.fn(), signOutAndClear: vi.fn() }));
vi.mock("@/lib/auth-client", () => authClient);

type SessionState = { data: { user: { id: string; handle: string | null } } | null; status: string };
const sessionState = vi.hoisted(() => ({ current: { data: null, status: "unauthenticated" } as SessionState }));
vi.mock("next-auth/react", () => ({ useSession: () => sessionState.current }));

import LoginPage from "../page";
import * as copy from "../copy";

/**
 * The sign-in page (COPPA, issue #26i): Google only, done by a grown-up,
 * and guest play always works. The words are for young players and the
 * read-aloud button reads them out.
 */

afterEach(() => {
  removeSpeechMock();
  authClient.signInWithGoogle.mockReset();
  authClient.signOutAndClear.mockReset();
  sessionState.current = { data: null, status: "unauthenticated" };
  window.history.replaceState(null, "", "/");
});

describe("the sign-in page", () => {
  it("has no email or password form and no sign-up link", () => {
    const { container } = render(<LoginPage />);
    expect(container.querySelector('input[type="email"], input[type="password"], form')).toBeNull();
    expect(container.querySelector('a[href="/signup"]')).toBeNull();
    expect(screen.queryByText(/sign up/i)).toBeNull();
  });

  it("says that a grown-up signs in with Google, and signs in with Google", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: copy.LOGIN_TITLE })).toBeInTheDocument();
    expect(screen.getByText(copy.LOGIN_ASK_A_GROWN_UP)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(authClient.signInWithGoogle).toHaveBeenCalledWith("/");
  });

  it("says that playing without signing in always works, with a way back to the games", () => {
    render(<LoginPage />);
    expect(screen.getByText(copy.LOGIN_GUEST_PLAY)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /just play/i })).toHaveAttribute("href", "/");
  });

  it("gives grown-ups the 312.4(d)(3) notice: what is kept, its uses, and the means", () => {
    const { container } = render(<LoginPage />);
    const note = container.querySelector("#for-grown-ups");
    expect(note, "the home page links /login#for-grown-ups").not.toBeNull();
    expect(screen.getByRole("heading", { name: copy.LOGIN_NOTE_TITLE })).toBeInTheDocument();
    for (const line of [
      copy.LOGIN_NOTE_KEEP,
      copy.LOGIN_NOTE_NOT_KEPT,
      copy.LOGIN_NOTE_USE,
      copy.LOGIN_NOTE_NEVER,
      copy.LOGIN_NOTE_DELETE,
    ]) {
      expect(note).toHaveTextContent(line);
    }
    // The internal operations, and the means that keep the id from being used to contact a player.
    expect(copy.LOGIN_NOTE_USE).toMatch(/only to sign the player in/);
    expect(copy.LOGIN_NOTE_NEVER).toMatch(/not use it to contact a player/);
    expect(copy.LOGIN_NOTE_NOT_KEPT).toMatch(/stay on the device/);
  });

  it("keeps the Google button off until the session is known", () => {
    sessionState.current = { data: null, status: "loading" };
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeDisabled();
  });

  describe("when this browser is already signed in", () => {
    it("shows the gamer name and Sign out, and no Google button", () => {
      sessionState.current = { data: { user: { id: "u1", handle: "TurboFox42" } }, status: "authenticated" };
      const { container } = render(<LoginPage />);
      expect(screen.getByRole("heading", { name: copy.LOGIN_SIGNED_IN_TITLE })).toBeInTheDocument();
      expect(screen.getByText("TurboFox42")).toBeInTheDocument();
      expect(screen.getByText(copy.LOGIN_SIGNED_IN_SWITCH)).toBeInTheDocument();
      // A second Google sign-in here would link that Google account to this player.
      expect(screen.queryByRole("button", { name: /sign in with google/i })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(authClient.signOutAndClear).toHaveBeenCalledWith("/login");
      expect(screen.getByRole("link", { name: /back to the games/i })).toHaveAttribute("href", "/");
      expect(container.querySelector("#for-grown-ups")).not.toBeNull();
    });

    it("says Player when the account has no gamer name yet", () => {
      sessionState.current = { data: { user: { id: "u1", handle: null } }, status: "authenticated" };
      render(<LoginPage />);
      expect(screen.getByText("Player")).toBeInTheDocument();
    });
  });

  it("reads the words to a player who cannot read yet", async () => {
    const synth = installSpeechMock();
    render(<LoginPage />);
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    const spoken = synth.lastUtterance().text;
    for (const line of [copy.LOGIN_TITLE, copy.LOGIN_ASK_A_GROWN_UP, copy.LOGIN_GUEST_PLAY]) {
      expect(spoken).toContain(line);
    }
  });

  it("shows a kind message when Google sign-in fails", () => {
    window.history.replaceState(null, "", "/login?error=OAuthCallbackError");
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(copy.LOGIN_FAILED);
  });

  it("uses no dashes in its words (user-facing copy rule)", () => {
    for (const text of Object.values(copy)) {
      expect(text).not.toMatch(/[‒-―]|--| - /);
    }
  });
});
