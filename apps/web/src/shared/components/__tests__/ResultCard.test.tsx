import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResultCard, ResultLine } from "../ResultCard";

describe("ResultCard", () => {
  it("shows the title and the lines at the top of the picture, taking no taps", () => {
    render(
      <ResultCard testId="card" title="Game over!">
        <ResultLine big>Score 12</ResultLine>
        <ResultLine>Best 30</ResultLine>
      </ResultCard>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveTextContent("Game over!Score 12Best 30");
    // The chip is a bar at the bottom: the card is anchored to the top.
    expect(card.className).toContain("top-0");
    expect(card.className).not.toContain("inset-0");
    expect(card.className).toContain("pointer-events-none");
  });

  it("sits in document.body across the screen, so a narrow or clipped picture cannot squeeze or cut it", () => {
    render(
      <div data-testid="picture" style={{ width: 200, overflow: "hidden" }}>
        <ResultCard testId="card" title="Game over!">
          <ResultLine big>Score 56</ResultLine>
        </ResultCard>
      </div>,
    );
    const card = screen.getByTestId("card");
    expect(screen.getByTestId("picture")).not.toContainElement(card);
    expect(card.parentElement).toBe(document.body);
    expect(card.className).toContain("fixed");
    expect(card.className).toContain("inset-x-0");
    expect(card).toHaveAttribute("data-result-card");
  });
});
