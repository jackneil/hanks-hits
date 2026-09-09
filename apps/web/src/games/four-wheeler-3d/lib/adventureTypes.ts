import {
  HORSE_PEN,
  LANDMARKS,
  LAND_PLOTS,
  RUNWAY,
  TREESTANDS,
} from "./landmarks";
import {
  createActivitiesProgress,
  type ActivitiesProgress,
} from "./activities";

export type AdventurePosition = { x: number; y: number; z: number };
export type SavedRider = {
  mode: "vehicle" | "foot" | "boat" | "aircraft";
  position: AdventurePosition;
  heading: number;
};
export type FleetVehicle = {
  id: string;
  type: string;
  position: AdventurePosition;
  heading: number;
  paint: string;
  /** Purchased additional top speed, in displayed mph. */
  speedUpgrade: number;
  mud: number;
  cargo: string[];
  hitch: string | null;
  parked: boolean;
  purchasePrice: number;
  capacity: number;
  cornLoad: number;
};
export type PlotBuilding = {
  slot: 0 | 1;
  type: "garage" | "trophy" | "house-small" | "house-medium" | "house-huge";
  doorOpen: boolean;
  parkedVehicleIds: string[];
};
export type LandPlot = {
  id: string;
  owned: boolean;
  sizeLevel: number;
  buildings: PlotBuilding[];
};
export type Feeder = {
  id: string;
  position: AdventurePosition;
  label: string;
  corn: number;
  scented: boolean;
};
export type Stand = {
  id: string;
  position: AdventurePosition;
  type: "tree" | "ground";
};
export type Horse = {
  id: string;
  position: AdventurePosition;
  heading: number;
  color: string;
  saddle: string | null;
};
export type MilkBucket = {
  color: string;
  colorName: string;
  fill: number;
  uses: number;
};
export type Delivery = {
  id: string;
  offerId: string;
  /** Remaining real seconds, advanced by the running game, not wall time. */
  remainingSeconds: number;
};
export type HelperTask = {
  id: string;
  kind: "vehicle" | "feeders";
  offerId: string | null;
  remainingSeconds: number;
};

/** Serializable ownership and world state. Live physics objects stay outside saves. */
export type AdventureProgress = {
  rider: SavedRider | null;
  activities: ActivitiesProgress;
  version: 1;
  nextId: number;
  fleet: Record<string, FleetVehicle>;
  activeVehicleId: string | null;
  inventory: Record<string, number>;
  plots: Record<string, LandPlot>;
  dog: { hungerHours: number; alive: boolean };
  collectedBones: string[];
  feeders: Feeder[];
  stands: Stand[];
  heldKills: Record<string, number>;
  trophyCounts: Record<string, number>;
  collectedSkulls: number;
  outfit: { color: string; text: string };
  horses: Horse[];
  bucket: MilkBucket | null;
  hunting: {
    worldSeed: number;
    removedAnimalIds: string[];
    carcasses: {
      id: string;
      type: string;
      position: AdventurePosition;
      heading: number;
    }[];
    looseSkulls: { id: string; position: AdventurePosition }[];
    cornHours: number;
    camoOn: boolean;
    useBow: boolean;
    gruntUses: number;
    activeBait: string | null;
    rainbowBaitUses: number;
    carryingCorn: boolean;
  };
  aircraftOwned: boolean;
  trainOwned: boolean;
  rocketOwned: boolean;
  space: { visited: string[]; gems: Record<string, string[]> };
  delivery: Delivery | null;
  helperTask: HelperTask | null;
  fireWater: number;
  ladderRaised: boolean;
  garageDoorOpen: boolean;
};

/** New game starter fleet matches the original garage, dock and airfield. */
export function createAdventureProgress(): AdventureProgress {
  const fleet: Record<string, FleetVehicle> = {};
  const add = (
    id: string,
    type: string,
    x: number,
    z: number,
    price: number,
    capacity = 0,
  ) => {
    fleet[id] = {
      id,
      type,
      position: { x, y: 0, z },
      heading: 0,
      paint: "#e63946",
      speedUpgrade: 0,
      mud: 0,
      cargo: [],
      hitch: null,
      parked: id !== "starter-atv",
      purchasePrice: price,
      capacity,
      cornLoad: 0,
    };
  };
  add("starter-atv", "atv", LANDMARKS.garage.x, LANDMARKS.garage.z + 14, 20000);
  ["utv", "truck", "moto", "lambo", "truck", "lambo", "utv"].forEach(
    (type, i) =>
      add(
        `starter-${type}-${i}`,
        type,
        LANDMARKS.garage.x - 14 + i * 5.55,
        LANDMARKS.garage.z - 1,
        type === "lambo" ? 50000 : 20000,
      ),
  );
  add(
    "starter-boat",
    "boat",
    LANDMARKS.dockWater.x,
    LANDMARKS.dockWater.z,
    5000,
  );
  add("starter-plane", "plane", RUNWAY.x, RUNWAY.z, 60000);
  add("starter-heli", "heli", LANDMARKS.helipad.x, LANDMARKS.helipad.z, 80000);
  add("starter-trailer", "trailer", LANDMARKS.garage.x - 16, 9, 5000, 1);
  add(
    "starter-boattrailer",
    "boattrailer",
    LANDMARKS.garage.x + 16,
    9,
    5000,
    1,
  );
  return {
    rider: null,
    version: 1,
    nextId: 1,
    fleet,
    activeVehicleId: "starter-atv",
    inventory: { rifle: 1 },
    plots: Object.fromEntries(
      LAND_PLOTS.map((p) => [
        p.id,
        { id: p.id, owned: false, sizeLevel: 0, buildings: [] },
      ]),
    ),
    dog: { hungerHours: 0, alive: true },
    collectedBones: [],
    feeders: TREESTANDS.map((p, i) => ({
      id: `feeder-${i + 1}`,
      position: { x: p.x + 80 / 18, y: 0, z: p.z - 20 / 18 },
      label: `Feeder ${i + 1}`,
      corn: 18,
      scented: false,
    })),
    stands: TREESTANDS.map((p, i) => ({
      id: `stand-${i + 1}`,
      position: { ...p, y: 0 },
      type: "tree",
    })),
    heldKills: {},
    trophyCounts: {},
    collectedSkulls: 0,
    outfit: { color: "#d3c6a3", text: "HANK" },
    horses: ["#966342", "#292522", "#eee0c7", "#c9a36c", "#a24c32"].map(
      (color, i) => ({
        id: `horse-${i + 1}`,
        position: {
          x: HORSE_PEN.x - 5 + (i % 3) * 5,
          y: 0,
          z: HORSE_PEN.z - 3 + Math.floor(i / 3) * 5,
        },
        heading: 0,
        color,
        saddle: null,
      }),
    ),
    bucket: null,
    activities: createActivitiesProgress(),
    hunting: {
      worldSeed: 1987,
      removedAnimalIds: [],
      carcasses: [],
      looseSkulls: [],
      cornHours: 0,
      camoOn: false,
      useBow: false,
      gruntUses: 0,
      activeBait: null,
      rainbowBaitUses: 0,
      carryingCorn: false,
    },
    aircraftOwned: false,
    trainOwned: false,
    rocketOwned: false,
    space: { visited: [], gems: {} },
    delivery: null,
    helperTask: null,
    fireWater: 100,
    ladderRaised: false,
    garageDoorOpen: false,
  };
}
