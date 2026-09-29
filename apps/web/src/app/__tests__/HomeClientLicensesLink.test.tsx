import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HomeClient } from "../HomeClient";

vi.mock("@/shared/components/Header", () => ({
  Header: () => <header>Header</header>,
}));

/**
 * The home page footer links the licenses page. The licenses of the clip
 * maker's open-source parts (FFmpeg LGPL-2.1, Mediabunny MPL-2.0) ask for a
 * notice that a person can find.
 */
describe("HomeClient footer: licenses link", () => {
  it("links /licenses with a clear label and a 44 px touch target", () => {
    render(<HomeClient categories={[]} />);
    const footer = screen.getByRole("contentinfo");
    const link = within(footer).getByRole("link", { name: "Licenses" });
    expect(link).toHaveAttribute("href", "/licenses");
    expect(link.className).toMatch(/min-h-\[44px\]/);
    expect(link.className).toMatch(/inline-flex/);
  });

  it("puts the link in a labeled footer navigation", () => {
    render(<HomeClient categories={[]} />);
    const nav = screen.getByRole("navigation", { name: "Site information" });
    expect(screen.getByRole("contentinfo")).toContainElement(nav);
    expect(within(nav).getByRole("link", { name: "Licenses" })).toBeInTheDocument();
  });
});
