import { isAirVehicle, isWaterVehicle } from "./catalog";
import { transportTuning } from "./transport";
import { mphFromMs, tuningFor } from "./vehicles";
/** The stock speed actually used by the controller, shared by store and preview. */
export const displaySpeedMph = (type: string) =>
  Math.round(
    mphFromMs(
      (isAirVehicle(type) || isWaterVehicle(type)
        ? transportTuning(type)
        : tuningFor(type)
      ).maxSpeed,
    ),
  );
