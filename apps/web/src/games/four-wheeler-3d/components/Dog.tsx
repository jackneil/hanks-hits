"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGameContext } from "../lib/gameContext";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { heightAt } from "../lib/terrain";

export type DogProps = {
  /** Root owns retrieval rewards; this only moves the visible companion to the target. */
  target?: [number, number, number];
  sitting?: boolean;
  action?: string;
};

/** A chocolate Labrador: chest, haunches, four jointed legs, muzzle, ears and a wagging tail. */
export function Dog({ target, sitting = false, action }: DogProps) {
  const { playerPos, playerQuat } = useGameContext();
  const alive = useFourWheeler3dStore((s) => s.progress.adventure.dog.alive);
  const dog = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const legs = useRef<Array<THREE.Group | null>>([]);
  const lowerLegs = useRef<Array<THREE.Group | null>>([]);
  const [spawn] = useState(
    () =>
      [
        playerPos.current.x + 2,
        playerPos.current.y,
        playerPos.current.z - 2,
      ] as [number, number, number],
  );
  const distance = useRef(0);
  const excitement = useRef(0);
  const idleTime = useRef(0);
  const reducedMotion = useRef(false);
  const seenAction = useRef(-1);
  const seenRelocation = useRef(-1);
  const reportAfter = useRef(0);
  const desired = useRef(new THREE.Vector3());

  useEffect(() => {
    if (action) excitement.current = 2;
  }, [action]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotion.current = preference.matches;
    };
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useFrame((_, rawDelta) => {
    const model = dog.current;
    if (!model || !alive) return;
    const dt = Math.min(rawDelta, 0.05);
    const session = useAdventureSession.getState();
    if (session.action && session.action.id !== seenAction.current) {
      seenAction.current = session.action.id;
      if (/whistle|bark|dog|feed/.test(session.action.name))
        excitement.current = 2;
    }
    const mode = useFourWheeler3dStore.getState().mode;
    if (target) desired.current.set(...target);
    else if (session.dogTarget)
      desired.current.set(
        session.dogTarget.x,
        session.dogTarget.y,
        session.dogTarget.z,
      );
    else
      desired.current
        .set(0.9, 0, -2.1)
        .applyQuaternion(playerQuat.current)
        .add(playerPos.current);
    const dx = desired.current.x - model.position.x;
    const dz = desired.current.z - model.position.z;
    const reach = Math.hypot(dx, dz);
    const relocated =
      session.relocation && session.relocation.id !== seenRelocation.current;
    if (relocated) seenRelocation.current = session.relocation!.id;
    // A companion catches up after a vehicle trip or a portal, without running across the whole map.
    const fetching = Boolean(target || session.dogTarget);
    const snapped = !fetching && (relocated || (!sitting && reach > 65));
    if (snapped) model.position.copy(desired.current);
    const stopDistance = fetching ? 0.2 : 0.55;
    const speed =
      sitting || snapped
        ? 0
        : Math.min(11, Math.max(0, reach - stopDistance) * 2.8);
    const step = Math.min(reach, speed * dt);
    if (reach > 0.01 && !relocated) {
      model.position.x += (dx / reach) * step;
      model.position.z += (dz / reach) * step;
      if (step > 0.001) {
        const turn = Math.atan2(dx, dz) - model.rotation.y;
        model.rotation.y +=
          Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-9 * dt));
      }
    }
    const indoor =
      mode === "interior" ||
      mode === "planet" ||
      mode === "stand" ||
      mode === "deck";
    const floor = indoor
      ? desired.current.y
      : Math.max(-0.3, heightAt(model.position.x, model.position.z));
    model.position.y += (floor - model.position.y) * (1 - Math.exp(-16 * dt));
    reportAfter.current += dt;
    if (reportAfter.current >= 0.1) {
      reportAfter.current = 0;
      useAdventureSession.setState({
        dogPosition: {
          x: model.position.x,
          y: model.position.y,
          z: model.position.z,
        },
      });
    }
    distance.current += step;
    idleTime.current += dt;
    excitement.current = Math.max(0, excitement.current - dt);
    const gait = Math.min(1, speed / 3);
    for (let i = 0; i < 4; i++) {
      const leg = legs.current[i];
      const lower = lowerLegs.current[i];
      // Diagonal pairs move together in a Labrador's trot.
      const phase = distance.current * 10 + (i === 0 || i === 3 ? 0 : Math.PI);
      if (leg)
        leg.rotation.x =
          sitting && i >= 2 ? -1.1 : Math.sin(phase) * 0.65 * gait;
      if (lower)
        lower.rotation.x =
          sitting && i >= 2 ? 1.7 : Math.max(0, Math.cos(phase)) * 0.45 * gait;
    }
    if (torso.current) {
      const pose = sitting ? -0.24 : 0;
      torso.current.rotation.x +=
        (pose - torso.current.rotation.x) * (1 - Math.exp(-10 * dt));
    }
    if (head.current)
      head.current.rotation.x =
        excitement.current > 0 && !reducedMotion.current
          ? Math.sin(excitement.current * 14) * 0.09
          : -0.08;
    if (tail.current)
      tail.current.rotation.z = reducedMotion.current
        ? 0
        : Math.sin(distance.current * 5 + idleTime.current * 6) *
          (excitement.current > 0 ? 0.6 : 0.2);
  });

  return (
    <group ref={dog} name="hanks-dog" position={spawn} visible={alive}>
      <group ref={torso} position={[0, 0.59, 0]}>
        <mesh scale={[0.2, 0.24, 0.46]} castShadow>
          <sphereGeometry args={[1, 18, 12]} />
          <meshStandardMaterial color="#674832" roughness={1} />
        </mesh>
        <mesh
          position={[0, 0.005, 0.27]}
          scale={[0.205, 0.255, 0.23]}
          castShadow
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="#70503b" roughness={1} />
        </mesh>
        <mesh
          position={[0, -0.01, -0.29]}
          scale={[0.21, 0.24, 0.24]}
          castShadow
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="#674832" roughness={1} />
        </mesh>
        <group ref={head} position={[0, 0.22, 0.4]}>
          <mesh scale={[0.175, 0.195, 0.21]} castShadow>
            <sphereGeometry args={[1, 20, 14]} />
            <meshStandardMaterial color="#73523c" roughness={1} />
          </mesh>
          <mesh
            position={[0, -0.055, 0.2]}
            scale={[0.115, 0.09, 0.15]}
            castShadow
          >
            <sphereGeometry args={[1, 16, 10]} />
            <meshStandardMaterial color="#79543a" roughness={1} />
          </mesh>
          <mesh position={[0, -0.025, 0.33]} scale={[0.085, 0.055, 0.04]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color="#20201c" roughness={0.65} />
          </mesh>
          <mesh position={[0, -0.12, 0.17]} scale={[0.1, 0.027, 0.12]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color="#37271f" />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh
                position={[side * 0.16, -0.035, -0.01]}
                rotation={[0.15, 0, side * 0.15]}
                scale={[0.065, 0.2, 0.095]}
                castShadow
              >
                <sphereGeometry args={[1, 14, 10]} />
                <meshStandardMaterial color="#513727" roughness={1} />
              </mesh>
              <mesh position={[side * 0.105, 0.045, 0.157]}>
                <sphereGeometry args={[0.028, 10, 8]} />
                <meshStandardMaterial color="#c39550" roughness={0.3} />
              </mesh>
              <mesh position={[side * 0.107, 0.046, 0.178]}>
                <sphereGeometry args={[0.016, 10, 8]} />
                <meshStandardMaterial color="#111a16" roughness={0.2} />
              </mesh>
            </group>
          ))}
        </group>
        <mesh position={[0, 0.12, 0.345]} rotation={[Math.PI / 2 - 0.35, 0, 0]}>
          <torusGeometry args={[0.17, 0.027, 8, 20]} />
          <meshStandardMaterial color="#a43c2f" />
        </mesh>
        <mesh position={[0, -0.05, 0.39]}>
          <sphereGeometry args={[0.038, 10, 8]} />
          <meshStandardMaterial
            color="#c8a454"
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
        <group ref={tail} position={[0, 0.065, -0.4]} rotation={[-0.65, 0, 0]}>
          <mesh position={[0, 0.12, -0.15]} rotation={[0.65, 0, 0]} castShadow>
            <capsuleGeometry args={[0.04, 0.35, 6, 10]} />
            <meshStandardMaterial color="#674832" roughness={1} />
          </mesh>
        </group>
      </group>
      {[
        [-0.15, 0.28],
        [0.15, 0.28],
        [-0.15, -0.29],
        [0.15, -0.29],
      ].map(([x, z], i) => (
        <group
          key={i}
          ref={(g) => {
            legs.current[i] = g;
          }}
          position={[x, 0.6, z]}
        >
          <mesh position={[0, -0.13, 0]} castShadow>
            <capsuleGeometry args={[i < 2 ? 0.055 : 0.085, 0.18, 6, 10]} />
            <meshStandardMaterial color="#674832" roughness={1} />
          </mesh>
          <group
            ref={(g) => {
              lowerLegs.current[i] = g;
            }}
            position={[0, -0.27, 0]}
          >
            <mesh position={[0, -0.105, 0]} castShadow>
              <capsuleGeometry args={[0.038, 0.15, 6, 10]} />
              <meshStandardMaterial color="#78563c" roughness={1} />
            </mesh>
            <mesh
              position={[0, -0.26, 0.045]}
              scale={[0.065, 0.05, 0.1]}
              castShadow
            >
              <sphereGeometry args={[1, 12, 8]} />
              <meshStandardMaterial color="#78563c" roughness={1} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

export default Dog;
