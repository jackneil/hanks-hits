import { create } from "zustand";
import type { AdventurePosition } from "./adventureTypes";
import type { FishingSession } from "./fishing";
import type { RaceSession } from "./race";
import type { RailSession } from "./rail";
import type { SpaceSession } from "./space";

export type WorldPanel =
  | "phone"
  | "map"
  | "shop"
  | "garage"
  | "inventory"
  | "land"
  | "home"
  | "race"
  | "fishing"
  | "train"
  | "space"
  | "help"
  | "settings"
  | "trophies"
  | "activities"
  | "ride"
  | "sell"
  | null;
export type TravelMode =
  | "vehicle"
  | "foot"
  | "stand"
  | "deck"
  | "boat"
  | "aircraft"
  | "train"
  | "space"
  | "planet"
  | "mount"
  | "interior"
  | "parachute";
export type Waypoint = { id: string; label: string; x: number; z: number };
export type Interaction = {
  id: string;
  label: string;
  icon: string;
  kind: string;
  distance: number;
  ready: boolean;
};
export type InteriorState = {
  id: string;
  kind: string;
  returnPosition: AdventurePosition;
  rooms: number;
};

let nextRelocationId = 0;
let nextActionId = 0;

/** UI and world transitions are session state; ownership lives in the persisted game store. */
export const useAdventureSession = create<{
  generation: number;
  panel: WorldPanel;
  panelId: string | null;
  phoneApp: string | null;
  waypoint: Waypoint | null;
  interaction: Interaction | null;
  interior: InteriorState | null;
  mountId: string | null;
  standId: string | null;
  scope: boolean;
  cameraPreset: number;
  lightsOn: boolean;
  dogTarget: AdventurePosition | null;
  dogPosition: AdventurePosition | null;
  transport: {
    vehicleId: string;
    speed: number;
    altitude: number;
    netDeployed: boolean;
    anchorDown: boolean;
    lightsOn: boolean;
    canopyOpen: boolean;
  } | null;
  fishing: FishingSession | null;
  race: RaceSession | null;
  milking: { progress: number; origin: AdventurePosition } | null;
  rail: RailSession | null;
  spaceflight: SpaceSession | null;
  captureView: (() => string) | null;
  relocation: {
    id: number;
    position: AdventurePosition;
    heading: number;
  } | null;
  appliedFootRelocationId: number;
  playerSnapshot: AdventurePosition & { heading: number; speed: number };
  action: { id: number; name: string; payload?: string } | null;
  openPanel: (panel: WorldPanel, id?: string) => void;
  setPhoneApp: (app: string | null) => void;
  setWaypoint: (point: Waypoint | null) => void;
  setInteraction: (interaction: Interaction | null) => void;
  relocate: (position: AdventurePosition, heading?: number) => void;
  requestAction: (name: string, payload?: string) => void;
  reset: () => void;
}>((set) => ({
  generation: 0,
  panel: null,
  panelId: null,
  phoneApp: null,
  waypoint: null,
  interaction: null,
  captureView: null,
  interior: null,
  mountId: null,
  standId: null,
  scope: false,
  lightsOn: true,
  cameraPreset: 4,
  dogTarget: null,
  dogPosition: null,
  relocation: null,
  appliedFootRelocationId: 0,
  transport: null,
  fishing: null,
  race: null,
  milking: null,
  rail: null,
  spaceflight: null,
  playerSnapshot: { x: -400, y: 3, z: 12, heading: 0, speed: 0 },
  action: null,
  openPanel: (panel, id) =>
    set({
      panel,
      panelId: id ?? null,
      phoneApp: null,
      ...(panel ? { scope: false } : {}),
    }),
  setPhoneApp: (phoneApp) => set({ phoneApp }),
  setWaypoint: (waypoint) => set({ waypoint, panel: null, phoneApp: null }),
  setInteraction: (interaction) => set({ interaction }),
  relocate: (position, heading = 0) =>
    set(() => ({
      relocation: {
        id: ++nextRelocationId,
        position: { x: position.x, y: position.y, z: position.z },
        heading,
      },
      playerSnapshot: {
        x: position.x,
        y: position.y,
        z: position.z,
        heading,
        speed: 0,
      },
    })),
  requestAction: (name, payload) =>
    set({ action: { id: ++nextActionId, name, payload } }),
  reset: () =>
    set((s) => ({
      generation: s.generation + 1,
      panel: null,
      panelId: null,
      phoneApp: null,
      waypoint: null,
      interaction: null,
      interior: null,
      mountId: null,
      standId: null,
      scope: false,
      lightsOn: true,
      cameraPreset: 4,
      relocation: null,
      appliedFootRelocationId: 0,
      action: null,
      dogTarget: null,
      dogPosition: null,
      transport: null,
      fishing: null,
      race: null,
      milking: null,
      rail: null,
      spaceflight: null,
    })),
}));
