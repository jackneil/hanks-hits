import { create } from "zustand";
import { surfaceFactorAt, type ActivitiesProgress } from "./activities";
import type { AdventureProgress, AdventurePosition } from "./adventureTypes";
export type ActivityImpulse = { x: number; y: number; z: number };
export const useActivitiesSession = create<{
  generation: number;
  nozzle: boolean;
  spraying: boolean;
  swingRemaining: number;
  swingId: string | null;
  sprayBurst: number;
  liveActivities: ActivitiesProgress | null;
  debris: { id: string; x: number; y: number; z: number; kind: string }[];
  impulse: ActivityImpulse | null;
}>()(() => ({
  generation: 0,
  nozzle: false,
  spraying: false,
  swingRemaining: 0,
  swingId: null,
  sprayBurst: 0,
  liveActivities: null,
  debris: [],
  impulse: null,
}));
export function takeActivityImpulse() {
  const v = useActivitiesSession.getState().impulse;
  if (v) useActivitiesSession.setState({ impulse: null });
  return v;
}
export function activityMovementLocked() {
  return useActivitiesSession.getState().swingRemaining > 0;
}
/** Mutable transient transforms, rendered each frame; persisted fleet snapshots update every five seconds. */
export const trailerTransforms = new Map<
  string,
  { position: AdventurePosition; heading: number }
>();
export function resetActivitiesSession() {
  useActivitiesSession.setState((s) => ({
    generation: s.generation + 1,
    nozzle: false,
    spraying: false,
    swingRemaining: 0,
    swingId: null,
    sprayBurst: 0,
    liveActivities: null,
    debris: [],
    impulse: null,
  }));
  trailerTransforms.clear();
}

export function activitySurfaceFactorAt(
  x: number,
  z: number,
  progress: AdventureProgress,
  snow = 0,
) {
  const live = useActivitiesSession.getState().liveActivities;
  return surfaceFactorAt(
    x,
    z,
    live ? { ...progress, activities: live } : progress,
    snow,
  );
}
