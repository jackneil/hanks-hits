"use client";
import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { tuningFor } from "../lib/vehicles";
import { heightAt } from "../lib/terrain";
import { isAirVehicle, isWaterVehicle, isTrailer } from "../lib/catalog";
import { VehicleModel } from "./models";
import { WheelModel } from "./models/WheelModel";
import type { FleetVehicle } from "../lib/adventureTypes";
import { TransportModel } from "./models/TransportModel";
import { TrailerModel } from "./models/TrailerModel";
import { trailerTransforms } from "../lib/activitiesSession";
import { trailerLength } from "../lib/activities";
import * as THREE from "three";
import { useLayoutEffect } from "react";
import { BIKES } from "../lib/catalog";

export function Fleet() {
  const fleet = useFourWheeler3dStore((s) => s.progress.adventure.fleet),
    active = useFourWheeler3dStore((s) => s.progress.adventure.activeVehicleId),
    mode = useFourWheeler3dStore((s) => s.mode);
  const plow = useFourWheeler3dStore(
    (s) => s.progress.adventure.activities.plowVehicleId,
  );
  const pos = useAdventureSession((s) => s.playerSnapshot);
  const values = useMemo(() => Object.values(fleet), [fleet]);
  const loaded = new Set(values.flatMap((v) => v.cargo));
  const visible = values
    .filter(
      (v) =>
        !(plow && v.type === "plow") &&
        !(v.id === active && ["vehicle", "boat", "aircraft"].includes(mode)) &&
        !loaded.has(v.id),
    )
    .map((v) => ({
      v,
      distance: Math.hypot(
        (trailerTransforms.get(v.id)?.position ?? v.position).x - pos.x,
        (trailerTransforms.get(v.id)?.position ?? v.position).z - pos.z,
      ),
    }))
    .filter((item) => item.distance < 240)
    .sort((a, b) => a.distance - b.distance);
  const detailed = visible.filter((item) => item.distance < 70).slice(0, 24);
  const detailedIds = new Set(detailed.map((item) => item.v.id));
  const distant = visible
    .filter((item) => !detailedIds.has(item.v.id))
    .map((item) => item.v);
  return (
    <>
      {detailed.map(({ v }) => (
        <MemoParkedVehicle key={v.id} vehicle={v} />
      ))}
      {visible
        .filter((item) => item.distance < 90 && !detailedIds.has(item.v.id))
        .map(({ v }) => (
          <MemoParkedVehicle
            key={`collision-${v.id}`}
            vehicle={v}
            collisionOnly
          />
        ))}
      <DistantFleet vehicles={distant} />
    </>
  );
}
const MemoParkedVehicle = memo(ParkedVehicle);

/** Every owned ride remains visible, with bounded full models around the player. */
function DistantFleet({ vehicles }: { vehicles: FleetVehicle[] }) {
  const bodies = useRef<THREE.InstancedMesh>(null),
    wheels = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!bodies.current || !wheels.current) return;
    const transform = new THREE.Object3D(),
      color = new THREE.Color();
    let wheel = 0;
    vehicles.forEach((v, index) => {
      const t = tuningFor(v.type),
        water = isWaterVehicle(v.type),
        air = isAirVehicle(v.type);
      const p = trailerTransforms.get(v.id)?.position ?? v.position;
      const y = water
        ? 0
        : Math.max(
            p.y,
            heightAt(p.x, p.z) + t.wheelRadius + t.suspension.restLength,
          );
      transform.position.set(p.x, y, p.z);
      transform.rotation.set(0, v.heading, 0);
      transform.scale.set(t.chassis.width, t.chassis.height, t.chassis.length);
      transform.updateMatrix();
      bodies.current!.setMatrixAt(index, transform.matrix);
      bodies.current!.setColorAt(index, color.set(v.paint));
      if (!water && !air)
        for (const offset of t.wheelPositions) {
          transform.position.set(
            p.x +
              Math.cos(v.heading) * offset[0] +
              Math.sin(v.heading) * offset[2],
            y + offset[1] - t.suspension.restLength,
            p.z -
              Math.sin(v.heading) * offset[0] +
              Math.cos(v.heading) * offset[2],
          );
          transform.rotation.set(0, v.heading, Math.PI / 2);
          transform.scale.set(
            t.wheelRadius,
            t.wheelRadius * 0.8,
            t.wheelRadius,
          );
          transform.updateMatrix();
          wheels.current!.setMatrixAt(wheel++, transform.matrix);
        }
    });
    bodies.current.count = vehicles.length;
    wheels.current.count = wheel;
    for (const mesh of [bodies.current, wheels.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [vehicles]);
  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, 500]}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.75} />
      </instancedMesh>
      <instancedMesh ref={wheels} args={[undefined, undefined, 2000]}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial color="#20241f" roughness={0.95} />
      </instancedMesh>
    </>
  );
}

function ParkedVehicle({
  vehicle: v,
  collisionOnly = false,
}: {
  vehicle: FleetVehicle;
  collisionOnly?: boolean;
}) {
  const t = tuningFor(v.type),
    water = isWaterVehicle(v.type),
    air = isAirVehicle(v.type);
  const body = useRef<RapierRigidBody>(null),
    trailer = isTrailer(v.type);
  useFrame(() => {
    const transform = trailerTransforms.get(v.id);
    if (!transform || !body.current) return;
    body.current.setNextKinematicTranslation({
      ...transform.position,
      y: heightAt(transform.position.x, transform.position.z) + 0.7,
    });
    body.current.setNextKinematicRotation({
      x: 0,
      y: Math.sin(transform.heading / 2),
      z: 0,
      w: Math.cos(transform.heading / 2),
    });
  });
  const twoWheels =
    v.type === "moto" ||
    v.type === "bike" ||
    BIKES.some((b) => b[0] === v.type);
  const y = water
    ? 0
    : Math.max(
        v.position.y,
        heightAt(v.position.x, v.position.z) +
          t.wheelRadius +
          t.suspension.restLength,
      );
  if (water || air)
    return collisionOnly ? null : (
      <group
        position={[
          v.position.x,
          water ? 0 : Math.max(y, v.position.y),
          v.position.z,
        ]}
        rotation={[0, v.heading, 0]}
      >
        <TransportModel type={v.type} paint={v.paint} />
      </group>
    );
  return (
    <RigidBody
      ref={body}
      type={trailer ? "kinematicPosition" : "fixed"}
      colliders={false}
      position={[v.position.x, y, v.position.z]}
      rotation={[0, v.heading, 0]}
    >
      <CuboidCollider
        args={[
          trailer ? 1 : t.chassis.width / 2,
          t.chassis.height / 2,
          trailer ? trailerLength(v) / 2 : t.chassis.length / 2,
        ]}
      />
      {collisionOnly ? null : trailer ? (
        <TrailerModel vehicle={v} />
      ) : (
        <>
          <VehicleModel
            id={v.type}
            tuning={t}
            paint={v.paint}
            mud={v.mud}
            detail="parked"
            lightsEnabled={false}
          />
          {t.wheelPositions.map((p, i) =>
            twoWheels && i % 2 ? null : (
              <group
                key={i}
                position={[
                  twoWheels ? 0 : p[0],
                  p[1] - t.suspension.restLength,
                  p[2],
                ]}
              >
                <WheelModel radius={t.wheelRadius} />
              </group>
            ),
          )}
        </>
      )}
    </RigidBody>
  );
}
