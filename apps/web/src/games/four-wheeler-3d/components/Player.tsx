"use client";
import { OutfitText } from "./models/OutfitText";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CapsuleCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import type { GameControls } from "../hooks/useControls";
import { useGameContext } from "../lib/gameContext";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { heightAt } from "../lib/terrain";
import { transportTuning } from "../lib/transport";
import {
  footMovement,
  footSupportHeight,
  gaitAngle,
  PLAYER_HALF_HEIGHT,
  type FootState,
} from "../lib/foot";
import {
  activityMovementLocked,
  takeActivityImpulse,
} from "../lib/activitiesSession";
import { NEUTRAL } from "../lib/controls";
import { savedRider } from "../lib/migration";
import { usesFootController } from "../lib/rideTransitions";

/** Collision-aware walking. Shared context stores feet; Rapier stores the capsule center. */
export function Player({ controls }: { controls: GameControls }) {
  const { world, rapier } = useRapier();
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const controller = useRef<ReturnType<
    typeof world.createCharacterController
  > | null>(null);
  const outfit = useFourWheeler3dStore(
    (s) => s.progress.adventure.outfit.color,
  );
  const helmetCam = useFourWheeler3dStore((s) => s.progress.settings.helmetCam);
  const mode = useFourWheeler3dStore((s) => s.mode);
  const [spawn] = useState(() => {
    const relocation = useAdventureSession.getState().relocation;
    const p =
      relocation?.position ??
      savedRider(useFourWheeler3dStore.getState().progress.adventure).position;
    return [p.x, p.y + PLAYER_HALF_HEIGHT, p.z] as [number, number, number];
  });
  const motion = useRef<FootState>({
    heading: savedRider(useFourWheeler3dStore.getState().progress.adventure)
      .heading,
    verticalVelocity: 0,
    grounded: false,
  });
  const seenRelocation = useRef(-1);
  const resetFloor = useRef(spawn[1] - PLAYER_HALF_HEIGHT);
  const distance = useRef(0);
  const actualSpeed = useRef(0);
  const arms = useRef<Array<THREE.Group | null>>([]);
  const avatar = useRef<THREE.Group>(null);
  const legs = useRef<Array<THREE.Group | null>>([]);
  const delta = useRef({ x: 0, y: 0, z: 0 });
  const next = useRef({ x: 0, y: 0, z: 0 });
  const rotation = useRef({ x: 0, y: 0, z: 0, w: 1 });
  const environment = useRef({
    swimming: false,
    parachute: false,
    stationary: false,
  });
  const activityVelocity = useRef({ x: 0, z: 0 });

  useEffect(() => {
    const character = world.createCharacterController(0.02);
    character.enableAutostep(0.3, 0.2, false);
    character.enableSnapToGround(0.25);
    character.setMaxSlopeClimbAngle(Math.PI / 4);
    character.setMinSlopeSlideAngle(Math.PI / 3);
    controller.current = character;
    return () => {
      controller.current = null;
      world.removeCharacterController(character);
    };
  }, [world]);

  useBeforePhysicsStep(() => {
    const chassis = body.current;
    const shape = collider.current;
    const character = controller.current;
    if (!chassis || !shape || !character) return;
    const session = useAdventureSession.getState();
    const mode = useFourWheeler3dStore.getState().mode;
    if (!usesFootController(mode)) return;
    const relocation = session.relocation;
    if (relocation && relocation.id !== seenRelocation.current) {
      seenRelocation.current = relocation.id;
      next.current.x = relocation.position.x;
      next.current.y = relocation.position.y + PLAYER_HALF_HEIGHT;
      next.current.z = relocation.position.z;
      chassis.setTranslation(next.current, true);
      chassis.setNextKinematicTranslation(next.current);
      motion.current.heading = relocation.heading;
      resetFloor.current = relocation.position.y;
      motion.current.verticalVelocity = 0;
      motion.current.grounded = false;
    }
    const position = chassis.translation();
    const dt = world.timestep;
    const terrainMode =
      mode === "foot" || mode === "mount" || mode === "parachute";
    const ground = terrainMode ? heightAt(position.x, position.z) : -Infinity;
    environment.current.swimming =
      ground < -0.3 && position.y - PLAYER_HALF_HEIGHT < 0.15;
    environment.current.parachute = mode === "parachute";
    environment.current.stationary = mode === "stand";
    const kick = takeActivityImpulse();
    if (kick) {
      motion.current.verticalVelocity = kick.y;
      motion.current.grounded = false;
      activityVelocity.current.x = kick.x;
      activityVelocity.current.z = kick.z;
    }
    footMovement(
      motion.current,
      activityMovementLocked() ? NEUTRAL : controls.getControlValues(),
      controls.takeOneShot("jump"),
      dt,
      environment.current,
      delta.current,
    );
    if (mode === "mount") {
      delta.current.x *= 2;
      delta.current.z *= 2;
    }
    delta.current.x += activityVelocity.current.x * dt;
    delta.current.z += activityVelocity.current.z * dt;
    activityVelocity.current.x *= Math.exp(-2 * dt);
    activityVelocity.current.z *= Math.exp(-2 * dt);
    character.computeColliderMovement(
      shape,
      delta.current,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const movement = character.computedMovement();
    next.current.x = position.x + movement.x;
    next.current.y = position.y + movement.y;
    next.current.z = position.z + movement.z;
    motion.current.grounded = character.computedGrounded();
    if (mode === "deck") {
      const id = session.transport?.vehicleId;
      const boat = id
        ? useFourWheeler3dStore.getState().progress.adventure.fleet[id]
        : null;
      if (boat) {
        const tune = transportTuning(boat.type);
        const dx = next.current.x - boat.position.x;
        const dz = next.current.z - boat.position.z;
        const c = Math.cos(boat.heading),
          s = Math.sin(boat.heading);
        const x = Math.max(
          -tune.width * 0.32,
          Math.min(tune.width * 0.32, c * dx - s * dz),
        );
        const z = Math.max(
          -tune.length * 0.4,
          Math.min(tune.length * 0.3, s * dx + c * dz),
        );
        next.current.x = boat.position.x + c * x + s * z;
        next.current.z = boat.position.z - s * x + c * z;
        next.current.y =
          boat.position.y + tune.deckHeight + PLAYER_HALF_HEIGHT + 0.03;
        motion.current.grounded = true;
      }
    }
    // During chunk streaming there may briefly be no collider under a walker.
    if (terrainMode) {
      const support =
        footSupportHeight(heightAt(next.current.x, next.current.z)) +
        PLAYER_HALF_HEIGHT;
      if (next.current.y < support) {
        next.current.y = support;
        motion.current.grounded = true;
      }
    }
    if (motion.current.grounded && motion.current.verticalVelocity < 0)
      motion.current.verticalVelocity = 0;
    if (mode === "parachute" && motion.current.grounded)
      useFourWheeler3dStore.getState().setMode("foot");
    if (controls.takeOneShot("reset")) {
      next.current.y =
        (terrainMode ? footSupportHeight(ground) : resetFloor.current) +
        PLAYER_HALF_HEIGHT +
        0.1;
      motion.current.verticalVelocity = 0;
    }
    rotation.current.y = Math.sin(motion.current.heading / 2);
    rotation.current.w = Math.cos(motion.current.heading / 2);
    chassis.setNextKinematicTranslation(next.current);
    chassis.setNextKinematicRotation(rotation.current);
    actualSpeed.current =
      Math.hypot(next.current.x - position.x, next.current.z - position.z) / dt;
    distance.current += actualSpeed.current * dt;
  });

  useFrame(({ camera }) => {
    const chassis = body.current;
    if (!chassis) return;
    const session = useAdventureSession.getState(),
      liveMode = useFourWheeler3dStore.getState().mode;
    if (!usesFootController(liveMode)) return;
    const relocation = session.relocation;
    if (relocation && relocation.id !== seenRelocation.current) {
      // Rapier may be paused before applying a teleport. Keep the requested feet pose authoritative.
      playerPos.current.set(
        relocation.position.x,
        relocation.position.y,
        relocation.position.z,
      );
      playerQuat.current.set(
        0,
        Math.sin(relocation.heading / 2),
        0,
        Math.cos(relocation.heading / 2),
      );
      playerSpeedRef.current = 0;
      return;
    }
    const p = chassis.translation();
    playerPos.current.set(p.x, p.y - PLAYER_HALF_HEIGHT, p.z);
    playerQuat.current.set(
      0,
      Math.sin(motion.current.heading / 2),
      0,
      Math.cos(motion.current.heading / 2),
    );
    playerSpeedRef.current = actualSpeed.current;
    if (relocation && session.appliedFootRelocationId !== relocation.id)
      useAdventureSession.setState({ appliedFootRelocationId: relocation.id });
    if (avatar.current)
      avatar.current.visible =
        !helmetCam &&
        mode !== "mount" &&
        (mode !== "interior" ||
          Math.hypot(camera.position.x - p.x, camera.position.z - p.z) > 1.75);
    for (let i = 0; i < 2; i++) {
      const angle = gaitAngle(
        distance.current,
        actualSpeed.current,
        i * Math.PI,
      );
      if (legs.current[i]) legs.current[i]!.rotation.x = angle;
      if (arms.current[i]) arms.current[i]!.rotation.x = -angle * 0.65;
    }
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={spawn}
    >
      <CapsuleCollider ref={collider} args={[0.5, 0.3]} />
      <group
        ref={avatar}
        name="hank-on-foot"
        position={[0, -PLAYER_HALF_HEIGHT, 0]}
        visible={!helmetCam && mode !== "mount"}
      >
        {mode === "parachute" && (
          <group name="open-parachute">
            <mesh position={[0, 3.6, 0]} castShadow>
              <sphereGeometry
                args={[1.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]}
              />
              <meshStandardMaterial color="#c45c3c" side={THREE.DoubleSide} />
            </mesh>
            {[-1, 1].flatMap((x) =>
              [-1, 1].map((z) => (
                <mesh
                  key={`${x}:${z}`}
                  position={[x * 0.55, 2.55, z * 0.55]}
                  rotation={[z * 0.45, 0, -x * 0.45]}
                >
                  <cylinderGeometry args={[0.008, 0.008, 2.5, 5]} />
                  <meshStandardMaterial color="#e3ded0" />
                </mesh>
              )),
            )}
          </group>
        )}
        <mesh position={[0, 1.07, 0]} scale={[0.24, 0.34, 0.15]} castShadow>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color={outfit} roughness={0.95} />
        </mesh>
        <OutfitText position={[0, 1.17, 0.148]} />
        <OutfitText back position={[0, 1.17, -0.148]} />
        <mesh position={[0, 1.52, 0.015]} castShadow>
          <sphereGeometry args={[0.18, 20, 16]} />
          <meshStandardMaterial color="#cf9b75" roughness={0.95} />
        </mesh>
        <mesh position={[0, 1.65, 0.015]} scale={[0.19, 0.07, 0.2]} castShadow>
          <sphereGeometry args={[1, 16, 10]} />
          <meshStandardMaterial color="#394c36" />
        </mesh>
        <mesh position={[0, 1.62, 0.17]} castShadow>
          <boxGeometry args={[0.26, 0.025, 0.15]} />
          <meshStandardMaterial color="#394c36" />
        </mesh>
        {[-1, 1].map((side, i) => (
          <group key={side}>
            <group
              ref={(g) => {
                legs.current[i] = g;
              }}
              position={[side * 0.12, 0.72, 0]}
            >
              <mesh position={[0, -0.28, 0]} castShadow>
                <capsuleGeometry args={[0.095, 0.4, 6, 10]} />
                <meshStandardMaterial color="#34464d" />
              </mesh>
              <mesh position={[0, -0.64, 0.055]} castShadow>
                <boxGeometry args={[0.18, 0.14, 0.31]} />
                <meshStandardMaterial color="#3e3328" />
              </mesh>
            </group>
            <group
              ref={(g) => {
                arms.current[i] = g;
              }}
              position={[side * 0.23, 1.28, 0]}
            >
              <mesh position={[side * 0.04, -0.2, 0]} castShadow>
                <capsuleGeometry args={[0.07, 0.3, 6, 10]} />
                <meshStandardMaterial color={outfit} />
              </mesh>
              <mesh position={[side * 0.04, -0.43, 0]} castShadow>
                <sphereGeometry args={[0.075, 12, 8]} />
                <meshStandardMaterial color="#cf9b75" />
              </mesh>
            </group>
            <mesh position={[side * 0.065, 1.54, 0.175]}>
              <sphereGeometry args={[0.018, 8, 6]} />
              <meshStandardMaterial color="#222721" />
            </mesh>
          </group>
        ))}
      </group>
    </RigidBody>
  );
}

export default Player;
