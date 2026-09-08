/**
 * Which body to draw for a vehicle id.
 *
 * The quad has its own model, because it is the one the game starts on. Every
 * other id draws the shared truck body sized from its tuning row until
 * milestone 6 gives it a model of its own. The choice is made inside a real
 * component, so React always sees the same component types.
 */

import { AtvModel, type VehicleModelProps } from "./AtvModel";
import { GenericVehicleModel } from "./GenericVehicleModel";

export type { VehicleModelProps };
export { AtvModel, GenericVehicleModel };

export type VehicleModelSwitchProps = VehicleModelProps & {
  id: string;
};

export function VehicleModel({ id, tuning, paint }: VehicleModelSwitchProps) {
  if (id === "atv") return <AtvModel tuning={tuning} paint={paint} />;
  return <GenericVehicleModel tuning={tuning} paint={paint} />;
}

export default VehicleModel;
