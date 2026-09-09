"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import type { GameControls } from "../hooks/useControls";
import type { FleetVehicle } from "../lib/adventureTypes";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import { sounds } from "../lib/sounds";
import { heightAt } from "../lib/terrain";
import {
  createTransportState,
  isWatercraft,
  stepTransport,
  transportTuning,
} from "../lib/transport";
import { TransportModel } from "./models/TransportModel";
export { TransportActions } from "./TransportActions";

export function Transport({
  vehicle,
  controls,
  onSpeed,
}: {
  vehicle: FleetVehicle;
  controls: GameControls;
  onSpeed?: (speed: number) => void;
}) {
  const { world } = useRapier();
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  const body = useRef<RapierRigidBody>(null);
  const wake = useRef<THREE.Group>(null);
  const waves = useRef<THREE.Group>(null);
  const smoke = useRef<THREE.InstancedMesh>(null);
  const trail = useRef(
    Array.from({ length: 24 }, () => ({ x: 0, y: 0, z: 0, life: 0 })),
  );
  const nextSmoke = useRef(0),
    smokeClock = useRef(0);
  const smokeMatrix = useRef(new THREE.Object3D());
  const water = isWatercraft(vehicle.type);
  const tuning = transportTuning(vehicle.type);
  const [spawn] = useState(
    () =>
      [
        vehicle.position.x,
        water
          ? 0
          : Math.max(
              vehicle.position.y,
              heightAt(vehicle.position.x, vehicle.position.z) +
                tuning.deckHeight,
            ),
        vehicle.position.z,
      ] as [number, number, number],
  );
  const movement = useRef(createTransportState(...spawn, vehicle.heading));
  const reportAfter = useRef(0);
  const seenAction = useRef(useAdventureSession.getState().action?.id ?? -1);
  const seenRelocation = useRef(
    useAdventureSession.getState().relocation?.id ?? -1,
  );
  const orientation = useRef(new THREE.Quaternion());
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const next = useRef({ x: 0, y: 0, z: 0 });
  const options = useAdventureSession((s) =>
    s.transport?.vehicleId === vehicle.id ? s.transport : null,
  );

  useEffect(() => {
    const state = movement.current;
    const previous = useAdventureSession.getState().transport;
    if (previous?.vehicleId !== vehicle.id)
      useAdventureSession.setState({
        transport: {
          vehicleId: vehicle.id,
          speed: 0,
          altitude: 0,
          netDeployed: false,
          anchorDown: false,
          lightsOn: false,
          canopyOpen: false,
        },
      });
    return () => {
      useFourWheeler3dStore.getState().updateProgress((p) => {
        const current = p.adventure.fleet[vehicle.id];
        if (!current) return p;
        return {
          ...p,
          adventure: {
            ...p.adventure,
            fleet: {
              ...p.adventure.fleet,
              [vehicle.id]: {
                ...current,
                position: {
                  x: state.x,
                  y: isWatercraft(vehicle.type)
                    ? state.y
                    : Math.max(0, heightAt(state.x, state.z)) +
                      transportTuning(vehicle.type).deckHeight,
                  z: state.z,
                },
                heading: state.heading,
                parked: true,
              },
            },
          },
        };
      });
    };
  }, [vehicle.id, vehicle.type]);

  useEffect(() => {
    if (water) return;
    const down = (event: KeyboardEvent) => {
      const store = useFourWheeler3dStore.getState();
      if (
        !store.hasStarted ||
        store.isPaused ||
        useAdventureSession.getState().panel
      )
        return;
      if (
        keyBelongsToTarget(event) ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      const names: Record<string, string> = {
        KeyQ: "air:climb",
        KeyZ: "air:descend",
        KeyF: "air:parachute",
        KeyB: "air:bomb",
      };
      const action = names[event.code];
      if (action && !event.repeat) {
        event.preventDefault();
        useAdventureSession.getState().requestAction(action);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "KeyQ" || event.code === "KeyZ")
        useAdventureSession.getState().requestAction("air:level");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [water]);

  useBeforePhysicsStep(() => {
    const chassis = body.current;
    if (!chassis) return;
    const state = movement.current;
    const session = useAdventureSession.getState();
    if (
      session.relocation &&
      session.relocation.id !== seenRelocation.current
    ) {
      seenRelocation.current = session.relocation.id;
      const p = session.relocation.position;
      state.x = p.x;
      state.y = p.y;
      state.z = p.z;
      state.heading = session.relocation.heading;
      state.speed = 0;
      state.verticalSpeed = 0;
      chassis.setTranslation(p, true);
    }
    const action = session.action;
    if (action && action.id !== seenAction.current) {
      seenAction.current = action.id;
      if (action.name === "air:climb") {
        state.climb = 1;
        state.autoTakeoff = false;
      }
      if (action.name === "air:descend") {
        state.climb = -1;
        state.autoTakeoff = false;
      }
      if (action.name === "air:level") {
        state.climb = 0;
        state.autoTakeoff = false;
      }
      if (
        action.name === "air:roll" &&
        !tuning.helicopter &&
        state.y > heightAt(state.x, state.z) + 5 &&
        state.rollRemaining === 0
      )
        state.rollRemaining = 0.7;
    }
    if (
      !water &&
      controls.takeOneShot("reset") &&
      !tuning.helicopter &&
      state.y > heightAt(state.x, state.z) + 5 &&
      state.rollRemaining === 0
    )
      state.rollRemaining = 0.7;
    state.anchorDown = session.transport?.anchorDown ?? false;
    const store = useFourWheeler3dStore.getState();
    if (controls.takeOneShot("nos")) store.startNos();
    stepTransport(
      state,
      vehicle.type,
      controls.getControlValues(),
      world.timestep,
      heightAt,
      vehicle.speedUpgrade,
      store.nosUntil > Date.now(),
    );
    next.current.x = state.x;
    next.current.y = state.y;
    next.current.z = state.z;
    euler.current.set(
      state.pitch,
      state.heading,
      state.bank + state.roll,
      "YXZ",
    );
    orientation.current.setFromEuler(euler.current);
    chassis.setNextKinematicTranslation(next.current);
    chassis.setNextKinematicRotation(orientation.current);
  });

  useFrame((_, dt) => {
    const state = movement.current;
    playerPos.current.set(
      state.x,
      state.y + (water ? tuning.deckHeight : 0),
      state.z,
    );
    playerQuat.current.copy(orientation.current);
    playerSpeedRef.current = state.speed;
    onSpeed?.(state.speed);
    const store = useFourWheeler3dStore.getState();
    if (store.hasStarted && !store.isPaused)
      sounds.setEngine(
        Math.min(1, Math.abs(state.speed) / tuning.maxSpeed),
        Math.max(0, controls.getControlValues().throttle),
      );
    if (wake.current) {
      wake.current.position.y = 0.08 - state.waveHeight;
      wake.current.visible = Math.abs(state.speed) > 0.5;
      wake.current.scale.set(
        1 + Math.abs(state.speed) * 0.04,
        1,
        1 + Math.abs(state.speed) * 0.08,
      );
    }
    if (waves.current) {
      waves.current.visible = water && state.waveIn < 0.8;
      waves.current.position.z = tuning.length * 0.6 - (0.8 - state.waveIn) * 8;
      waves.current.position.y = -state.waveHeight + 0.09;
      waves.current.scale.setScalar(0.8 + Math.sin(state.time) * 0.1);
    }
    smokeClock.current += dt;
    if (state.rollRemaining > 0 && smokeClock.current > 0.03) {
      smokeClock.current = 0;
      Object.assign(trail.current[nextSmoke.current++ % 24], {
        x: state.x,
        y: state.y,
        z: state.z,
        life: 1,
      });
    }
    if (smoke.current) {
      trail.current.forEach((p, i) => {
        p.life = Math.max(0, p.life - dt);
        const m = smokeMatrix.current;
        m.position.set(p.x, p.y, p.z);
        m.scale.setScalar(p.life ? 0.13 + (1 - p.life) * 0.6 : 0);
        m.updateMatrix();
        smoke.current!.setMatrixAt(i, m.matrix);
      });
      smoke.current.instanceMatrix.needsUpdate = true;
    }
    reportAfter.current += dt;
    if (reportAfter.current >= 0.1) {
      reportAfter.current = 0;
      const previous = useAdventureSession.getState().transport;
      if (previous?.vehicleId === vehicle.id)
        useAdventureSession.setState({
          transport: {
            ...previous,
            speed: state.speed,
            altitude: Math.max(
              0,
              state.y - Math.max(0, heightAt(state.x, state.z)),
            ),
          },
        });
    }
  });

  return (
    <>
      <instancedMesh
        ref={smoke}
        args={[undefined, undefined, 24]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial
          color="#edc761"
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      </instancedMesh>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={spawn}
      >
        <CuboidCollider
          args={[tuning.width / 2, water ? 0.4 : 0.5, tuning.length / 2]}
        />
        <TransportModel
          type={vehicle.type}
          paint={vehicle.paint}
          running
          netDeployed={options?.netDeployed}
          lightsOn={options?.lightsOn}
          canopyOpen={options?.canopyOpen}
        />
        {water && (
          <group ref={waves}>
            {[-1, 0, 1].map((i) => (
              <mesh
                key={i}
                position={[0, 0, i * 0.4]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <planeGeometry args={[tuning.width * 2, 0.16]} />
                <meshBasicMaterial
                  color="#d5f2ee"
                  transparent
                  opacity={0.6}
                  depthWrite={false}
                />
              </mesh>
            ))}
          </group>
        )}
        {water && (
          <group ref={wake} position={[0, 0.08, -tuning.length * 0.48]}>
            {[-1, 1].map((side) => (
              <mesh
                key={side}
                position={[side * tuning.width * 0.5, 0, -1]}
                rotation={[-Math.PI / 2, 0, side * 0.35]}
              >
                <planeGeometry args={[0.3, 4]} />
                <meshBasicMaterial
                  color="#d4eeed"
                  transparent
                  opacity={0.42}
                  depthWrite={false}
                />
              </mesh>
            ))}
          </group>
        )}
      </RigidBody>
    </>
  );
}

export default Transport;
