import type { RapierContext, RapierRigidBody } from "@react-three/rapier";
import type { ControlValues } from "./controls";
import type { VehicleTuning } from "./vehicles";

export type VehicleController = ReturnType<
  RapierContext["world"]["createVehicleController"]
>;
export type DrivingState = { steerAngle: number; engine: number };

/** The engine sits low in the frame; keep full rotational freedom and box inertia. */
export function chassisMassProperties(tuning: VehicleTuning) {
  const {
    mass,
    chassis: { width, height, length },
  } = tuning;
  return {
    mass,
    centerOfMass: { x: 0, y: -height * 0.35, z: 0 },
    principalAngularInertia: {
      x: (mass * (height * height + length * length)) / 12,
      y: (mass * (width * width + length * length)) / 12,
      z: (mass * (width * width + height * height)) / 12,
    },
    angularInertiaLocalFrame: { x: 0, y: 0, z: 0, w: 1 },
  };
}

/** Set the axes explicitly: Rapier's default forward axis is X, ours is +Z. */
export function configureVehicle(
  vehicle: VehicleController,
  tuning: VehicleTuning,
) {
  vehicle.indexUpAxis = 1;
  vehicle.setIndexForwardAxis = 2;
  for (const [x, y, z] of tuning.wheelPositions) {
    vehicle.addWheel(
      { x, y, z },
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      tuning.suspension.restLength,
      tuning.wheelRadius,
    );
  }
  for (let i = 0; i < 4; i++) {
    vehicle.setWheelSuspensionStiffness(i, tuning.suspension.stiffness);
    vehicle.setWheelSuspensionCompression(i, tuning.suspension.compression);
    vehicle.setWheelSuspensionRelaxation(i, tuning.suspension.relaxation);
    vehicle.setWheelMaxSuspensionTravel(i, tuning.suspension.maxTravel);
    vehicle.setWheelFrictionSlip(i, tuning.frictionSlip);
    vehicle.setWheelSideFrictionStiffness(i, tuning.sideFrictionStiffness);
  }
}

/** Preserve parking-lot turns while limiting the lateral acceleration requested at speed. */
export function steeringTarget(
  input: number,
  speed: number,
  tuning: VehicleTuning,
) {
  const wheelbase = tuning.wheelPositions[0][2] - tuning.wheelPositions[2][2];
  const angle = Math.min(
    tuning.maxSteer,
    Math.atan2(7 * wheelbase, speed * speed),
  );
  // Looking along +Z with +Y up, the rider's right is -X (negative yaw).
  return -Math.max(-1, Math.min(1, input)) * angle;
}

/** Shared by the live vehicle and real Rapier regression tests. Forces are per wheel. */
export function applyDriving(
  vehicle: VehicleController,
  tuning: VehicleTuning,
  controls: ControlValues,
  state: DrivingState,
  dt: number,
  { boost = 1, surfaceFactor = 1, icy = false } = {},
) {
  const speed = vehicle.currentVehicleSpeed();
  const target = steeringTarget(controls.steer, speed, tuning);
  state.steerAngle += (target - state.steerAngle) * (1 - Math.exp(-6 * dt));
  vehicle.setWheelSteering(0, state.steerAngle);
  vehicle.setWheelSteering(1, state.steerAngle);

  state.engine = 0;
  if (controls.throttle > 0 && speed < tuning.maxSpeed * boost) {
    state.engine =
      controls.throttle * tuning.engineForce * boost * surfaceFactor;
  } else if (
    controls.throttle < 0 &&
    speed > -tuning.maxSpeed * tuning.reverseFactor
  ) {
    state.engine =
      controls.throttle *
      tuning.engineForce *
      tuning.reverseFactor *
      surfaceFactor;
  }
  for (let i = 0; i < 4; i++) {
    const rearHandbrake = i >= 2 && controls.handbrake;
    vehicle.setWheelEngineForce(i, state.engine);
    // Rapier expects a maximum braking IMPULSE, not a force in newtons.
    vehicle.setWheelBrake(
      i,
      tuning.brakeForce * dt * (controls.brake + (rearHandbrake ? 1.4 : 0)),
    );
    vehicle.setWheelFrictionSlip(i, tuning.frictionSlip * (icy ? 0.4 : 1));
    vehicle.setWheelSideFrictionStiffness(
      i,
      tuning.sideFrictionStiffness *
        (icy ? 0.4 : 1) *
        (rearHandbrake ? 0.35 : 1),
    );
  }
}

/** Keep the projected forward heading and give the suspension clearance to settle. */
export function recoverVehicle(chassis: RapierRigidBody, groundHeight: number) {
  const q = chassis.rotation();
  const yaw = Math.atan2(
    2 * (q.w * q.y + q.x * q.z),
    1 - 2 * (q.x * q.x + q.y * q.y),
  );
  chassis.setRotation(
    { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
    true,
  );
  const p = chassis.translation();
  chassis.setTranslation(
    { x: p.x, y: Math.max(p.y, groundHeight) + 1, z: p.z },
    true,
  );
  chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
  chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
