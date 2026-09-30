/**
 * The HUD on a phone puts every button that depends on where you are into
 * the one context slot the shared layout keeps clear of the thumb controls
 * (phone UX audit 2026-09-30). On a mouse screen they stay where they were.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";

import { AdventureHUD } from "../components/ui/AdventureHUD";
import { defaultProgress, useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { useActivitiesSession } from "../lib/activitiesSession";
import { CONTEXT_SLOT } from "../lib/hudLayout";

function contextRow(container: HTMLElement) {
  const row = container.querySelector<HTMLElement>(".fw-context");
  if (!row) throw new Error("no context row");
  return row;
}

function setHunger(hunger: number, dogHours: number) {
  const progress = structuredClone(defaultProgress);
  progress.hunger = hunger;
  progress.adventure.dog.hungerHours = dogHours;
  useFourWheeler3dStore.setState({ progress });
}

beforeEach(() => {
  useAdventureSession.getState().reset();
  useActivitiesSession.setState({ nozzle: false });
  useFourWheeler3dStore.setState({
    progress: structuredClone(defaultProgress),
    mode: "vehicle",
    hasStarted: true,
    isPaused: false,
  });
});
afterEach(() => cleanup());

describe("the phone HUD context slot", () => {
  it("hands the layout's slot to the stylesheet as CSS variables", () => {
    const { container } = render(<AdventureHUD mobile />);
    const root = container.querySelector<HTMLElement>(".fw-ui.fw-mobile")!;
    expect(root.style.getPropertyValue("--fw-ctx-up-bottom")).toBe(
      `${CONTEXT_SLOT.upright.bottom}px`,
    );
    expect(root.style.getPropertyValue("--fw-ctx-side-left")).toBe(
      `${CONTEXT_SLOT.sideways.left}px`,
    );
  });

  it("leaves NOS to the pedals on a phone and keeps it in the row on a mouse screen", () => {
    const phone = render(<AdventureHUD mobile />);
    const phoneRow = within(contextRow(phone.container));
    expect(phoneRow.getByRole("button", { name: "Hop off" })).toBeTruthy();
    expect(phoneRow.queryByRole("button", { name: "NOS" })).toBeNull();
    cleanup();

    const desk = render(<AdventureHUD mobile={false} />);
    expect(
      within(contextRow(desk.container)).getByRole("button", { name: "NOS" }),
    ).toBeTruthy();
  });

  it("puts Go outside in the context slot on a phone (the map label hides sideways)", () => {
    useFourWheeler3dStore.setState({ mode: "interior" });
    useAdventureSession.setState({
      interior: {
        id: "garage-1",
        kind: "garage",
        returnPosition: { x: 0, y: 0, z: 0 },
        rooms: 1,
      },
    });
    const phone = render(<AdventureHUD mobile />);
    const row = within(contextRow(phone.container));
    expect(row.getByRole("button", { name: "Go outside" })).toBeTruthy();
    expect(row.getByRole("button", { name: "Manage parked rides" })).toBeTruthy();
    expect(
      phone.container.querySelectorAll(".fw-route-label button"),
    ).toHaveLength(0);
    cleanup();

    const desk = render(<AdventureHUD mobile={false} />);
    const label = desk.container.querySelector<HTMLElement>(".fw-route-label")!;
    expect(
      within(label).getByRole("button", { name: "Go outside" }),
    ).toBeTruthy();
  });

  it("puts the food buttons in the context slot on a phone and says why on the map label", () => {
    setHunger(20, 20);
    const phone = render(<AdventureHUD mobile />);
    const row = within(contextRow(phone.container));
    expect(row.getByRole("button", { name: "🍽 Find home" })).toBeTruthy();
    expect(row.getByRole("button", { name: "🐕 Feed dog · $10" })).toBeTruthy();
    expect(phone.container.querySelector(".fw-food-warning")).toBeNull();
    expect(
      phone.container.querySelector(".fw-route-label strong")?.textContent,
    ).toBe("Time for food");
    cleanup();

    setHunger(20, 20);
    const desk = render(<AdventureHUD mobile={false} />);
    const card = desk.container.querySelector<HTMLElement>(".fw-food-warning")!;
    expect(within(card).getByRole("button", { name: "🍽 Find home" })).toBeTruthy();
  });

  it("puts the hose controls in the context row instead of a loose corner", () => {
    useFourWheeler3dStore.setState({ mode: "foot" });
    useActivitiesSession.setState({ nozzle: true });
    const { container } = render(<AdventureHUD mobile />);
    const row = within(contextRow(container));
    expect(row.getByRole("button", { name: "Hold to spray hose" })).toBeTruthy();
    expect(row.getByRole("button", { name: "Equipment" })).toBeTruthy();
  });

  it("hides the context row on the train", () => {
    useFourWheeler3dStore.setState({ mode: "train" });
    const { container } = render(<AdventureHUD mobile />);
    expect(contextRow(container).hidden).toBe(true);
  });
});
