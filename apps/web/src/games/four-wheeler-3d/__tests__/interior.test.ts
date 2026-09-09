import { beforeEach, describe, expect, it } from "vitest";
import {
  enterInterior,
  leaveInterior,
  interiorInteraction,
  INTERIOR_Y,
} from "../components/HomeLife";
import { interact } from "../components/AdventureRuntime";
import { defaultProgress, useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { PROGRESS_SCHEMAS } from "@/lib/progress-schemas";
const outside = { x: -410, y: 4, z: 30, heading: 1.2, speed: 0 };
beforeEach(() => {
  useAdventureSession.getState().reset();
  useAdventureSession.setState({ playerSnapshot: { ...outside } });
  useFourWheeler3dStore.setState({
    progress: structuredClone(defaultProgress),
    hasStarted: true,
    isPaused: false,
    mode: "foot",
  });
});
describe("interior exit is always available", () => {
  it("replaces the exterior property prompt on entry and restores a valid outdoor save on exit", () => {
    useAdventureSession.setState({
      interaction: {
        id: "property:manage:plot-1:0",
        label: "Your garage",
        kind: "property",
        icon: "⌂",
        distance: 0,
        ready: true,
      },
    });
    enterInterior("plot-1:0", "garage");
    expect(useAdventureSession.getState().interaction?.id).toBe("home:exit");
    expect(useFourWheeler3dStore.getState().mode).toBe("interior");
    expect(
      useAdventureSession.getState().relocation?.position.y,
    ).toBeGreaterThanOrEqual(INTERIOR_Y);
    leaveInterior();
    expect(useAdventureSession.getState().interaction).toBeNull();
    expect(useAdventureSession.getState().interior).toBeNull();
    expect(useAdventureSession.getState().relocation?.position.x).toBe(
      outside.x,
    );
    expect(useFourWheeler3dStore.getState().mode).toBe("foot");
    expect(
      PROGRESS_SCHEMAS["four-wheeler-3d"]!.safeParse(
        useFourWheeler3dStore.getState().progress,
      ).success,
    ).toBe(true);
  });
  it.each(["property", "camper", "vehicle"])(
    "E dispatches exit even when a stale %s prompt reaches the interior",
    (kind) => {
      enterInterior("plot-1:0", "garage");
      useAdventureSession.setState({
        interaction: {
          id: "property:manage:plot-1:0",
          label: "Stale outdoors",
          kind,
          icon: "⌂",
          distance: 0,
          ready: true,
        },
      });
      interact();
      expect(useAdventureSession.getState().action?.name).toBe("home:exit");
    },
  );
  it.each(["garage", "trophy", "house", "rv", "yacht"])(
    "keeps an exit action in empty areas of %s",
    (kind) => {
      const interaction = interiorInteraction(kind, { x: 9, z: 4 });
      expect(interaction.id).toBe("home:exit");
      enterInterior("test", kind);
      useAdventureSession.setState({ interaction });
      interact();
      expect(useAdventureSession.getState().action?.name).toBe("home:exit");
    },
  );
  it("allows a nearby indoor station and returns to exit when walking away", () => {
    expect(interiorInteraction("house", { x: 4, z: -3 }).id).toBe("home:rest");
    expect(interiorInteraction("house", { x: 0, z: 0 }).id).toBe("home:exit");
    enterInterior("house", "house");
    useAdventureSession.setState({
      interaction: interiorInteraction("house", { x: 4, z: -3 }),
    });
    interact();
    expect(useAdventureSession.getState().action?.name).toBe("home:rest");
  });
});
