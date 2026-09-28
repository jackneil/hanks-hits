import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The whole chain that the release uses: legal.json, then config/legal.ts,
 * then the /privacy route, then the page. The other tests give the page its
 * contact values directly, so a wrong field in legal.ts would pass them.
 * Here the JSON file itself holds the filled values.
 */
vi.mock("@/config/legal.json", () => ({
  default: {
    _comment: "test values",
    operatorName: "  Example Games LLC  ",
    mailingAddress: "PO Box 123\nSpringfield, ST 00000",
    phone: "(555) 555-0123",
    email: "privacy@example.com",
  },
}));

import PrivacyRoute from "@/app/privacy/page";

describe("/privacy route with a filled legal.json", () => {
  it("shows each value from legal.json in its own row, with working links", () => {
    render(<PrivacyRoute />);

    const contact = screen.getByTestId("operator-contact");
    const rows = Array.from(contact.querySelectorAll(":scope > div"));
    const row = (label: string) => {
      const found = rows.find((r) => r.querySelector("dt")?.textContent === label);
      expect(found, label).toBeDefined();
      return found!.querySelector("dd") as HTMLElement;
    };

    // legal.ts trims the values.
    expect(row("Operator")).toHaveTextContent(/^Example Games LLC$/);
    expect(within(row("Mailing address")).getByText("PO Box 123")).toBeInTheDocument();
    expect(within(row("Mailing address")).getByText("Springfield, ST 00000")).toBeInTheDocument();
    expect(within(row("Phone")).getByRole("link", { name: "(555) 555-0123" })).toHaveAttribute(
      "href",
      "tel:5555550123"
    );
    expect(
      within(row("Email")).getByRole("link", { name: "privacy@example.com" })
    ).toHaveAttribute("href", "mailto:privacy@example.com");

    expect(within(contact).queryByText("Coming soon")).not.toBeInTheDocument();
    expect(screen.getByText(/^Example Games LLC runs /)).toBeInTheDocument();
  });
});
