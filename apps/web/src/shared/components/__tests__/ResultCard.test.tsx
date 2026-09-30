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
});
