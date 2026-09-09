"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { bar, combine } from "./modelGeometry";
import { trailerLength } from "../../lib/activities";
import { useFourWheeler3dStore } from "../../lib/store";
import { tuningFor } from "../../lib/vehicles";
import { isWaterVehicle } from "../../lib/catalog";
import { VehicleModel } from "./index";
import { TransportModel } from "./TransportModel";
import type { FleetVehicle } from "../../lib/adventureTypes";
export function TrailerModel({ vehicle: v }: { vehicle: FleetVehicle }) {
  const fleet = useFourWheeler3dStore((s) => s.progress.adventure.fleet);
  const length = trailerLength(v),
    width = v.type === "megatrailer" ? 2.5 : 2.1;
  const geometry = useMemo(() => {
    const frame: THREE.BufferGeometry[] = [],
      deck: THREE.BufferGeometry[] = [];
    const box = (
      list: THREE.BufferGeometry[],
      s: [number, number, number],
      p: [number, number, number],
    ) => list.push(new THREE.BoxGeometry(...s).translate(...p));
    for (const x of [-width / 2, width / 2]) {
      frame.push(bar([x, 0, -length / 2], [x, 0, length / 2], 0.055));
      frame.push(bar([x, 0, length / 2], [0, 0, length / 2 + 0.75], 0.045));
    }
    if (v.type === "plow") {
      box(frame, [2.5, 0.85, 0.15], [0, 0.4, 0]);
    } else if (v.type === "boattrailer") {
      for (const s of [-1, 1])
        box(deck, [0.14, 0.14, length * 0.75], [s * 0.65, 0.1, 0]);
      for (let i = 0; i < 5; i++)
        frame.push(
          bar(
            [-width / 2, 0, -length / 2 + (i * length) / 4],
            [width / 2, 0, -length / 2 + (i * length) / 4],
            0.04,
          ),
        );
    } else
      for (let i = 0; i < Math.ceil(length / 0.25); i++)
        box(
          deck,
          [width, 0.07, 0.23],
          [0, 0.07, -length / 2 + i * 0.25 + 0.125],
        );
    if (v.type === "mower") {
      box(frame, [width, 0.32, length], [0, 0.18, 0]);
      box(deck, [0.55, 0.45, 0.6], [0, 0.5, 0]);
    }
    if (v.capacity > 1 && v.cargo.length > Math.ceil(v.capacity / 2)) {
      box(frame, [width, 0.07, length], [0, 1.5, 0]);
      for (const x of [-width / 2, width / 2])
        for (const z of [-length / 2, length / 2])
          frame.push(bar([x, 0, z], [x, 1.5, z], 0.04));
    }
    if (v.type === "camper") {
      box(deck, [width, 2.3, length], [0, 1.2, 0]);
      box(frame, [width + 0.05, 0.1, length + 0.05], [0, 2.4, 0]);
    }
    return { frame: combine(frame), deck: combine(deck) };
  }, [v.type, v.capacity, v.cargo.length, length, width]);
  return (
    <group name={`trailer-${v.type}`}>
      <mesh geometry={geometry.frame} castShadow>
        <meshStandardMaterial
          color={new THREE.Color("#6e7673").lerp(
            new THREE.Color("#51412a"),
            v.mud * 0.7,
          )}
          metalness={0.75}
          roughness={0.42}
        />
      </mesh>
      <mesh geometry={geometry.deck} castShadow>
        <meshStandardMaterial
          color={
            v.type === "mower"
              ? "#496e3b"
              : v.type === "camper"
                ? "#ded9c8"
                : "#84715b"
          }
          roughness={0.85}
        />
      </mesh>
      {v.type !== "plow" &&
        [-1, 1].map((s) => (
          <mesh
            key={s}
            position={[(s * width) / 2, -0.2, -length * 0.15]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.36, 0.36, 0.22, 20]} />
            <meshStandardMaterial color="#262b28" roughness={0.95} />
          </mesh>
        ))}
      {v.type === "camper" &&
        [-1, 1].map((s) => (
          <mesh key={s} position={[s * (width / 2 + 0.008), 1.6, 0]}>
            <boxGeometry args={[0.016, 0.6, length * 0.45]} />
            <meshStandardMaterial
              color="#344e58"
              metalness={0.4}
              roughness={0.2}
            />
          </mesh>
        ))}
      {v.cargo.map((id, i) =>
        fleet[id] ? (
          <Cargo
            key={id}
            vehicle={fleet[id]}
            index={i}
            capacity={v.capacity}
            length={length}
          />
        ) : null,
      )}
    </group>
  );
}

function Cargo({
  vehicle: v,
  index,
  capacity,
  length,
}: {
  vehicle: FleetVehicle;
  index: number;
  capacity: number;
  length: number;
}) {
  const t = tuningFor(v.type),
    rows = capacity > 1 ? Math.ceil(capacity / 2) : 1,
    spacing = length / rows,
    scale = Math.min(
      1,
      (spacing * 0.85) / t.chassis.length,
      1.9 / t.chassis.width,
    );
  const wheels = useMemo(
    () =>
      combine(
        t.wheelPositions.map((p) =>
          new THREE.CylinderGeometry(t.wheelRadius, t.wheelRadius, 0.23, 12)
            .rotateZ(Math.PI / 2)
            .translate(p[0], p[1] - t.suspension.restLength, p[2]),
        ),
      ),
    [t],
  );
  return (
    <group
      position={[
        0,
        0.1 + Math.floor(index / rows) * 1.5,
        -length / 2 + spacing * ((index % rows) + 0.5),
      ]}
      scale={scale}
    >
      <group
        position={[
          0,
          t.chassis.height / 2 + t.wheelRadius + t.suspension.restLength,
          0,
        ]}
      >
        {isWaterVehicle(v.type) ? (
          <TransportModel type={v.type} paint={v.paint} />
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
            <mesh geometry={wheels}>
              <meshStandardMaterial color="#262b29" roughness={0.9} />
            </mesh>
          </>
        )}
      </group>
    </group>
  );
}
