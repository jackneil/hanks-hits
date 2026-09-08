"use client";

/**
 * The ride: a Rapier raycast vehicle with four wheels.
 *
 * The chassis is one dynamic body. Four rays hang below it and act like
 * springs with wheels on the end, which is how driving games get a vehicle
 * that leans, grips and lands without ever tipping into a tumble the way a
 * stack of boxes would.
 *
 * Nothing in the frame loop allocates. Every vector and quaternion it needs is
 * made once at the top of this file.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import { heightAt, surfaceAt } from "../lib/terrain";
import { attachDevHandle } from "../lib/devParams";
import { tuningFor, type VehicleId } from "../lib/vehicles";
import type { ControlValues, OneShot } from "../lib/controls";
import { sounds } from "../lib/sounds";
import { VehicleModel } from "./models";
import { WheelModel } from "./models/WheelModel";

/**
 * The Rapier raycast vehicle controller.
 *
 * The type is read back off the world instead of imported, because
 * `@dimforge/rapier3d-compat` is a dependency of `@react-three/rapier` rather
 * than one of ours, and this game adds no packages.
 */
type VehicleController = ReturnType<
  ReturnType<typeof useRapier>["world"]["createVehicleController"]
>;

/** How long between jumps, in seconds. */
const JUMP_COOLDOWN = 0.6;

/** How hard the jump pushes, as a multiple of the vehicle mass. */
const JUMP_IMPULSE_PER_KG = 5.5;

/** How long upside down before the game rights the vehicle, in seconds. */
const FLIP_SECONDS = 1.5;

/** Grass is loose, so it gives a little less push than a dirt road. */
const GRASS_ENGINE_FACTOR = 0.85;

/** Snow this deep makes the ground slippery. */
const ICE_SNOW_LEVEL = 0.25;
const ICE_FRICTION_FACTOR = 0.4;
const ICE_SIDE_FRICTION = 0.4;

/** How fast the front wheels turn toward the steering input. */
const STEER_RATE = 4;

/** The boost doubles the push and the top speed. */
const NOS_MULTIPLIER = 2;

// Scratch values. Made once, reused every frame.
const scratchQuat = new THREE.Quaternion();
const scratchUp = new THREE.Vector3();
const scratchForward = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const impulse = { x: 0, y: 0, z: 0 };
const zeroVector = { x: 0, y: 0, z: 0 };
const uprightRotation = { x: 0, y: 0, z: 0, w: 1 };
const wheelDirection = { x: 0, y: -1, z: 0 };
const wheelAxle = { x: -1, y: 0, z: 0 };
const wheelConnection = { x: 0, y: 0, z: 0 };

export type VehicleProps = {
  id: VehicleId;
  spawn: readonly [number, number, number];
  /** Read once per physics step. */
  getControls: () => ControlValues;
  /** Read one waiting one-shot press and take it away. */
  takeOneShot: (action: OneShot) => boolean;
  bodyRef?: React.RefObject<RapierRigidBody | null>;
  /** Called every frame with the speed in meters per second. */
  onSpeed?: (metersPerSecond: number) => void;
  /** Called on landing with how long the vehicle was in the air. */
  onAir?: (seconds: number) => void;
};

