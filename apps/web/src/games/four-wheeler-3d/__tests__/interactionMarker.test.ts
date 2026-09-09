import { describe, expect, it } from "vitest";
import { resolveInteractionMarker } from "../components/InteractionMarker";
import { createAdventureProgress } from "../lib/adventureTypes";
import { createRailSession, RAIL_BOARD_RANGE } from "../lib/rail";
import { LAND_PLOTS } from "../lib/landmarks";
import { propertyDoor, propertySize } from "../lib/property";

describe("world interaction target resolution", () => {
  it("follows the moving train and distinguishes approach from boarding range", () => {
    const a = createAdventureProgress();
    a.trainOwned = true;
    const rail = { ...createRailSession(), position: { x: 650, y: 0, z: 650 } };
    const at = { ...rail.position, x: 650 + RAIL_BOARD_RANGE + 1 };
    expect(resolveInteractionMarker(a, "foot", at, rail)).toMatchObject({
      id: "live-train",
      ready: false,
      action: "rail:board",
    });
    expect(
      resolveInteractionMarker(a, "foot", rail.position, rail),
    ).toMatchObject({ id: "live-train", ready: true });
    expect(
      resolveInteractionMarker(a, "foot", { ...at, x: at.x + 2 }, rail),
    ).toBeNull();
  });
  it("enters a nearby camper but never advertises cargo inside another vehicle", () => {
    const a = createAdventureProgress(),
      position = { x: 650, y: 0, z: 650 };
    a.fleet.camper = {
      ...a.fleet["starter-atv"],
      id: "camper",
      type: "camper",
      position,
      cargo: [],
    };
    expect(resolveInteractionMarker(a, "foot", position, null)).toMatchObject({
      action: "home:camper",
      payload: "camper",
      ready: true,
    });
    a.fleet["starter-atv"].cargo = ["camper"];
    expect(resolveInteractionMarker(a, "foot", position, null)).toBeNull();
  });
  it("targets actual upgraded building and expansion locations", () => {
    const a = createAdventureProgress(),
      plot = LAND_PLOTS[0];
    const saved = a.plots[plot.id];
    saved.owned = true;
    saved.sizeLevel = 4;
    saved.buildings = [
      { slot: 0, type: "house-small", doorOpen: false, parkedVehicleIds: [] },
      { slot: 1, type: "garage", doorOpen: true, parkedVehicleIds: [] },
    ];
    const door = propertyDoor(a, plot.id, 1)!;
    expect(
      resolveInteractionMarker(a, "foot", { ...door, y: 0 }, null),
    ).toMatchObject({
      action: "property:manage",
      payload: `${plot.id}:1`,
      point: { x: door.x, z: door.z },
    });
    const expansion = {
      x: plot.x - propertySize(a, plot.id) * 0.55,
      y: 0,
      z: plot.z,
    };
    expect(resolveInteractionMarker(a, "foot", expansion, null)).toMatchObject({
      id: `property:expand:${plot.id}`,
      action: "property:manage",
      payload: plot.id,
    });
  });
  it("requires the current mode and physical proximity for a ready ride bubble", () => {
    const a = createAdventureProgress(),
      position = { x: 650, y: 0, z: 650 };
    a.fleet["starter-atv"].position = position;
    expect(
      resolveInteractionMarker(a, "foot", { ...position, x: 659 }, null),
    ).toMatchObject({ ready: false });
    expect(resolveInteractionMarker(a, "foot", position, null)).toMatchObject({
      ready: true,
      action: "world:board",
      payload: "starter-atv",
    });
    expect(resolveInteractionMarker(a, "interior", position, null)).toBeNull();
  });
});
