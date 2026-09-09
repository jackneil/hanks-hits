import type { AdventureProgress, AdventurePosition } from "./adventureTypes";
import type { InteriorState, TravelMode } from "./adventureSession";
import { isAirVehicle, isWaterVehicle, isLandVehicle } from "./catalog";
import { canBoardFleetVehicle } from "./economy";
import { canBoardPropertyVehicle } from "./property";
import { heightAt } from "./terrain";
import { LANDMARKS } from "./landmarks";
import { transportTuning } from "./transport";

type Snapshot = AdventurePosition & { heading: number; speed: number };
type ResumeSession = {
  playerSnapshot: Snapshot;
  interior: InteriorState | null;
  transport: { vehicleId: string } | null;
  relocation?: {
    id?: number;
    position: AdventurePosition;
    heading?: number;
  } | null;
  appliedFootRelocationId?: number;
};
export function usesFootController(mode: TravelMode) {
  return ["foot", "mount", "stand", "deck", "interior", "parachute"].includes(
    mode,
  );
}
/** A requested feet pose stays authoritative until Player publishes its applied physics pose. */
export function pendingFootRelocation(
  mode: TravelMode,
  s: Pick<ResumeSession, "relocation" | "appliedFootRelocationId">,
) {
  return usesFootController(mode) &&
    s.appliedFootRelocationId !== undefined &&
    s.relocation?.id !== undefined &&
    s.relocation.id !== s.appliedFootRelocationId
    ? s.relocation
    : null;
}
export const positionXYZ = (p: AdventurePosition): AdventurePosition => ({
  x: p.x,
  y: p.y,
  z: p.z,
});
const onGround = (p: AdventurePosition): AdventurePosition => ({
  x: p.x,
  y: Math.max(0, heightAt(p.x, p.z)) + 0.1,
  z: p.z,
});
/** Transient activities resume in a stable outdoor controller after reload. */
export function riderResume(
  a: AdventureProgress,
  mode: TravelMode,
  s: ResumeSession,
) {
  const craft = a.fleet[a.activeVehicleId ?? ""];
  if (mode === "space" || mode === "planet")
    return {
      mode: "foot" as const,
      position: onGround({
        ...LANDMARKS.launchPad,
        z: LANDMARKS.launchPad.z + 8,
        y: 0,
      }),
      heading: 0,
    };
  const cabin =
    s.interior && (s.interior.kind === "yacht" || s.interior.kind === "rv")
      ? a.fleet[s.interior.id]
      : null;
  const deck =
    mode === "deck"
      ? a.fleet[s.transport?.vehicleId ?? a.activeVehicleId ?? ""]
      : null;
  const parked = cabin ?? deck;
  if (parked)
    return {
      mode: isWaterVehicle(parked.type)
        ? ("boat" as const)
        : ("vehicle" as const),
      position: positionXYZ(parked.position),
      heading: parked.heading,
    };
  // Controller relocation targets the hull, while normal boat snapshots are feet on deck.
  const atHullRelocation =
    mode === "boat" &&
    s.playerSnapshot.speed === 0 &&
    s.relocation &&
    Math.hypot(
      s.playerSnapshot.x - s.relocation.position.x,
      s.playerSnapshot.y - s.relocation.position.y,
      s.playerSnapshot.z - s.relocation.position.z,
    ) < 0.000001;
  if (craft && ["vehicle", "boat", "aircraft"].includes(mode) && !s.interior)
    return {
      mode: isWaterVehicle(craft.type)
        ? ("boat" as const)
        : isAirVehicle(craft.type)
          ? ("aircraft" as const)
          : ("vehicle" as const),
      position: {
        x: s.playerSnapshot.x,
        y:
          s.playerSnapshot.y -
          (mode === "boat" && !atHullRelocation
            ? transportTuning(craft.type).deckHeight
            : 0),
        z: s.playerSnapshot.z,
      },
      heading: s.playerSnapshot.heading,
    };
  const pending = pendingFootRelocation(mode, s);
  return {
    mode: "foot" as const,
    position: onGround(
      s.interior?.returnPosition ?? pending?.position ?? s.playerSnapshot,
    ),
    heading: pending?.heading ?? s.playerSnapshot.heading,
  };
}
/** A delivery is always placed in the outdoor world, even when ordered inside. */
export function deliveryOrigin(
  s: Pick<ResumeSession, "playerSnapshot" | "interior">,
): AdventurePosition {
  return onGround(s.interior?.returnPosition ?? s.playerSnapshot);
}
/** Ground the actual delivery offset, which may be on a slope beside the doorway. */
export function groundDeliveredFleet(
  previous: AdventureProgress,
  next: AdventureProgress,
): AdventureProgress {
  const fresh = Object.values(next.fleet).filter((v) => !previous.fleet[v.id]);
  if (!fresh.length) return next;
  const fleet = { ...next.fleet };
  for (const v of fresh)
    fleet[v.id] = {
      ...v,
      position: isWaterVehicle(v.type)
        ? { x: v.position.x, y: 0, z: v.position.z }
        : onGround(v.position),
    };
  return { ...next, fleet };
}
export function rideClass(
  type: string,
): "vehicle" | "boat" | "aircraft" | null {
  return isWaterVehicle(type)
    ? "boat"
    : isAirVehicle(type)
      ? "aircraft"
      : isLandVehicle(type)
        ? "vehicle"
        : null;
}
export function canSwitchRide(
  a: AdventureProgress,
  id: string,
  mode: TravelMode,
  speed: number,
): boolean {
  const current = a.fleet[a.activeVehicleId ?? ""],
    target = a.fleet[id];
  return (
    !!current &&
    !!target &&
    current.id !== target.id &&
    rideClass(current.type) === mode &&
    rideClass(target.type) === mode &&
    Math.abs(speed) < 1 &&
    canBoardFleetVehicle(a, id) &&
    canBoardPropertyVehicle(a, id)
  );
}
export function nearbyCamper(
  a: AdventureProgress,
  p: AdventurePosition,
  mode: TravelMode,
) {
  if (mode !== "foot") return undefined;
  return Object.values(a.fleet)
    .filter(
      (v) =>
        (v.type === "camper" || v.type === "rv") &&
        canBoardPropertyVehicle(a, v.id) &&
        Math.hypot(v.position.x - p.x, v.position.z - p.z) < 8.4 &&
        !Object.values(a.fleet).some((parent) => parent.cargo.includes(v.id)),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.position.x - p.x, a.position.z - p.z) -
        Math.hypot(b.position.x - p.x, b.position.z - p.z),
    )[0];
}
