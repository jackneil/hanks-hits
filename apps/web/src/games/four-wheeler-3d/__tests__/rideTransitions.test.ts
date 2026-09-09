import { beforeEach, describe, expect, it } from "vitest";
import { adventureSchema } from "../lib/adventureSchema";
import { createAdventureProgress } from "../lib/adventureTypes";
import { defaultProgress, useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import {
  riderResume,
  deliveryOrigin,
  groundDeliveredFleet,
  canSwitchRide,
  nearbyCamper,
} from "../lib/rideTransitions";
import { advanceDelivery, orderDelivery } from "../lib/economy";
import { applyHuntingItem, sellHuntingKills } from "../lib/hunting";
import { heightAt } from "../lib/terrain";
import { LANDMARKS } from "../lib/landmarks";
import { useActivitiesSession } from "../lib/activitiesSession";
import { transportTuning } from "../lib/transport";
import { savedRider } from "../lib/migration";
import { enterInterior, leaveInterior } from "../components/HomeLife";
import {
  saveRiderPosition,
  boardVehicle,
} from "../components/AdventureRuntime";

const snapshot = { x: -410, y: 4, z: 30, heading: 1.2, speed: 0 };
const session = () => ({
  playerSnapshot: { ...snapshot },
  interior: null,
  transport: null,
});
beforeEach(() => {
  useAdventureSession.getState().reset();
  useAdventureSession.setState({ playerSnapshot: { ...snapshot } });
  useFourWheeler3dStore.setState({
    progress: { ...defaultProgress, adventure: createAdventureProgress() },
    hasStarted: true,
    isPaused: false,
    mode: "vehicle",
  });
});

describe("stable resume and restart", () => {
  it("restarts on foot after selling the active ride, and retains saved clock", () => {
    const store = useFourWheeler3dStore.getState();
    store.updateProgress((p) => ({
      ...p,
      timeOfDay: 19,
      adventure: {
        ...p.adventure,
        activeVehicleId: null,
        rider: { mode: "foot", position: snapshot, heading: 1 },
      },
    }));
    store.resetSession();
    expect(useFourWheeler3dStore.getState().mode).toBe("foot");
    expect(useFourWheeler3dStore.getState().clock).toBe(19);
  });
  it.each(["boat", "heli"] as const)(
    "restarts %s with its own controller",
    (type) => {
      const a = createAdventureProgress();
      a.fleet.test = { ...a.fleet["starter-atv"], id: "test", type };
      a.activeVehicleId = "test";
      useFourWheeler3dStore
        .getState()
        .updateProgress((p) => ({ ...p, adventure: a }));
      useFourWheeler3dStore.getState().resetSession();
      expect(useFourWheeler3dStore.getState().mode).toBe(
        type === "boat" ? "boat" : "aircraft",
      );
    },
  );
  it("does not subtract deck height from a just-relocated hull snapshot", () => {
    const a = createAdventureProgress();
    a.fleet.boat = {
      ...a.fleet["starter-atv"],
      id: "boat",
      type: "pontoon",
      position: { x: 20, y: 0, z: 20 },
    };
    a.activeVehicleId = "boat";
    const hull = { x: 20, y: 0, z: 20 };
    const s = {
      ...session(),
      playerSnapshot: { ...hull, heading: 0, speed: 0 },
      relocation: { position: hull },
    };
    expect(riderResume(a, "boat", s).position.y).toBe(0);
    s.playerSnapshot.y = transportTuning("pontoon").deckHeight;
    expect(riderResume(a, "boat", s).position.y).toBe(0);
  });
  it("invalidates activity caches before adopting a cloud save", () => {
    useAdventureSession.setState({
      interior: {
        id: "old-house",
        kind: "house",
        rooms: 1,
        returnPosition: snapshot,
      },
      mountId: "horse-1",
    });
    const generation = useActivitiesSession.getState().generation;
    useActivitiesSession.setState({
      nozzle: true,
      liveActivities: createAdventureProgress().activities,
    });
    useFourWheeler3dStore.getState().setProgress({
      ...defaultProgress,
      adventure: createAdventureProgress(),
    });
    expect(useActivitiesSession.getState().generation).toBe(generation + 1);
    expect(useActivitiesSession.getState().liveActivities).toBeNull();
    expect(useActivitiesSession.getState().nozzle).toBe(false);
    expect(useAdventureSession.getState().interior).toBeNull();
    expect(useAdventureSession.getState().mountId).toBeNull();
  });
  it("resumes a walking deck at the saved helm, without converting its height to the lake floor", () => {
    const a = createAdventureProgress();
    a.fleet.boat = {
      ...a.fleet["starter-atv"],
      id: "boat",
      type: "pontoon",
      position: { x: 20, y: 0, z: 20 },
      heading: 2,
    };
    a.activeVehicleId = "boat";
    const rider = riderResume(a, "deck", {
      ...session(),
      transport: { vehicleId: "boat" },
    });
    expect(rider).toEqual({
      mode: "boat",
      position: { x: 20, y: 0, z: 20 },
      heading: 2,
    });
  });
  it.each(["space", "planet"] as const)(
    "resumes %s beside the launch pad while preserving collected progress",
    (mode) => {
      const store = useFourWheeler3dStore.getState();
      store.updateProgress((p) => ({
        ...p,
        adventure: {
          ...p.adventure,
          space: {
            ...p.adventure.space,
            visited: ["mars"],
            gems: { mars: ["gem-1"] },
          },
        },
      }));
      store.setMode(mode);
      saveRiderPosition();
      const a = useFourWheeler3dStore.getState().progress.adventure;
      expect(a.rider?.mode).toBe("foot");
      expect(a.rider?.position.x).toBe(LANDMARKS.launchPad.x);
      expect(a.rider?.position.y).toBeLessThan(100);
      expect(a.space.gems.mars).toEqual(["gem-1"]);
    },
  );
});

describe("interior and commerce boundaries", () => {
  it("parks the exact live ATV pose before entering a house, then resumes outside on foot", () => {
    enterInterior("house", "house");
    const a = useFourWheeler3dStore.getState().progress.adventure;
    expect(a.fleet["starter-atv"].position).toEqual({
      x: snapshot.x,
      y: snapshot.y,
      z: snapshot.z,
    });
    expect(a.fleet["starter-atv"].parked).toBe(true);
    expect(a.rider?.mode).toBe("foot");
    expect(a.rider?.position.x).toBe(snapshot.x);
    leaveInterior();
    expect(useFourWheeler3dStore.getState().mode).toBe("foot");
    expect(useAdventureSession.getState().interior).toBeNull();
  });
  it("returns to the correct RV driver and persists that RV when entering on foot from another active ride", () => {
    const store = useFourWheeler3dStore.getState();
    store.updateProgress((p) => ({
      ...p,
      adventure: {
        ...p.adventure,
        fleet: {
          ...p.adventure.fleet,
          rv: {
            ...p.adventure.fleet["starter-atv"],
            id: "rv",
            type: "rv",
            position: { x: -425, y: 2, z: 10 },
          },
        },
      },
    }));
    store.setMode("foot");
    enterInterior("rv", "rv");
    const a = useFourWheeler3dStore.getState().progress.adventure;
    expect(a.activeVehicleId).toBe("rv");
    expect(savedRider(a).position.x).toBe(-425);
    expect(a.fleet["starter-atv"].position.x).not.toBe(-425);
    leaveInterior();
    expect(useFourWheeler3dStore.getState().mode).toBe("vehicle");
    expect(useAdventureSession.getState().relocation?.position.x).toBe(-425);
  });
  it("grounds paid indoor deliveries at the outside doorway", () => {
    const s = {
      ...session(),
      playerSnapshot: { ...snapshot, x: 0, y: 2000, z: 4 },
      interior: {
        id: "house",
        kind: "house",
        rooms: 1,
        returnPosition: snapshot,
      },
    };
    const origin = deliveryOrigin(s);
    expect(origin).toEqual({
      x: snapshot.x,
      y: Math.max(0, heightAt(snapshot.x, snapshot.z)) + 0.1,
      z: snapshot.z,
    });
    const p = {
      ...defaultProgress,
      money: 100000,
      adventure: createAdventureProgress(),
    };
    const ordered = orderDelivery(p, "anyStore:truck");
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    const granted = advanceDelivery({ ...p, ...ordered.patch }, 100, origin);
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    const grounded = groundDeliveredFleet(p.adventure, granted.patch.adventure);
    const truck = Object.values(grounded.fleet).find(
      (v) => v.type === "truck" && !p.adventure.fleet[v.id],
    )!;
    expect(truck.position.y).toBe(
      Math.max(0, heightAt(truck.position.x, truck.position.z)) + 0.1,
    );
    expect(truck.position.x).toBeLessThan(-390);
    expect(truck.position.y).toBeLessThan(100);
    expect(granted.patch.adventure.delivery).toBeNull();
  });
  it("rejects cargo swaps and walking swaps before any mutation", () => {
    const a = createAdventureProgress();
    a.fleet.other = { ...a.fleet["starter-atv"], id: "other" };
    a.fleet.trailer = {
      ...a.fleet["starter-atv"],
      id: "trailer",
      type: "trailer",
      cargo: ["other"],
    };
    const before = structuredClone(a);
    expect(canSwitchRide(a, "other", "vehicle", 0)).toBe(false);
    expect(a).toEqual(before);
    a.fleet.trailer.cargo = [];
    expect(canSwitchRide(a, "other", "foot", 0)).toBe(false);
    expect(canSwitchRide(a, "other", "vehicle", 0)).toBe(true);
    expect(canSwitchRide(a, "other", "vehicle", 2)).toBe(false);
  });
  it("exposes camper interiors only on foot beside an unloaded camper", () => {
    const a = createAdventureProgress();
    a.fleet.camper = {
      ...a.fleet["starter-atv"],
      id: "camper",
      type: "camper",
      position: snapshot,
    };
    expect(nearbyCamper(a, snapshot, "foot")?.id).toBe("camper");
    expect(nearbyCamper(a, snapshot, "vehicle")).toBeUndefined();
    expect(nearbyCamper(a, { ...snapshot, x: 200 }, "foot")).toBeUndefined();
  });
});

describe("strict persisted coordinates from rich runtime snapshots", () => {
  it.each([
    "vehicle",
    "foot",
    "stand",
    "deck",
    "boat",
    "aircraft",
    "train",
    "space",
    "planet",
    "mount",
    "parachute",
    "house",
    "camper",
    "rv",
    "yacht",
  ] as const)(
    "keeps the complete save valid and permits commerce from %s",
    (context) => {
      const a = createAdventureProgress(),
        s = session();
      const craft = a.fleet[a.activeVehicleId!];
      if (["boat", "deck", "yacht"].includes(context)) craft.type = "yacht";
      if (context === "aircraft") craft.type = "heli";
      if (context === "rv") craft.type = "rv";
      const interior = ["house", "camper", "rv", "yacht"].includes(context)
        ? {
            id: context === "rv" || context === "yacht" ? craft.id : "house",
            kind: context,
            rooms: 1,
            returnPosition: { ...snapshot },
          }
        : null;
      const mode = interior
        ? "interior"
        : (context as import("../lib/adventureSession").TravelMode);
      const rider = riderResume(a, mode, {
        ...s,
        interior,
        transport: context === "deck" ? { vehicleId: craft.id } : null,
      });
      expect(Object.keys(rider.position).sort()).toEqual(["x", "y", "z"]);
      const progress = {
        ...defaultProgress,
        money: 100000,
        adventure: { ...a, rider },
      };
      expect(adventureSchema.safeParse(progress.adventure).success).toBe(true);
      const order = orderDelivery(progress, "anyStore:atv");
      expect(order.ok).toBe(true);
      if (order.ok) {
        expect(order.patch.money).toBe(80000);
        expect(order.patch.adventure.delivery).not.toBeNull();
        expect(adventureSchema.safeParse(order.patch.adventure).success).toBe(
          true,
        );
      }
    },
  );
  it("orders successfully after actual on-foot house entry and still validates after leaving", () => {
    useFourWheeler3dStore.setState({ mode: "foot" });
    enterInterior("house", "house");
    expect(
      Object.keys(
        useAdventureSession.getState().interior!.returnPosition,
      ).sort(),
    ).toEqual(["x", "y", "z"]);
    const p = useFourWheeler3dStore.getState().progress;
    expect(adventureSchema.safeParse(p.adventure).success).toBe(true);
    const order = orderDelivery({ ...p, money: 100000 }, "anyStore:atv");
    expect(order.ok).toBe(true);
    leaveInterior();
    expect(
      adventureSchema.safeParse(
        useFourWheeler3dStore.getState().progress.adventure,
      ).success,
    ).toBe(true);
  });
});

describe("hunting placements from live telemetry", () => {
  it.each(["feeder", "stand-tree", "stand-ground"])(
    "persists %s without heading or speed in its position",
    (item) => {
      const adventure = createAdventureProgress();
      adventure.inventory[item] = 1;
      const rich = { x: 650, y: 3, z: 650, heading: Math.PI, speed: 0 };
      const result = applyHuntingItem(
        { ...defaultProgress, adventure },
        item,
        rich,
        "foot",
      );
      expect(result.ok).toBe(true);
      expect(adventureSchema.safeParse(result.progress.adventure).success).toBe(
        true,
      );
      expect(
        orderDelivery({ ...result.progress, money: 100000 }, "anyStore:atv").ok,
      ).toBe(true);
    },
  );
  it("persists buck skulls at exact xyz when selling a hunting haul", () => {
    const adventure = createAdventureProgress();
    adventure.heldKills.buck = 1;
    const result = sellHuntingKills(
      { ...defaultProgress, adventure },
      { ...snapshot },
    );
    expect(result.ok).toBe(true);
    expect(
      Object.keys(
        result.progress.adventure.hunting.looseSkulls[0].position,
      ).sort(),
    ).toEqual(["x", "y", "z"]);
    expect(adventureSchema.safeParse(result.progress.adventure).success).toBe(
      true,
    );
    expect(
      orderDelivery({ ...result.progress, money: 100000 }, "anyStore:atv").ok,
    ).toBe(true);
  });
});

describe("switching across a travel class", () => {
  it.each([
    ["atv", "truck", "vehicle"],
    ["truck", "rv", "vehicle"],
    ["boat", "pontoon", "boat"],
    ["pontoon", "jetski", "boat"],
    ["plane", "heli", "aircraft"],
    ["heli", "jet", "aircraft"],
  ] as const)(
    "allows %s to %s and boards the destination controller with its saved customization",
    (from, to, mode) => {
      const a = createAdventureProgress();
      a.aircraftOwned = true;
      a.fleet[a.activeVehicleId!].type = from;
      a.fleet.next = {
        ...a.fleet[a.activeVehicleId!],
        id: "next",
        type: to,
        paint: "#123456",
        speedUpgrade: 20,
        position: { x: snapshot.x, y: snapshot.y, z: snapshot.z },
      };
      expect(canSwitchRide(a, "next", mode, 0)).toBe(true);
      useFourWheeler3dStore.setState({
        mode,
        progress: { ...defaultProgress, adventure: a },
      });
      boardVehicle("next");
      const p = useFourWheeler3dStore.getState();
      expect(p.mode).toBe(mode);
      expect(p.progress.currentVehicle).toBe(to);
      expect(p.progress.adventure.activeVehicleId).toBe("next");
      expect(p.progress.adventure.fleet.next.paint).toBe("#123456");
      expect(p.progress.adventure.fleet.next.speedUpgrade).toBe(20);
      expect(adventureSchema.safeParse(p.progress.adventure).success).toBe(
        true,
      );
    },
  );
  it.each([
    ["atv", "boat", "vehicle"],
    ["boat", "heli", "boat"],
    ["plane", "truck", "aircraft"],
  ] as const)("rejects switching %s to another class %s", (from, to, mode) => {
    const a = createAdventureProgress();
    a.aircraftOwned = true;
    a.fleet[a.activeVehicleId!].type = from;
    a.fleet.next = { ...a.fleet[a.activeVehicleId!], id: "next", type: to };
    expect(canSwitchRide(a, "next", mode, 0)).toBe(false);
  });
  it("rejects trailers, locked aircraft and closed garage storage", () => {
    const a = createAdventureProgress();
    a.fleet.next = {
      ...a.fleet[a.activeVehicleId!],
      id: "next",
      type: "trailer",
    };
    expect(canSwitchRide(a, "next", "vehicle", 0)).toBe(false);
    a.fleet.next.type = "truck";
    a.plots["plot-1"].owned = true;
    a.plots["plot-1"].buildings = [
      { type: "garage", slot: 0, doorOpen: false, parkedVehicleIds: ["next"] },
    ];
    expect(canSwitchRide(a, "next", "vehicle", 0)).toBe(false);
    a.plots["plot-1"].buildings[0].doorOpen = true;
    expect(canSwitchRide(a, "next", "vehicle", 0)).toBe(true);
    a.fleet[a.activeVehicleId!].type = "plane";
    a.fleet.next.type = "heli";
    a.aircraftOwned = false;
    expect(canSwitchRide(a, "next", "aircraft", 0)).toBe(false);
  });
  it("keeps the final boarding range gate when an aircraft has not been brought to the player", () => {
    const a = createAdventureProgress();
    a.aircraftOwned = true;
    a.fleet[a.activeVehicleId!].type = "plane";
    a.fleet.next = {
      ...a.fleet[a.activeVehicleId!],
      id: "next",
      type: "heli",
      position: { x: 600, y: 5, z: 600 },
    };
    useFourWheeler3dStore.setState({
      mode: "aircraft",
      progress: { ...defaultProgress, adventure: a },
    });
    expect(canSwitchRide(a, "next", "aircraft", 0)).toBe(true);
    boardVehicle("next");
    expect(
      useFourWheeler3dStore.getState().progress.adventure.activeVehicleId,
    ).toBe(a.activeVehicleId);
  });
});
