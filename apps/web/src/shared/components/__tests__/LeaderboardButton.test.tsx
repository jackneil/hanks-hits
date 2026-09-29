import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeaderboardButton } from "../LeaderboardButton";

vi.mock("../Leaderboard", () => ({
  Leaderboard: () => <div>Leaderboard content</div>,
}));

/**
 * sRGB values of the Tailwind v4 palette colors that this button may use.
 * Add a color here before the button uses it, so the contrast check can
 * read it.
 */
const PALETTE: Record<string, string> = {
  white: "#ffffff",
  "slate-900": "#0f172b",
  "yellow-300": "#ffdf20",
  "yellow-400": "#fac800",
  "yellow-500": "#f0b100",
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The palette color of the first class with this prefix, for example "bg-". */
function colorOf(className: string, prefix: string): string {
  const token = className
    .split(/\s+/)
    .find((c) => c.startsWith(prefix) && PALETTE[c.slice(prefix.length)]);
  if (!token) throw new Error(`no known ${prefix} color in: ${className}`);
  return PALETTE[token.slice(prefix.length)];
}

describe("LeaderboardButton", () => {
  it("full variant: the label passes 4.5:1 contrast, at rest and on hover", () => {
    render(<LeaderboardButton appId="snake" variant="full" />);
    const button = screen.getByRole("button", { name: /leaderboard/i });
    const classes = button.className;

    const text = colorOf(classes, "text-");
    expect(contrast(text, colorOf(classes, "bg-"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, colorOf(classes, "hover:bg-"))).toBeGreaterThanOrEqual(4.5);
    expect(button).toHaveTextContent("Leaderboard");
  });

  it("full variant: dark text on the yellow fill, never white", () => {
    // Regression: the pause menu's Leaderboard button drew white text on
    // yellow-500, measured at 1.91:1 in Chromium.
    render(<LeaderboardButton appId="snake" variant="full" />);
    const classes = screen.getByRole("button", { name: /leaderboard/i }).className;
    expect(classes).toMatch(/(^|\s)text-slate-900(\s|$)/);
    expect(classes).not.toMatch(/(^|\s)text-white(\s|$)/);
  });

  it("icon variant (the header) has no yellow fill", () => {
    render(<LeaderboardButton appId="snake" variant="icon" />);
    const classes = screen.getByRole("button", { name: /leaderboard/i }).className;
    expect(classes).not.toMatch(/(^|\s)bg-yellow-/);
  });

  it("keeps a 44 px target in both variants", () => {
    const { unmount } = render(<LeaderboardButton appId="snake" variant="full" />);
    expect(screen.getByRole("button").className).toContain("min-h-[44px]");
    unmount();

    render(<LeaderboardButton appId="snake" />);
    expect(screen.getByRole("button").className).toContain("min-h-[44px]");
    expect(screen.getByRole("button").className).toContain("min-w-[44px]");
  });

  it("opens the leaderboard", () => {
    render(<LeaderboardButton appId="snake" variant="full" />);
    fireEvent.click(screen.getByRole("button", { name: /leaderboard/i }));
    expect(screen.getByText("Leaderboard content")).toBeInTheDocument();
  });
});
