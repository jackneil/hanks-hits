"use client";
import { AtvModel, type VehicleModelProps } from "./AtvModel";
import { LandVehicleModel } from "./LandVehicleModel";
export { GenericVehicleModel } from "./GenericVehicleModel";
export type { VehicleModelProps };
export { AtvModel, LandVehicleModel };
export type VehicleModelSwitchProps = VehicleModelProps & { id: string };
export function VehicleModel({ id, ...props }: VehicleModelSwitchProps) {
  if (id === "atv") return <AtvModel {...props} />;
  if (id === "foot") return null;
  return <LandVehicleModel id={id} {...props} />;
}
export default VehicleModel;
