import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GameProgressCard } from "../components/GameProgressCard";
import type { GameDisplayInfo } from "@/shared/lib/gameStatExtractor";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function snake(): GameDisplayInfo {
  return {
    appId: "snake",
    displayName: "Snake",
    icon: "🐍",
    color: "orange",
    lastPlayed: new Date(),
    primaryStat: { label: "High Score", value: "120" },
    secondaryStats: [{ label: "Games", value: "5" }],
    fullData: {},
    hasDetailView: false,
    isApp: false,
  };
}

describe("GameProgressCard", () => {
  it("is one solid color per game (the 700 shade, where white words measure at least 4.5:1), not a gradient", () => {
    render(<GameProgressCard game={snake()} />);
    const card = screen.getByRole("heading", { name: "Snake" }).closest("div.rounded-2xl")!;

    expect(card).toHaveClass("bg-orange-700");
    expect(card.className).not.toMatch(/bg-gradient|from-|to-orange/);
  });
});