export function Vehicle({
  id,
  spawn,
  getControls,
  takeOneShot,
  bodyRef,
  onSpeed,
  onAir,
}: VehicleProps) {
  const tuning = tuningFor(id);
  const { world } = useRapier();
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();

  const paint = useFourWheeler3dStore((state) => state.progress.paint);

  const localBody = useRef<RapierRigidBody | null>(null);
  const body = bodyRef ?? localBody;
  const controller = useRef<VehicleController | null>(null);
  const wheels = useRef<(THREE.Group | null)[]>([null, null, null, null]);

  // Everything the frame loop remembers between steps.
  const steerAngle = useRef(0);
  const wheelSpin = useRef(0);
  const jumpCooldown = useRef(0);
  const upsideDownFor = useRef(0);
  const airborneFor = useRef(0);
  const icy = useRef(false);

  // What the browser test handle reads back. Written by the physics step.
  const readout = useRef({ wheels: 0, engine: 0, upDot: 1, lastAirtime: 0 });

  // Build the vehicle controller once the chassis body exists.
  useEffect(() => {
    const chassis = body.current;
    if (!chassis) return;

    const vehicle = world.createVehicleController(chassis);
    for (const [x, y, z] of tuning.wheelPositions) {
      wheelConnection.x = x;
      wheelConnection.y = y;
      wheelConnection.z = z;
      vehicle.addWheel(
        wheelConnection,
        wheelDirection,
        wheelAxle,
        tuning.suspension.restLength,
        tuning.wheelRadius
      );
    }

    for (let i = 0; i < 4; i += 1) {
      vehicle.setWheelSuspensionStiffness(i, tuning.suspension.stiffness);
      vehicle.setWheelSuspensionCompression(i, tuning.suspension.compression);
      vehicle.setWheelSuspensionRelaxation(i, tuning.suspension.relaxation);
      vehicle.setWheelMaxSuspensionTravel(i, tuning.suspension.maxTravel);
      vehicle.setWheelFrictionSlip(i, tuning.frictionSlip);
      vehicle.setWheelSideFrictionStiffness(i, tuning.sideFrictionStiffness);
    }

    controller.current = vehicle;

    // React mounts twice in development. Tearing the controller down here
    // means the second mount builds a fresh one instead of a second one.
    return () => {
      controller.current = null;
      world.removeVehicleController(vehicle);
    };
  }, [world, tuning, body]);

  /** Put the vehicle back on its wheels, keeping the way it was facing. */
  const recover = useRef(() => {
    const chassis = body.current;
    if (!chassis) return;
    const rotation = chassis.rotation();
    scratchQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    // Keep the heading, drop the roll and the pitch.
    const yaw = Math.atan2(
      2 * (scratchQuat.w * scratchQuat.y + scratchQuat.x * scratchQuat.z),
      1 - 2 * (scratchQuat.y * scratchQuat.y + scratchQuat.z * scratchQuat.z)
    );
    uprightRotation.x = 0;
    uprightRotation.y = Math.sin(yaw / 2);
    uprightRotation.z = 0;
    uprightRotation.w = Math.cos(yaw / 2);
    chassis.setRotation(uprightRotation, true);

    const position = chassis.translation();
    impulse.x = position.x;
    impulse.y = position.y + 1;
    impulse.z = position.z;
    chassis.setTranslation(impulse, true);
    chassis.setLinvel(zeroVector, true);
    chassis.setAngvel(zeroVector, true);

    upsideDownFor.current = 0;
    useFourWheeler3dStore.getState().setHint("🔄 Flipped back over!");
  });

  // The browser test handle. Development builds only: see lib/devParams.ts.
  useEffect(() => {
    return attachDevHandle({
      pos: () => {
        const p = body.current?.translation() ?? { x: 0, y: 0, z: 0 };
        return [p.x, p.y, p.z];
      },
      speed: () => controller.current?.currentVehicleSpeed() ?? 0,
      mph: () => (controller.current?.currentVehicleSpeed() ?? 0) * 2.237,
      airtime: () => readout.current.lastAirtime,
      upDot: () => readout.current.upDot,
      wheels: () => readout.current.wheels,
      engine: () => readout.current.engine,
      helmetCam: () =>
        useFourWheeler3dStore.getState().progress.settings.helmetCam,
      flip: () => {
        const chassis = body.current;
        if (!chassis) return;
        impulse.x = tuning.mass * 4;
        impulse.y = 0;
        impulse.z = 0;
        chassis.applyTorqueImpulse(impulse, true);
      },
      teleport: (x: number, z: number) => {
        const chassis = body.current;
        if (!chassis) return;
        impulse.x = x;
        impulse.y = heightAt(x, z) + 2;
        impulse.z = z;
        chassis.setTranslation(impulse, true);
        chassis.setLinvel(zeroVector, true);
        chassis.setAngvel(zeroVector, true);
      },
    });
  }, [body, tuning]);

  useBeforePhysicsStep(() => {
    const vehicle = controller.current;
    const chassis = body.current;
    if (!vehicle || !chassis) return;

    // The step the world is about to take. Reading it rather than assuming
    // 1/60 keeps the engine force right whatever the Physics timeStep is set
    // to, including "vary".
    const dt = world.timestep;
    const controls = getControls();
    const store = useFourWheeler3dStore.getState();

    // The boost, from the 2D game: three seconds of double push.
    if (takeOneShot("nos")) store.startNos();
    const boosting = store.nosUntil > Date.now();
    const boost = boosting ? NOS_MULTIPLIER : 1;

    // Steering eases toward the input so a tap does not snap the wheels over.
    const target = controls.steer * tuning.maxSteer;
    steerAngle.current +=
      (target - steerAngle.current) * Math.min(1, STEER_RATE * dt);
    vehicle.setWheelSteering(0, steerAngle.current);
    vehicle.setWheelSteering(1, steerAngle.current);

    const speed = vehicle.currentVehicleSpeed();
    const absSpeed = Math.abs(speed);

    // What is under the wheels right now.
    const position = chassis.translation();
    const surface = surfaceAt(position.x, position.z);
    const surfaceFactor = surface === "grass" ? GRASS_ENGINE_FACTOR : 1;

    // Deep snow turns the world into an ice rink, the same as the 2D game.
    const shouldBeIcy = store.snowLevel > ICE_SNOW_LEVEL;
    if (shouldBeIcy !== icy.current) {
      icy.current = shouldBeIcy;
      for (let i = 0; i < 4; i += 1) {
        vehicle.setWheelFrictionSlip(
          i,
          shouldBeIcy
            ? tuning.frictionSlip * ICE_FRICTION_FACTOR
            : tuning.frictionSlip
        );
        vehicle.setWheelSideFrictionStiffness(
          i,
          shouldBeIcy ? ICE_SIDE_FRICTION : tuning.sideFrictionStiffness
        );
      }
    }

    // Engine and brakes.
    const maxSpeed = tuning.maxSpeed * boost;
    const reverseMax = tuning.maxSpeed * tuning.reverseFactor;
    let engine = 0;
    if (controls.throttle > 0 && speed < maxSpeed) {
      engine = controls.throttle * tuning.engineForce * boost * surfaceFactor;
    } else if (controls.throttle < 0 && speed > -reverseMax) {
      engine =
        controls.throttle *
        tuning.engineForce *
        tuning.reverseFactor *
        surfaceFactor;
    }

    const braking = controls.brake > 0 ? tuning.brakeForce : 0;
    const handbrake = controls.handbrake ? tuning.brakeForce * 1.4 : 0;

    for (let i = 0; i < 4; i += 1) {
      vehicle.setWheelEngineForce(i, engine);
      // The handbrake locks the back wheels only, which is how you slide.
      vehicle.setWheelBrake(i, braking + (i >= 2 ? handbrake : 0));
    }

    // How many wheels are on the ground, which the jump and the dust need.
    let grounded = 0;
    for (let i = 0; i < 4; i += 1) {
      if (vehicle.wheelIsInContact(i)) grounded += 1;
    }
    readout.current.wheels = grounded;
    readout.current.engine = engine;

    // The jump: a push straight up plus a little forward, on all four wheels.
    jumpCooldown.current = Math.max(0, jumpCooldown.current - dt);
    if (takeOneShot("jump") && grounded === 4 && jumpCooldown.current === 0) {
      const rotation = chassis.rotation();
      scratchQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
      scratchForward.copy(LOCAL_FORWARD).applyQuaternion(scratchQuat);
      impulse.x = scratchForward.x * tuning.mass * 0.8;
      impulse.y = tuning.mass * JUMP_IMPULSE_PER_KG;
      impulse.z = scratchForward.z * tuning.mass * 0.8;
      chassis.applyImpulse(impulse, true);
      jumpCooldown.current = JUMP_COOLDOWN;
    }

    // Airtime, reported once on landing.
    if (grounded === 0) {
      airborneFor.current += dt;
    } else if (airborneFor.current > 0) {
      readout.current.lastAirtime = airborneFor.current;
      onAir?.(airborneFor.current);
      airborneFor.current = 0;
    }

    // Upside down for a second and a half rights itself. R does it now.
    const rotation = chassis.rotation();
    scratchQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    scratchUp.copy(WORLD_UP).applyQuaternion(scratchQuat);
    readout.current.upDot = scratchUp.dot(WORLD_UP);
    if (readout.current.upDot < 0) {
      upsideDownFor.current += dt;
      if (upsideDownFor.current >= FLIP_SECONDS) recover.current();
    } else {
      upsideDownFor.current = 0;
    }
    if (takeOneShot("reset")) recover.current();

    // The horn.
    if (takeOneShot("horn")) {
      sounds.setEnabled(store.progress.settings.soundEnabled);
      sounds.playHorn();
    }

    // The engine note follows how hard the vehicle is working.
    sounds.setEngine(Math.min(1, absSpeed / Math.max(1, tuning.maxSpeed)));

    vehicle.updateVehicle(dt);
  });

  useFrame((_, delta) => {
    const vehicle = controller.current;
    const chassis = body.current;
    if (!vehicle || !chassis) return;

    // Share where the player is with the rest of the scene.
    const position = chassis.translation();
    const rotation = chassis.rotation();
    playerPos.current.set(position.x, position.y, position.z);
    playerQuat.current.set(rotation.x, rotation.y, rotation.z, rotation.w);

    const speed = vehicle.currentVehicleSpeed();
    playerSpeedRef.current = speed;
    onSpeed?.(speed);

    // Roll the wheels by how far they travelled, and steer the front pair.
    wheelSpin.current += (speed / tuning.wheelRadius) * delta;
    for (let i = 0; i < 4; i += 1) {
      const group = wheels.current[i];
      if (!group) continue;
      const mount = tuning.wheelPositions[i];
      const suspension =
        vehicle.wheelSuspensionLength(i) ?? tuning.suspension.restLength;
      group.position.set(mount[0], mount[1] - suspension, mount[2]);
      group.rotation.y = i < 2 ? steerAngle.current : 0;
      // The first child holds the tire and the hub, so both roll together.
      const spinner = group.children[0];
      if (spinner) spinner.rotation.x = wheelSpin.current;
    }
  });

  const { length, width, height } = tuning.chassis;

  return (
    <RigidBody
      ref={body}
      type="dynamic"
      colliders={false}
      position={[spawn[0], spawn[1], spawn[2]]}
      linearDamping={0.1}
      angularDamping={1}
      canSleep={false}
    >
      <CuboidCollider
        args={[width / 2, height / 2, length / 2]}
        mass={tuning.mass}
      />

      <VehicleModel id={id} tuning={tuning} paint={paint} />

      {[0, 1, 2, 3].map((i) => (
        <group
          key={i}
          ref={(group) => {
            wheels.current[i] = group;
          }}
          position={[
            tuning.wheelPositions[i][0],
            tuning.wheelPositions[i][1] - tuning.suspension.restLength,
            tuning.wheelPositions[i][2],
          ]}
        >
          <WheelModel radius={tuning.wheelRadius} />
        </group>
      ))}
    </RigidBody>
  );
}

export default Vehicle;
