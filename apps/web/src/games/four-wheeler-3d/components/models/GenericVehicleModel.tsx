"use client";
import type { VehicleModelProps } from "./AtvModel";
import { LandVehicleModel } from "./LandVehicleModel";
export function GenericVehicleModel(props: VehicleModelProps) {
  return <LandVehicleModel id={props.tuning.id} {...props} />;
}
export default GenericVehicleModel;
