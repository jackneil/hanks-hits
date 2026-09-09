"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { bar, combine, rounded, type Point } from "./modelGeometry";
import { BIKES } from "../../lib/catalog";
import { RiderModel } from "./RiderModel";
import type { VehicleModelProps } from "./AtvModel";

type Parts = Record<string, THREE.BufferGeometry[]>;
// Geometry passed by prop stays cached; child materials retain normal R3F disposal.
const CACHE = new Map<string, Record<string, THREE.BufferGeometry>>();
/** Longitudinal coachwork sections: z, half-width, sill, roof. */
function body(sections: number[][]) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [z, w, b, t] of sections)
    vertices.push(-w, b, z, w, b, z, w, t, z, -w, t, z);
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < 4; j++) {
      const a = i * 4 + j,
        b = i * 4 + ((j + 1) % 4);
      indices.push(a, b, b + 4, a, b + 4, a + 4);
    }
  indices.push(0, 2, 1, 0, 3, 2);
  const n = vertices.length / 3 - 4;
  indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      new Float32Array((vertices.length / 3) * 2),
      2,
    ),
  );
  return g;
}
function build(id: string) {
  const p: Parts = {
    paint: [],
    dark: [],
    metal: [],
    glass: [],
    lamp: [],
    red: [],
    seat: [],
  };
  const box = (m: string, s: Point, a: Point, radius = 0) =>
    p[m].push(
      radius
        ? rounded(s, a, radius)
        : new THREE.BoxGeometry(...s).translate(...a),
    );
  const tube = (m: string, a: Point, b: Point, r = 0.015) =>
    p[m].push(bar(a, b, r));
  const bicycle = id === "bike" || BIKES.some(([key]) => key === id);
  if (bicycle || id === "moto") {
    // Coordinates match the centered wheel mounts; thin tubes preserve the open diamond frame.
    const rear: Point = [0, -0.3, -0.72],
      crank: Point = [0, -0.25, -0.05],
      saddle: Point = [0, 0.38, -0.25],
      head: Point = [0, 0.32, 0.44];
    const electric = ["ebike", "emtb", "supere"].includes(id),
      road = id === "road",
      cruiser = id === "cruiser",
      moto = id === "moto";
    tube("paint", rear, saddle, 0.027);
    tube("paint", saddle, crank, 0.029);
    tube("paint", crank, rear, 0.027);
    tube("paint", crank, head, electric ? 0.058 : 0.034);
    tube("paint", cruiser ? [0, 0.05, -0.2] : saddle, head, 0.027);
    for (const x of [-0.075, 0.075]) {
      tube("metal", [x, 0.36, 0.43], [x, -0.3, 0.72], moto ? 0.045 : 0.021);
      tube("metal", [x, -0.25, -0.05], [x, -0.3, -0.72], 0.02);
    }
    tube("metal", saddle, [0, 0.5, -0.27], 0.022);
    box(
      "seat",
      [moto ? 0.3 : 0.2, 0.075, moto ? 0.68 : 0.26],
      [0, 0.5, moto ? -0.25 : -0.3],
    );
    tube("metal", head, [0, 0.55, 0.39], 0.025);
    tube("metal", [-0.3, 0.55, 0.39], [0.3, 0.55, 0.39], 0.02);
    for (const side of [-1, 1]) {
      tube(
        "dark",
        [side * 0.22, 0.55, 0.39],
        [side * 0.32, 0.55, cruiser ? 0.25 : 0.39],
        0.026,
      );
      tube(
        "metal",
        [side * 0.06, -0.25, -0.05],
        [side * 0.13, -0.33, -0.05],
        0.017,
      );
      box("dark", [0.12, 0.03, 0.09], [side * 0.18, -0.33, -0.05]);
      if (road) {
        tube(
          "metal",
          [side * 0.23, 0.55, 0.39],
          [side * 0.23, 0.36, 0.5],
          0.017,
        );
        tube(
          "dark",
          [side * 0.23, 0.36, 0.5],
          [side * 0.23, 0.36, 0.34],
          0.021,
        );
      }
    }
    const chainring = new THREE.CylinderGeometry(0.115, 0.115, 0.02, 24)
      .rotateZ(Math.PI / 2)
      .translate(0.07, -0.25, -0.05);
    p.metal.push(chainring);
    if (electric) box("dark", [0.1, 0.23, 0.45], [0, 0.015, 0.16], 0.04);
    if (id === "bmx" || id === "kids")
      for (const z of [-0.72, 0.72])
        tube("metal", [-0.2, -0.3, z], [0.2, -0.3, z], 0.03);
    if (id === "cruiser" || id === "ebike") {
      box("metal", [0.3, 0.035, 0.43], [0, 0.12, -0.61]);
      for (const s of [-1, 1])
        tube("metal", [s * 0.13, 0.12, -0.61], [s * 0.08, -0.3, -0.72], 0.012);
    }
    if (id === "emtb" || id === "mtb")
      tube("red", [0, 0.04, -0.17], [0, 0.21, 0.14], 0.038);
    if (moto) {
      p.paint.push(
        body([
          [-0.25, 0.17, -0.05, 0.35],
          [0.08, 0.22, -0.04, 0.42],
          [0.42, 0.13, 0.03, 0.27],
        ]),
      );
      box("metal", [0.28, 0.3, 0.35], [0, -0.13, 0]);
      for (let i = 0; i < 7; i++)
        box("dark", [0.31, 0.012, 0.31], [0, -0.23 + i * 0.038, 0]);
      tube("metal", [0.2, -0.24, 0.23], [0.2, -0.2, -0.76], 0.057);
      box("paint", [0.24, 0.08, 0.38], [0, 0.02, 0.65]);
      box("lamp", [0.18, 0.14, 0.065], [0, 0.46, 0.53]);
    }
  } else {
    const pickup = id === "truck" || id === "monster",
      heavy = ["semi", "firetruck", "rv"].includes(id),
      tractor = id === "tractor",
      utv = id === "utv",
      sport = ["lambo", "racecar", "muscle"].includes(id);
    // Normalized chassis envelope X +/- .5, Z +/- .5. Heights are relative to chassis height.
    p.paint.push(
      body([
        [-0.49, 0.44, -0.35, -0.04],
        [-0.33, 0.5, -0.42, 0.02],
        [0.29, 0.49, -0.42, 0.06],
        [0.49, 0.4, -0.32, sport ? -0.03 : 0.02],
      ]),
    );
    box("dark", [0.83, 0.12, 0.88], [0, -0.4, 0]);
    const cabBack = pickup
      ? -0.06
      : heavy
        ? 0.08
        : tractor
          ? -0.25
          : utv
            ? -0.33
            : -0.26;
    const cabFront = heavy ? 0.42 : tractor ? 0.02 : utv ? 0.17 : 0.17;
    const cabHeight = heavy
      ? 0.58
      : tractor
        ? 0.62
        : utv
          ? 0.95
          : sport
            ? 0.35
            : 0.61;
    if (!utv) {
      p.glass.push(
        body([
          [cabBack, 0.38, 0.02, cabHeight * 0.82],
          [cabBack + 0.065, 0.35, 0.03, cabHeight],
          [cabFront - 0.09, 0.34, 0.035, cabHeight],
          [cabFront, 0.41, 0.02, 0.07],
        ]),
      );
      box(
        "paint",
        [0.7, 0.045, Math.max(0.08, cabFront - cabBack - 0.14)],
        [0, cabHeight + 0.02, (cabFront + cabBack) / 2 - 0.015],
      );
    }
    for (const s of [-1, 1]) {
      tube(
        "paint",
        [s * 0.4, 0.02, cabBack],
        [s * 0.35, cabHeight, cabBack + 0.065],
        0.022,
      );
      tube(
        "paint",
        [s * 0.35, cabHeight, cabBack + 0.065],
        [s * 0.34, cabHeight, cabFront - 0.09],
        0.021,
      );
      tube(
        "paint",
        [s * 0.34, cabHeight, cabFront - 0.09],
        [s * 0.41, 0.02, cabFront],
        0.023,
      );
      box(
        "dark",
        [0.018, 0.016, 0.18],
        [s * 0.49, -0.08, (cabBack + cabFront) / 2],
      );
      box("metal", [0.018, 0.025, 0.065], [s * 0.5, -0.01, cabBack + 0.09]);
      tube(
        "dark",
        [s * 0.41, 0.19, cabFront - 0.02],
        [s * 0.55, 0.2, cabFront - 0.02],
        0.014,
      );
      box("paint", [0.1, 0.065, 0.065], [s * 0.56, 0.2, cabFront - 0.02]);
      box("lamp", [0.2, 0.055, 0.027], [s * 0.29, -0.085, 0.493]);
      box("red", [0.15, 0.055, 0.024], [s * 0.32, -0.08, -0.492]);
      box("seat", [0.24, 0.1, 0.2], [s * 0.2, 0.015, (cabBack + cabFront) / 2]);
      box("seat", [0.24, 0.23, 0.06], [s * 0.2, 0.12, cabBack + 0.065]);
    }
    for (let i = 0; i < 7; i++)
      box("metal", [0.42, 0.012, 0.012], [0, -0.23 + i * 0.022, 0.496]);
    box("dark", [0.85, 0.05, 0.03], [0, -0.3, 0.49]);
    if (pickup) {
      box("dark", [0.78, 0.025, 0.33], [0, 0.04, -0.29]);
      for (const s of [-1, 1])
        box("paint", [0.08, 0.22, 0.39], [s * 0.44, 0.08, -0.29]);
      box("paint", [0.9, 0.22, 0.045], [0, 0.08, -0.47]);
      for (let i = 0; i < 9; i++)
        box("dark", [0.017, 0.018, 0.31], [-0.32 + i * 0.08, 0.06, -0.29]);
    }
    if (utv) {
      box("dark", [0.87, 0.05, 0.56], [0, 0.96, -0.07]);
      box("dark", [0.86, 0.05, 0.02], [0, 0.28, 0.2]);
      for (const s of [-1, 1]) {
        tube("dark", [s * 0.46, -0.05, -0.3], [s * 0.46, 0.32, 0.16], 0.025);
        tube("dark", [s * 0.46, 0.32, 0.16], [s * 0.46, -0.05, 0.17], 0.025);
      }
    }
    if (id === "semi") {
      box("paint", [0.88, 0.75, 0.25], [0, 0.33, -0.035]);
      box("dark", [0.75, 0.06, 0.36], [0, -0.14, -0.32]);
      for (const s of [-1, 1]) {
        tube("metal", [s * 0.46, -0.19, -0.07], [s * 0.46, 0.74, -0.07], 0.037);
        box("metal", [0.14, 0.12, 0.21], [s * 0.43, -0.27, -0.21]);
      }
      box("metal", [0.3, 0.035, 0.13], [0, -0.09, -0.3]);
    }
    if (id === "firetruck") {
      box("paint", [0.92, 0.63, 0.53], [0, 0.22, -0.2]);
      for (const s of [-1, 1])
        for (let i = 0; i < 4; i++) {
          box(
            "metal",
            [0.012, 0.36, 0.105],
            [s * 0.47, 0.13, -0.41 + i * 0.12],
          );
          for (let slat = 0; slat < 9; slat++)
            box(
              "dark",
              [0.017, 0.006, 0.1],
              [s * 0.478, -0.02 + slat * 0.037, -0.41 + i * 0.12],
            );
        }
      for (const x of [-0.25, 0.25])
        tube("metal", [x, 0.59, -0.48], [x, 0.59, 0.42], 0.022);
      for (let i = 0; i < 18; i++)
        tube(
          "metal",
          [-0.25, 0.59, -0.45 + i * 0.05],
          [0.25, 0.59, -0.45 + i * 0.05],
          0.011,
        );
      box("red", [0.65, 0.06, 0.05], [0, 0.64, 0.3]);
    }
    if (id === "rv") {
      box("paint", [0.96, 0.86, 0.65], [0, 0.2, -0.16]);
      box("paint", [0.96, 0.15, 0.27], [0, 0.57, 0.28]);
      for (const s of [-1, 1]) {
        for (const z of [-0.3, -0.06])
          box("glass", [0.015, 0.22, 0.16], [s * 0.489, 0.27, z]);
        box("metal", [0.012, 0.025, 0.76], [s * 0.49, -0.08, -0.08]);
      }
      box("dark", [0.016, 0.48, 0.12], [0.491, 0.08, 0.1]);
      box("metal", [0.35, 0.08, 0.15], [0, 0.67, -0.18]);
    }
    if (tractor) {
      box("paint", [0.44, 0.3, 0.48], [0, 0.04, 0.24]);
      tube("dark", [0.14, 0.1, 0.28], [0.14, 0.74, 0.28], 0.025);
      for (const s of [-1, 1])
        box("paint", [0.3, 0.055, 0.37], [s * 0.4, 0.19, -0.28]);
      box("metal", [0.62, 0.035, 0.2], [0, -0.4, -0.47]);
    }
    if (id === "racecar") {
      for (const s of [-1, 1])
        box("dark", [0.025, 0.23, 0.02], [s * 0.31, 0.17, -0.42]);
      box("dark", [1.08, 0.035, 0.13], [0, 0.3, -0.43]);
      box("dark", [1.02, 0.025, 0.13], [0, -0.35, 0.46]);
      for (const s of [-1, 1])
        box("lamp", [0.27, 0.045, 0.013], [s * 0.27, -0.01, 0.49]);
    }
    if (id === "muscle") {
      box("dark", [0.27, 0.11, 0.16], [0, 0.08, 0.32]);
      for (const s of [-1, 1])
        tube(
          "metal",
          [s * 0.35, -0.31, -0.39],
          [s * 0.35, -0.31, -0.53],
          0.035,
        );
    }
    if (id === "lambo") {
      for (const s of [-1, 1]) {
        box("dark", [0.018, 0.13, 0.16], [s * 0.49, -0.06, -0.2]);
        box("lamp", [0.28, 0.018, 0.02], [s * 0.24, 0.025, 0.45]);
      }
      box("dark", [0.84, 0.02, 0.15], [0, 0.05, -0.36]);
    }
    if (id === "monster") {
      for (const s of [-1, 1]) {
        tube("red", [s * 0.3, -0.45, -0.4], [s * 0.3, -0.9, 0.4], 0.035);
        tube("red", [s * 0.3, -0.9, -0.4], [s * 0.3, -0.45, 0.4], 0.035);
      }
      tube("metal", [-0.4, -0.78, 0], [0.4, -0.78, 0], 0.065);
    }
  }
  return Object.fromEntries(
    Object.entries(p)
      .filter(([, g]) => g.length)
      .map(([k, g]) => [k, combine(g)]),
  );
}
export function LandVehicleModel({
  id,
  tuning,
  paint,
  lightsEnabled = true,
  detail = "full",
  mud = 0,
}: VehicleModelProps & { id: string }) {
  const parts = useMemo(() => {
    if (!CACHE.has(id)) CACHE.set(id, build(id));
    return CACHE.get(id)!;
  }, [id]);
  const bike =
    id === "bike" || id === "moto" || BIKES.some(([key]) => key === id);
  const scale: Point = bike
    ? [
        id === "kids" ? 0.8 : 1,
        id === "kids" ? 0.8 : 1,
        tuning.chassis.length / 1.7,
      ]
    : [tuning.chassis.width, tuning.chassis.height, tuning.chassis.length];
  const colors: Record<string, string> = {
    paint: `#${new THREE.Color(paint).lerp(new THREE.Color("#51412a"), mud * 0.75).getHexString()}`,
    dark: "#202729",
    metal: "#a8adae",
    glass: "#283e47",
    lamp: "#fff4d5",
    red: "#c93727",
    seat: "#343633",
  };
  return (
    <group name={`land-vehicle-${id}`} scale={scale}>
      {Object.entries(parts).map(([key, g]) => (
        <mesh key={key} geometry={g} castShadow>
          <meshPhysicalMaterial
            color={colors[key]}
            roughness={
              key === "glass"
                ? 0.12
                : key === "paint"
                  ? 0.32
                  : key === "seat"
                    ? 0.9
                    : 0.46
            }
            metalness={
              key === "metal"
                ? 0.8
                : key === "paint"
                  ? 0.25
                  : key === "glass"
                    ? 0.35
                    : 0.05
            }
            clearcoat={key === "paint" ? 0.7 : 0}
            emissive={key === "lamp" && lightsEnabled ? "#ffe1a1" : "#000000"}
            emissiveIntensity={1.2}
          />
        </mesh>
      ))}
      {bike && detail === "full" && <RiderModel paint={paint} />}
    </group>
  );
}
