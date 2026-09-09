"use client";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SportsCarAsset } from "./WorldAssets";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { LANDMARKS, COW_PEN } from "../lib/landmarks";
import { STORE_LABELS, type StoreId } from "../lib/catalog";
import { nightFactor } from "../lib/dayNight";
import { bar, combine, rounded, type Point } from "./models/modelGeometry";

type Building = {
  id: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  accent: string;
  garage?: boolean;
  home?: boolean;
};
const STORE_STYLE: Record<StoreId, [number, number, string, string]> = {
  dealership: [15, 10, "#c6c6bf", "#28454f"],
  boatDealer: [14, 9, "#c5c8c1", "#294e63"],
  anyStore: [12, 8, "#ae9178", "#334339"],
  huntStore: [12, 8, "#928778", "#3f4938"],
  flyStore: [10, 7, "#c9cbca", "#334951"],
  standStore: [10, 8, "#998573", "#4b5042"],
  saddleShop: [10, 8, "#a68f79", "#654438"],
  bucketShop: [10, 8, "#bcb7a7", "#3b5355"],
  bikeStore: [10, 7, "#c9c7bc", "#37555d"],
};
export const HUB_BUILDINGS: Building[] = [
  ...Object.entries(STORE_LABELS).map(([key, label]) => {
    const id = key as StoreId,
      [width, depth, color, accent] = STORE_STYLE[id];
    return {
      id,
      label,
      ...LANDMARKS[id],
      width,
      depth,
      height: 4.4,
      color,
      accent,
    };
  }),
  {
    id: "garage",
    label: "HANK'S GARAGE",
    ...LANDMARKS.garage,
    width: 16,
    depth: 12,
    height: 5.2,
    color: "#9e7462",
    accent: "#343e3f",
    garage: true,
  },
  {
    id: "customGarage",
    label: "CUSTOM WORKS",
    ...LANDMARKS.customGarage,
    width: 13,
    depth: 10,
    height: 4.6,
    color: "#aaa69b",
    accent: "#364c54",
    garage: true,
  },
  {
    id: "trophyRoom",
    label: "THE TROPHY LODGE",
    ...LANDMARKS.trophyRoom,
    width: 12,
    depth: 9,
    height: 4.6,
    color: "#a48c70",
    accent: "#3a4b40",
    home: true,
  },
  {
    id: "house",
    label: "HANK'S HOME",
    ...LANDMARKS.house,
    width: 14,
    depth: 10,
    height: 4.8,
    color: "#d5cdbb",
    accent: "#536057",
    home: true,
  },
  {
    id: "farmBarn",
    label: "HANK'S FARM",
    x: COW_PEN.x,
    z: COW_PEN.z - 14,
    width: 12,
    depth: 8,
    height: 4.2,
    color: "#925b49",
    accent: "#e0d4b8",
    garage: true,
  },
];
const signCache = new Map<string, THREE.CanvasTexture>();
/** Device-local system font is rasterized once; no font CDN or runtime text service. */
function signTexture(label: string, accent: string) {
  const key = label + accent;
  if (signCache.has(key)) return signCache.get(key)!;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = accent;
  x.fillRect(0, 0, 1024, 128);
  x.strokeStyle = "#d4ccb7";
  x.lineWidth = 3;
  x.strokeRect(10, 10, 1004, 108);
  x.font = "700 62px Arial, Helvetica, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = "#fff4dc";
  x.fillText(label.toUpperCase(), 512, 68, 945);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  signCache.set(key, t);
  return t;
}
const geometryCache = new Map<string, Record<string, THREE.BufferGeometry>>();
function architecture(b: Building) {
  const { width: w, depth: d, height: h } = b,
    door = b.garage ? 5 : 2.5,
    side = (w - door) / 2;
  const p: Record<string, THREE.BufferGeometry[]> = {
    wall: [],
    trim: [],
    roof: [],
    glass: [],
    metal: [],
    wood: [],
  };
  const box = (m: string, size: Point, pos: Point) =>
    p[m].push(new THREE.BoxGeometry(...size).translate(...pos));
  // Back and side walls are actual hollow shells, with front glass on solid knee walls.
  box("wall", [w, h, 0.25], [0, h / 2, -d / 2]);
  for (const s of [-1, 1]) box("wall", [0.25, h, d], [(s * w) / 2, h / 2, 0]);
  for (const s of [-1, 1]) {
    const center = s * (door / 2 + side / 2);
    box("wall", [side, 1, d * 0.035], [center, 0.5, d / 2]);
    box("wall", [side, h - 3, 0.25], [center, (h + 3) / 2, d / 2]);
    box("glass", [side - 0.22, 1.88, 0.05], [center, 2, d / 2 + 0.01]);
    for (const x of [(s * door) / 2, s * (w / 2 - 0.08), center])
      box("metal", [0.07, 3, 0.09], [x, 1.5, d / 2 + 0.055]);
    box("metal", [side, 0.07, 0.09], [center, 1, d / 2 + 0.055]);
    box("metal", [side, 0.07, 0.09], [center, 3, d / 2 + 0.055]);
    // Window lintels, downpipes and front bollards establish real-world scale.
    box(
      "trim",
      [0.16, h + 0.15, 0.18],
      [s * (w / 2 + 0.04), h / 2, d / 2 + 0.06],
    );
    p.metal.push(
      bar(
        [s * (w / 2 - 0.22), 0.1, -d / 2 - 0.17],
        [s * (w / 2 - 0.22), h, -d / 2 - 0.17],
        0.048,
      ),
    );
    if (!b.home)
      p.metal.push(
        bar(
          [s * (door / 2 + 0.5), 0, d / 2 + 1],
          [s * (door / 2 + 0.5), 0.9, d / 2 + 1],
          0.065,
        ),
      );
    box("wood", [1.1, 0.45, 0.85], [s * (w / 2 - 1.15), 0.22, d / 2 + 1]);
  }
  box("wall", [door, h - 3, 0.25], [0, (h + 3) / 2, d / 2]);
  box("trim", [w + 0.45, 0.15, d + 0.4], [0, h, 0]);
  if (b.home || b.id === "farmBarn") {
    const rise = 1.65,
      angle = Math.atan2(rise, w / 2 + 0.4),
      length = Math.hypot(w / 2 + 0.4, rise);
    for (const s of [-1, 1])
      p.roof.push(
        rounded(
          [length, 0.17, d + 0.9],
          [s * (w / 4 + 0.2), h + rise / 2, 0],
          0.01,
          [0, 0, -s * angle],
        ),
      );
    // Triangular gable closes the attic; roof cannot be mistaken for an open tent.
    for (const z of [-d / 2, d / 2]) {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(0, rise);
      shape.closePath();
      p.wall.push(
        new THREE.ExtrudeGeometry(shape, {
          depth: 0.15,
          bevelEnabled: false,
        }).translate(0, h, z - 0.075),
      );
    }
    box("wall", [0.85, 1.8, 0.85], [w * 0.27, h + 1, -d * 0.2]);
  } else {
    box("roof", [w + 0.3, 0.15, d + 0.3], [0, h + 0.15, 0]);
    box("metal", [1.3, 0.8, 1.7], [w * 0.25, h + 0.6, -d * 0.2]);
    for (let i = 0; i < 8; i++)
      box(
        "trim",
        [1.32, 0.035, 1.72],
        [w * 0.25, h + 0.25 + i * 0.09, -d * 0.2],
      );
  }
  // Concrete apron has a flush entry. No closed door collider blocks walking inside.
  box("trim", [w + 0.6, 0.07, d + 2.5], [0, 0.035, 0.7]);
  box("metal", [w + 0.35, 0.08, 1.15], [0, 3.12, d / 2 + 0.5]);
  if (b.garage)
    for (let i = 0; i < 4; i++)
      box("metal", [door, 0.055, 0.1], [0, 3.05 + i * 0.19, d / 2]);
  // Real facade courses with restrained relief, merged into one draw call.
  for (let y = 0.3; y < h; y += 0.32)
    for (const s of [-1, 1])
      box("trim", [0.014, 0.01, d - 0.1], [s * (w / 2 + 0.132), y, 0]);
  return Object.fromEntries(
    Object.entries(p)
      .filter(([, a]) => a.length)
      .map(([key, a]) => [key, combine(a)]),
  );
}
function Shell({ building: b, night }: { building: Building; night: number }) {
  const parts = useMemo(() => {
    if (!geometryCache.has(b.id)) geometryCache.set(b.id, architecture(b));
    return geometryCache.get(b.id)!;
  }, [b]);
  const sign = useMemo(
    () => signTexture(b.label, b.accent),
    [b.label, b.accent],
  );
  const door = b.garage ? 5 : 2.5,
    side = (b.width - door) / 2;
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[b.x, 2, b.z]}
      name={`building-${b.id}`}
    >
      <CuboidCollider
        args={[b.width / 2, b.height / 2, 0.14]}
        position={[0, b.height / 2, -b.depth / 2]}
      />
      {[-1, 1].map((s) => (
        <group key={s}>
          <CuboidCollider
            args={[0.14, b.height / 2, b.depth / 2]}
            position={[(s * b.width) / 2, b.height / 2, 0]}
          />
          <CuboidCollider
            args={[side / 2, b.height / 2, 0.14]}
            position={[s * (door / 2 + side / 2), b.height / 2, b.depth / 2]}
          />
        </group>
      ))}
      <CuboidCollider
        args={[door / 2, (b.height - 3) / 2, 0.14]}
        position={[0, (b.height + 3) / 2, b.depth / 2]}
      />
      {/* Camera obstruction must include the canopy projecting beyond the front wall. */}
      <CuboidCollider
        args={[(b.width + 0.35) / 2, 0.04, 0.575]}
        position={[0, 3.12, b.depth / 2 + 0.5]}
      />
      {Object.entries(parts).map(([key, g]) => (
        <mesh
          key={key}
          geometry={g}
          castShadow
          receiveShadow={key !== "glass"}
          dispose={null}
        >
          <meshStandardMaterial
            color={
              {
                wall: b.color,
                trim: "#ada99d",
                roof: "#444b47",
                glass: "#526b6c",
                metal: b.accent,
                wood: "#625c49",
              }[key]
            }
            roughness={key === "glass" ? 0.18 : key === "metal" ? 0.48 : 0.92}
            metalness={key === "glass" ? 0.55 : key === "metal" ? 0.35 : 0}
            emissive={key === "glass" ? "#c59f62" : "#000000"}
            emissiveIntensity={night * 0.35}
          />
        </mesh>
      ))}
      <mesh position={[0, b.height - 0.58, b.depth / 2 + 0.145]}>
        <planeGeometry args={[b.width - 0.7, 0.92]} />
        <meshStandardMaterial
          map={sign}
          roughness={0.75}
          emissive="#ffffff"
          emissiveMap={sign}
          emissiveIntensity={night * 0.5}
        />
      </mesh>
      <BuildingInterior kind={b.id} width={b.width} depth={b.depth} />
      {b.id === "dealership" && <ShowroomCar x={b.x} z={b.z} />}
    </RigidBody>
  );
}
/** Heavy licensed hero asset loads only when the dealership is approached on foot. */
function ShowroomCar({ x, z }: { x: number; z: number }) {
  const [near, setNear] = useState(false);
  useFrame(({ camera }) => {
    const distance = Math.hypot(camera.position.x - x, camera.position.z - z);
    const next = distance < (near ? 35 : 22);
    if (next !== near) setNear(next);
  });
  return near ? (
    <SportsCarAsset position={[3.8, 0.08, -0.5]} scale={0.85} />
  ) : null;
}
/** Permanently visible geometry; root owns interior interaction and state. */
export function BuildingInterior({
  kind,
  width = 10,
  depth = 8,
}: {
  kind: string;
  width?: number;
  depth?: number;
}) {
  const geometry = useMemo(() => {
    const a: THREE.BufferGeometry[] = [];
    if (kind === "house") {
      a.push(
        rounded([3, 0.45, 1.25], [-width * 0.26, 0.55, -depth * 0.22], 0.08),
        rounded(
          [3, 0.75, 0.25],
          [-width * 0.26, 0.88, -depth * 0.22 - 0.5],
          0.04,
        ),
        rounded([1.4, 0.5, 0.8], [0, 0.25, 0], 0.04),
      );
    } else if (
      kind === "garage" ||
      kind === "customGarage" ||
      kind === "farmBarn"
    ) {
      a.push(
        rounded([width * 0.65, 0.2, 0.75], [0, 1, -depth / 2 + 0.6], 0.02),
      );
      for (const s of [-1, 1])
        a.push(
          rounded(
            [0.8, 1.5, 0.6],
            [s * (width / 2 - 0.75), 0.75, -depth / 2 + 1],
            0.02,
          ),
        );
    } else {
      a.push(
        rounded(
          [width * 0.45, 1, 0.7],
          [-width * 0.15, 0.5, -depth * 0.22],
          0.02,
        ),
      );
      for (const s of [-1, 1])
        for (let j = 0; j < 3; j++)
          a.push(
            rounded(
              [0.6, 0.08, depth * 0.55],
              [s * (width / 2 - 0.55), 0.6 + j * 0.6, -0.3],
              0.01,
            ),
          );
    }
    return combine(a);
  }, [kind, width, depth]);
  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial
        color={kind === "house" ? "#656c5d" : "#7d705b"}
        roughness={0.85}
      />
    </mesh>
  );
}
function YardStructures() {
  const wash = LANDMARKS.carWash,
    dog = LANDMARKS.dogHouse;
  const washSign = useMemo(() => signTexture("CAR WASH", "#355b64"), []);
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[wash.x, 2, wash.z]}>
        {[-1, 1].map((s) => (
          <group key={s}>
            <CuboidCollider args={[0.3, 2.5, 5]} position={[s * 3.8, 2.5, 0]} />
            <mesh position={[s * 3.8, 2.5, 0]} castShadow>
              <boxGeometry args={[0.6, 5, 10]} />
              <meshStandardMaterial color="#a8b4b2" roughness={0.8} />
            </mesh>
            <mesh position={[s * 3.25, 2.1, 0]}>
              <cylinderGeometry args={[0.45, 0.45, 3.1, 20]} />
              <meshStandardMaterial color="#477a84" roughness={1} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 5, 0]} castShadow>
          <boxGeometry args={[8.4, 0.3, 10.6]} />
          <meshStandardMaterial color="#36525a" />
        </mesh>
        <mesh position={[0, 4.5, 5.32]}>
          <planeGeometry args={[7, 0.9]} />
          <meshStandardMaterial map={washSign} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[dog.x, 2, dog.z]}>
        <CuboidCollider args={[1, 0.7, 0.1]} position={[0, 0.7, -1]} />
        {[-1, 1].map((s) => (
          <group key={s}>
            <CuboidCollider args={[0.1, 0.7, 1]} position={[s, 0.7, 0]} />
            <mesh position={[s, 0.7, 0]} castShadow>
              <boxGeometry args={[0.16, 1.4, 2]} />
              <meshStandardMaterial color="#927557" />
            </mesh>
            <mesh
              position={[s * 0.52, 1.65, 0]}
              rotation={[0, 0, -s * 0.45]}
              castShadow
            >
              <boxGeometry args={[1.25, 0.12, 2.3]} />
              <meshStandardMaterial color="#424c43" />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.7, -1]}>
          <boxGeometry args={[2, 1.4, 0.15]} />
          <meshStandardMaterial color="#927557" />
        </mesh>
      </RigidBody>
    </>
  );
}
export function Buildings({ timeOfDay }: { timeOfDay: number }) {
  const night = nightFactor(timeOfDay);
  return (
    <group>
      {HUB_BUILDINGS.map((b) => (
        <Shell key={b.id} building={b} night={night} />
      ))}
      <YardStructures />
    </group>
  );
}
export default Buildings;
