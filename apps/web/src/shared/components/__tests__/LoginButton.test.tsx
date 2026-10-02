import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  value: { data: null, status: "unauthenticated" } as { data: unknown; status: string },
}));

vi.mock("next-auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-auth/react")>();
  return { ...actual, useSession: () => sessionMock.value };
});

import { LoginButton } from "../LoginButton";

afterEach(() => {
  sessionMock.value = { data: null, status: "unauthenticated" };
});

// The pause menu's Sign In link is the same size as the menu's own
// buttons: 48 px, and 44 px on a short screen (a phone held sideways), so
// the 2 x 2 grid has even rows. It was 48 px next to 44 px cells.

describe("LoginButton in the pause menu", () => {
  it("is 44 px on a short screen, like the other menu buttons", () => {
    render(<LoginButton variant="menu" />);
    const link = screen.getByRole("link", { name: /sign in/i });
    const classes = link.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["btn", "btn-lg", "short:h-11", "short:min-h-11", "short:text-lg"]));
  });
});

// An account keeps no name, email or photo (COPPA, issue #26i). The header
// shows the made-up gamer name, even when a session made before that
// change still carries the old fields.

function signIn(user: Record<string, unknown>) {
  sessionMock.value = { data: { user, expires: "2026-11-01T00:00:00.000Z" }, status: "authenticated" };
}

describe("LoginButton when signed in", () => {
  it("shows the gamer name and its first letter, never a name, an email or a photo", () => {
    signIn({
      id: "u1",
      handle: "TurboFox42",
      name: "Kid Example",
      email: "kid@example.com",
      image: "https://lh3.googleusercontent.com/a/photo",
    });
    const { container } = render(<LoginButton />);

    expect(screen.getByTestId("gamer-avatar")).toHaveTextContent("T");
    expect(container.querySelector("img")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "My account: TurboFox42" }));
    expect(screen.getByText("TurboFox42")).toBeInTheDocument();
    expect(screen.getByText("Your gamer name")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Kid Example|kid@example\.com/);
  });

  it("says Player when there is no gamer name yet", () => {
    signIn({ id: "u1", handle: null });
    render(<LoginButton />);
    expect(screen.getByTestId("gamer-avatar")).toHaveTextContent("P");
    fireEvent.keyDown(screen.getByRole("button", { name: "My account: Player" }), { key: "Enter" });
    expect(screen.getByText("Player")).toBeInTheDocument();
  });
});
