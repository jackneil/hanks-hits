import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HomeClient } from "../HomeClient";

vi.mock("@/shared/components/Header", () => ({
  Header: () => <header>Header</header>,
}));

/**
 * COPPA 312.4(d) and (e): the home page has a clearly labeled link to the
 * notice for grown-ups. The account keeps a sign-in id under 312.5(c)(7),
 * which holds only while that notice is live (design/ACCOUNTS_COPPA.md).
 */
describe("HomeClient footer: privacy link for grown-ups", () => {
  it("links the grown-up notice of the sign-in page, with a 44 px touch target", () => {
    render(<HomeClient categories={[]} />);
    const nav = within(screen.getByRole("contentinfo")).getByRole("navigation", { name: "Site information" });
    const link = within(nav).getByRole("link", { name: "Privacy for grown-ups" });
    expect(link).toHaveAttribute("href", "/login#for-grown-ups");
    expect(link.className).toMatch(/min-h-\[44px\]/);
    expect(link.className).toMatch(/inline-flex/);
  });
});
