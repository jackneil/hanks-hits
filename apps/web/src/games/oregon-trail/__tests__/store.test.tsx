import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Event } from "../components/Event";
import { useOregonTrailStore } from "../lib/store";

function resetRiverState() {
  localStorage.clear();
  useOregonTrailStore.setState({
    gamePhase: "river",
    currentRiver: { name: "Green River", depth: 5 },
    currentEvent: null,
    riversCrossed: 0,
    supplies: {
      food: 100,
      oxen: 2,
      clothing: 2,
      ammunition: 20,
      spareParts: { wheels: 1, axles: 1, tongues: 1 },
      money: 100,
    },
  });
}

describe("Oregon Trail river crossings", () => {
  beforeEach(() => {
    resetRiverState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces successful ferry crossing feedback", () => {
    useOregonTrailStore.getState().crossRiver("ferry");

    const state = useOregonTrailStore.getState();
    expect(state.gamePhase).toBe("event");
    expect(state.currentRiver).toBeNull();
    expect(state.currentEvent?.message).toBe("Ferry took you across!");
    expect(state.supplies.money).toBe(80);
    expect(state.riversCrossed).toBe(1);

    render(<Event />);
    expect(screen.getByText("Safe Crossing!")).toBeInTheDocument();
    expect(screen.getByText("Ferry took you across!")).toBeInTheDocument();
  });

  it("surfaces failed crossing feedback with lost supplies", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    useOregonTrailStore.getState().crossRiver("caulk");

    const state = useOregonTrailStore.getState();
    expect(state.gamePhase).toBe("event");
    expect(state.currentEvent?.title).toBe("Green River Trouble!");
    expect(state.currentEvent?.message).toBe(
      "Wagon tipped! Lost 30 lbs food, 10 bullets."
    );
    expect(state.supplies.food).toBe(70);
    expect(state.supplies.ammunition).toBe(10);

    render(<Event />);
    expect(screen.getByText("Green River Trouble!")).toBeInTheDocument();
    expect(
      screen.getByText("Wagon tipped! Lost 30 lbs food, 10 bullets.")
    ).toBeInTheDocument();
  });
});
