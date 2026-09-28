import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HomeClient } from "../HomeClient";

vi.mock("@/shared/components/Header", () => ({
  Header: () => <header>Header</header>,
}));

/**
 * COPPA 16 CFR 312.4(d) needs a clearly labeled link to the privacy notice
 * on the home page. The home page footer carries it.
 */
describe("HomeClient footer", () => {
  it("links the privacy notice with a clear label and a big touch target", () => {
    const { container } = render(<HomeClient categories={[]} />);

    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
    const link = within(footer as HTMLElement).getByRole("link", {
      name: "Privacy notice",
    });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(link.className).toMatch(/min-h-\[44px\]/);
  });

  it("is reachable from the page, not only from a hidden menu", () => {
    render(<HomeClient categories={[]} />);
    expect(screen.getByRole("contentinfo")).toContainElement(
      screen.getByRole("link", { name: "Privacy notice" })
    );
  });
});
