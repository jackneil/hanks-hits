"use client";
import { Headlights } from "./Headlights";

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

import { useEffect, useMemo, useRef } from "react";
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
import { NEUTRAL } from "../lib/controls";
import {
  activityMovementLocked,
  takeActivityImpulse,
  activitySurfaceFactorAt,
} from "../lib/activitiesSession";
import { BIKES } from "../lib/catalog";
import { sounds } from "../lib/sounds";
import { VehicleModel } from "./models";
import { WheelModel } from "./models/WheelModel";
import { useAdventureSession } from "../lib/adventureSession";
import {
  applyDriving,
  chassisMassProperties,
  configureVehicle,
  recoverVehicle,
  type VehicleController,
} from "../lib/driving";

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

export type VehicleProps = {
  id: VehicleId;
  spawn: readonly [number, number, number];
  heading?: number;
  speedUpgrade?: number;
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
  heading = 0,
  speedUpgrade = 0,
  getControls,
  takeOneShot,
  bodyRef,
  onSpeed,
  onAir,
}: VehicleProps) {
  const tuning = useMemo(() => {
    const base = tuningFor(id);
    return speedUpgrade
      ? {
          ...base,
          maxSpeed: Math.max(5 / 2.237, base.maxSpeed + speedUpgrade / 2.237),
        }
      : base;
  }, [id, speedUpgrade]);
  const twoWheels =
    id === "moto" || id === "bike" || BIKES.some((b) => b[0] === id);
  const massProperties = useMemo(() => chassisMassProperties(tuning), [tuning]);
  const { world } = useRapier();
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();

  const paint = useFourWheeler3dStore(
    (state) =>
      state.progress.adventure.fleet[
        state.progress.adventure.activeVehicleId ?? ""
      ]?.paint ?? state.progress.paint,
  );
  const mud = useFourWheeler3dStore(
    (state) =>
      state.progress.adventure.fleet[
        state.progress.adventure.activeVehicleId ?? ""
      ]?.mud ?? 0,
  );

  const localBody = useRef<RapierRigidBody | null>(null);
  const body = bodyRef ?? localBody;
  const controller = useRef<VehicleController | null>(null);
  const wheels = useRef<(THREE.Group | null)[]>([null, null, null, null]);

  // Everything the frame loop remembers between steps.
  const driving = useRef({ steerAngle: 0, engine: 0 });
  const drivingConditions = useRef({ boost: 1, surfaceFactor: 1, icy: false });
  const wheelSpin = useRef(0);
  const jumpCooldown = useRef(0);
  const upsideDownFor = useRef(0);
  const airborneFor = useRef(0);
  const relocated = useRef(0);

  // What the browser test handle reads back. Written by the physics step.
  const readout = useRef({ wheels: 0, engine: 0, upDot: 1, lastAirtime: 0 });

  // Build the vehicle controller once the chassis body exists.
  useEffect(() => {
    const chassis = body.current;
    if (!chassis) return;

    const vehicle = world.createVehicleController(chassis);
    configureVehicle(vehicle, tuning);

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
    const position = chassis.translation();
    recoverVehicle(chassis, heightAt(position.x, position.z));
    driving.current.steerAngle = 0;
    airborneFor.current = 0;

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
      heading: () => {
        const q = body.current?.rotation();
        return q
          ? Math.atan2(
              2 * (q.w * q.y + q.x * q.z),
              1 - 2 * (q.x * q.x + q.y * q.y),
            )
          : 0;
      },
      steering: () => driving.current.steerAngle,
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
    const relocation = useAdventureSession.getState().relocation;
    if (relocation && relocation.id !== relocated.current) {
      relocated.current = relocation.id;
      chassis.setTranslation(relocation.position, true);
      scratchQuat.setFromAxisAngle(WORLD_UP, relocation.heading);
      chassis.setRotation(scratchQuat, true);
      chassis.setLinvel(zeroVector, true);
      chassis.setAngvel(zeroVector, true);
      driving.current.steerAngle = 0;
    }
    const race = useAdventureSession.getState().race;
    const controls =
      race?.phase === "countdown" || activityMovementLocked()
        ? NEUTRAL
        : getControls();
    const store = useFourWheeler3dStore.getState();

    // The boost, from the 2D game: three seconds of double push.
    if (takeOneShot("nos")) store.startNos();
    const boosting = store.nosUntil > Date.now();
    const terrainFactor = activitySurfaceFactorAt(
      chassis.translation().x,
      chassis.translation().z,
      store.progress.adventure,
      store.snowLevel,
    );
    const boost =
      (boosting ? NOS_MULTIPLIER : 1) *
      (race?.phase === "racing" ? race.speedFactor : 1) *
      terrainFactor;
    chassis.setLinearDamping(terrainFactor < 1 ? 1.5 : 0.1);
    const activityImpulse = takeActivityImpulse();
    if (activityImpulse) {
      const mass = chassis.mass();
      chassis.applyImpulse(
        {
          x: activityImpulse.x * mass,
          y: activityImpulse.y * mass,
          z: activityImpulse.z * mass,
        },
        true,
      );
    }

    const speed = vehicle.currentVehicleSpeed();
    const absSpeed = Math.abs(speed);
    const position = chassis.translation();
    // A stale save or unloaded ground must never leave a rider falling forever.
    if (position.y < heightAt(position.x, position.z) - 4) {
      recover.current();
      return;
    }
    drivingConditions.current.boost = boost;
    drivingConditions.current.surfaceFactor =
      surfaceAt(position.x, position.z) === "grass" ? GRASS_ENGINE_FACTOR : 1;
    drivingConditions.current.icy = store.snowLevel > ICE_SNOW_LEVEL;
    applyDriving(
      vehicle,
      tuning,
      controls,
      driving.current,
      dt,
      drivingConditions.current,
    );

    // How many wheels are on the ground, which the jump and the dust need.
    let grounded = 0;
    for (let i = 0; i < 4; i += 1) {
      if (vehicle.wheelIsInContact(i)) grounded += 1;
    }
    readout.current.wheels = grounded;
    readout.current.engine = driving.current.engine;

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

    // A quad resting on its side or roof rights itself. R does it now.
    const rotation = chassis.rotation();
    scratchQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    scratchUp.copy(WORLD_UP).applyQuaternion(scratchQuat);
    readout.current.upDot = scratchUp.dot(WORLD_UP);
    if (readout.current.upDot < 0.3 && grounded < 2) {
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
    sounds.setEngine(
      Math.min(1, absSpeed / Math.max(1, tuning.maxSpeed)),
      controls.throttle,
    );

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
      group.position.set(
        twoWheels ? 0 : mount[0],
        mount[1] - suspension,
        mount[2],
      );
      group.rotation.y = i < 2 ? driving.current.steerAngle : 0;
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
      rotation={[0, heading, 0]}
      linearDamping={0.1}
      angularDamping={1}
      canSleep={false}
      ccd
    >
      <CuboidCollider
        args={[width / 2, height / 2, length / 2]}
        massProperties={massProperties}
      />

      <VehicleModel
        id={id}
        tuning={tuning}
        paint={paint}
        mud={mud}
        lightsEnabled={false}
      />
      <Headlights width={width} length={length} />

      {[0, 1, 2, 3].map((i) =>
        twoWheels && i % 2 ? null : (
          <group
            key={i}
            ref={(group) => {
              wheels.current[i] = group;
            }}
            position={[
              twoWheels ? 0 : tuning.wheelPositions[i][0],
              tuning.wheelPositions[i][1] - tuning.suspension.restLength,
              tuning.wheelPositions[i][2],
            ]}
          >
            <WheelModel radius={tuning.wheelRadius} />
          </group>
        ),
      )}
    </RigidBody>
  );
}

export default Vehicle;
