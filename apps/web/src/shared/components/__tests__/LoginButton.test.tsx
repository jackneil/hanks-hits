import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoginButton } from "../LoginButton";

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
