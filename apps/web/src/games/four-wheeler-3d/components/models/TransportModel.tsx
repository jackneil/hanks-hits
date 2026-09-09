"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { isWatercraft, transportTuning } from "../../lib/transport";

export type TransportModelProps = {
  type: string;
  paint?: string;
  running?: boolean;
  netDeployed?: boolean;
  lightsOn?: boolean;
  canopyOpen?: boolean;
};

function Box({
  size,
  at,
  color,
  metalness = 0,
}: {
  size: [number, number, number];
  at: [number, number, number];
  color: string;
  metalness?: number;
}) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={metalness ? 0.35 : 0.75}
        metalness={metalness}
      />
    </mesh>
  );
}

function BoatModel({
  type,
  paint = "#d8e3e4",
  netDeployed = false,
  lightsOn = false,
  canopyOpen = false,
}: TransportModelProps) {
  const { length: l, width: w, deckHeight: deck } = transportTuning(type);
  const yacht = type === "yacht";
  const working = ["fishingboat", "minifishingboat", "tugboat"].includes(type);
  const geometry = useMemo(() => {
    const outline = new THREE.Shape();
    outline.moveTo(-w * 0.4, -l * 0.5);
    outline.lineTo(w * 0.4, -l * 0.5);
    outline.quadraticCurveTo(w * 0.58, l * 0.18, 0, l * 0.5);
    outline.quadraticCurveTo(-w * 0.58, l * 0.18, -w * 0.4, -l * 0.5);
    const hull = new THREE.ExtrudeGeometry(outline, {
      depth: deck + 0.35,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.045,
      bevelThickness: 0.045,
      curveSegments: 12,
    });
    hull.rotateX(Math.PI / 2).translate(0, deck, 0);
    return hull;
  }, [w, l, deck]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group name={`boat-${type}`}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={type === "canoe" ? "#946344" : paint}
          roughness={0.4}
          clearcoat={0.35}
        />
      </mesh>
      <Box
        size={[w * 0.7, 0.06, l * 0.7]}
        at={[0, deck + 0.04, -l * 0.035]}
        color={yacht ? "#ad875b" : "#c6c9be"}
      />
      {type === "pontoon" &&
        [-1, 1].map((side) => (
          <group key={side}>
            <mesh
              position={[side * w * 0.4, -0.05, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            >
              <capsuleGeometry args={[0.38, l - 0.8, 8, 16]} />
              <meshStandardMaterial
                color="#b3bfc0"
                metalness={0.75}
                roughness={0.35}
              />
            </mesh>
            <Box
              size={[0.45, 0.45, l * 0.55]}
              at={[side * w * 0.3, deck + 0.25, 0]}
              color="#e1d8c7"
            />
          </group>
        ))}
      {type === "canoe" ? (
        <>
          {[-0.25, 0.22].map((z) => (
            <Box
              key={z}
              size={[w * 0.65, 0.08, 0.25]}
              at={[0, deck + 0.1, z * l]}
              color="#4e392b"
            />
          ))}
        </>
      ) : type === "jetski" ? (
        <>
          <Box
            size={[0.4, 0.2, 1]}
            at={[0, deck + 0.12, -0.25]}
            color="#273138"
          />
          <Box
            size={[0.68, 0.1, 0.16]}
            at={[0, deck + 0.35, 0.45]}
            color="#232b2d"
          />
        </>
      ) : (
        <>
          <Box
            size={[w * 0.26, 0.6, 0.6]}
            at={[w * 0.18, deck + 0.3, l * 0.05]}
            color="#e7ece8"
          />
          <Box
            size={[0.55, 0.45, 0.5]}
            at={[w * 0.18, deck + 0.27, -l * 0.06]}
            color="#5c7279"
          />
        </>
      )}
      {(working || yacht) && (
        <group>
          <Box
            size={[w * 0.72, yacht ? 2.1 : 1.4, l * 0.35]}
            at={[0, deck + (yacht ? 1.05 : 0.7), l * 0.08]}
            color="#e9eeeb"
          />
          <Box
            size={[w * 0.76, 0.18, l * 0.39]}
            at={[0, deck + (yacht ? 2.2 : 1.5), l * 0.08]}
            color="#f3f4ec"
          />
          <Box
            size={[w * 0.73, 0.6, l * 0.22]}
            at={[0, deck + (yacht ? 1.45 : 0.9), l * 0.12]}
            color="#264752"
            metalness={0.25}
          />
          <Box
            size={[0.5, 0.3, 0.5]}
            at={[0, deck + (yacht ? 2.45 : 1.7), l * 0.1]}
            color="#d3d6d3"
          />
        </group>
      )}
      {yacht && (
        <>
          <Box
            size={[w * 0.53, 1.5, l * 0.23]}
            at={[0, deck + 2.9, l * 0.1]}
            color="#e9eeeb"
          />
          <Box
            size={[w * 0.54, 0.5, l * 0.17]}
            at={[0, deck + 3.1, l * 0.1]}
            color="#254956"
            metalness={0.3}
          />
          <Box
            size={[w * 0.58, 0.15, l * 0.25]}
            at={[0, deck + 3.75, l * 0.1]}
            color="#f1f0e7"
          />
          <mesh
            position={[0, deck + 0.09, -l * 0.27]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[w * 0.28, 32]} />
            <meshStandardMaterial color="#496875" />
          </mesh>
          <Box
            size={[w * 0.55, 0.02, 0.12]}
            at={[0, deck + 0.105, -l * 0.27]}
            color="#f0ebe0"
          />
          <group position={[w * 0.34, deck + 0.15, -l * 0.1]} scale={0.6}>
            <TransportModel type="jetski" paint="#d7b443" />
          </group>
          <group position={[-w * 0.34, deck + 0.15, -l * 0.15]} scale={0.45}>
            <TransportModel type="minifishingboat" paint="#eee9d9" />
          </group>
          <group position={[0, deck + 0.3, -l * 0.28]} scale={0.36}>
            <TransportModel type="heli" paint="#d2dbe0" />
          </group>
        </>
      )}
      {type === "sailboat" && (
        <>
          <mesh position={[0, deck + 4, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.07, 8, 10]} />
            <meshStandardMaterial color="#bbc5c5" metalness={0.6} />
          </mesh>
          <mesh
            position={[0.04, deck + 4.4, -0.8]}
            rotation={[0, Math.PI / 2, 0]}
            castShadow
          >
            <circleGeometry args={[3.6, 3, 0, Math.PI * 2]} />
            <meshStandardMaterial color="#f4ead3" side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
      {(type === "pontoon" || yacht) && !canopyOpen && (
        <Box
          size={[w * 0.8, 0.08, l * 0.3]}
          at={[0, deck + (yacht ? 4.3 : 1.8), -l * 0.05]}
          color="#384e56"
        />
      )}
      {type !== "canoe" && type !== "sailboat" && (
        <Box
          size={[w * 0.25, 0.8, 0.4]}
          at={[0, 0.1, -l * 0.51]}
          color="#283238"
        />
      )}
      {(working || yacht || type === "pontoon") &&
        [-1, 1].map((side) => (
          <group key={side}>
            <Box
              size={[0.04, 0.04, l * 0.78]}
              at={[side * w * 0.4, deck + 0.7, -l * 0.03]}
              color="#b4c4c5"
              metalness={0.8}
            />
            {[-0.35, -0.15, 0.05, 0.25].map((z) => (
              <Box
                key={z}
                size={[0.035, 0.7, 0.035]}
                at={[side * w * 0.4, deck + 0.35, z * l]}
                color="#b4c4c5"
                metalness={0.8}
              />
            ))}
            {netDeployed && (
              <mesh
                position={[side * w * 0.6, -0.1, -l * 0.22]}
                rotation={[0, 0, side * 0.5]}
              >
                <planeGeometry args={[2.5, 3, 8, 10]} />
                <meshStandardMaterial
                  color="#bcab77"
                  wireframe
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}
            <mesh position={[side * w * 0.4, deck + 0.5, l * 0.3]}>
              <sphereGeometry args={[0.07, 8, 6]} />
              <meshStandardMaterial
                color={side < 0 ? "#ca352d" : "#449a5a"}
                emissive={side < 0 ? "#ca352d" : "#449a5a"}
                emissiveIntensity={lightsOn ? 3 : 0.3}
              />
            </mesh>
          </group>
        ))}
    </group>
  );
}

function AircraftModel({
  type,
  paint = "#deded5",
  running = false,
}: TransportModelProps) {
  const tune = transportTuning(type);
  const l = tune.length;
  const w = tune.width;
  const rotor = useRef<THREE.Group>(null);
  const tailRotor = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!running) return;
    if (rotor.current) {
      if (tune.helicopter) rotor.current.rotation.y += dt * 35;
      else rotor.current.rotation.z += dt * 45;
    }
    if (tailRotor.current) tailRotor.current.rotation.x += dt * 45;
  });
  return (
    <group name={`aircraft-${type}`}>
      <mesh scale={[l * 0.085, l * 0.075, l * 0.42]} castShadow>
        <sphereGeometry args={[1, 24, 16]} />
        <meshPhysicalMaterial
          color={paint}
          metalness={0.18}
          roughness={0.35}
          clearcoat={0.5}
        />
      </mesh>
      <mesh
        position={[0, l * 0.065, l * 0.12]}
        scale={[l * 0.075, l * 0.07, l * 0.16]}
        castShadow
      >
        <sphereGeometry args={[1, 20, 12]} />
        <meshStandardMaterial color="#254c60" metalness={0.4} roughness={0.2} />
      </mesh>
      {tune.helicopter ? (
        <>
          <mesh
            position={[0, 0.15, -l * 0.36]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.12, 0.27, l * 0.5, 12]} />
            <meshStandardMaterial color={paint} />
          </mesh>
          <group ref={rotor} position={[0, l * 0.12, 0]}>
            <Box size={[w, 0.045, 0.2]} at={[0, 0, 0]} color="#30393c" />
            <Box size={[0.2, 0.045, w]} at={[0, 0.01, 0]} color="#30393c" />
          </group>
          <group ref={tailRotor} position={[0.17, 0.2, -l * 0.59]}>
            <Box size={[0.04, 1.2, 0.12]} at={[0, 0, 0]} color="#334047" />
            <Box size={[0.04, 0.12, 1.2]} at={[0, 0, 0]} color="#334047" />
          </group>
          {[-1, 1].map((side) => (
            <group key={side}>
              <Box
                size={[0.09, 0.09, l * 0.5]}
                at={[side * l * 0.09, -l * 0.1, 0.04]}
                color="#434a4b"
                metalness={0.6}
              />
              {[-1, 1].map((z) => (
                <Box
                  key={z}
                  size={[0.07, l * 0.1, 0.07]}
                  at={[side * l * 0.07, -l * 0.055, z * l * 0.14]}
                  color="#434a4b"
                  metalness={0.6}
                />
              ))}
            </group>
          ))}
        </>
      ) : (
        <>
          <group rotation={[0, type === "jet" ? 0.06 : 0, 0]}>
            <Box
              size={[w, 0.09, l * 0.17]}
              at={[0, 0.05, -0.03]}
              color={paint}
            />
          </group>
          {type === "biplane" && (
            <>
              <Box size={[w, 0.09, l * 0.17]} at={[0, 1, 0.15]} color={paint} />
              {[-1, 1].map((side) => (
                <Box
                  key={side}
                  size={[0.055, 1, 0.055]}
                  at={[side * w * 0.37, 0.5, 0.15]}
                  color="#40494a"
                />
              ))}
            </>
          )}
          <Box
            size={[w * 0.35, 0.07, l * 0.13]}
            at={[0, 0.12, -l * 0.36]}
            color={paint}
          />
          <Box
            size={[0.09, l * 0.15, l * 0.14]}
            at={[0, l * 0.075, -l * 0.36]}
            color={paint}
          />
          {type !== "jet" && (
            <group ref={rotor} position={[0, 0, l * 0.43]}>
              <Box
                size={[0.12, l * 0.32, 0.06]}
                at={[0, 0, 0]}
                color="#353b3e"
              />
            </group>
          )}
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * l * 0.085, -l * 0.095, -l * 0.01]}
              rotation={[0, Math.PI / 2, 0]}
              castShadow
            >
              <torusGeometry args={[l * 0.027, l * 0.012, 8, 16]} />
              <meshStandardMaterial color="#252a28" />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

/** Also exported for parked fleet rendering; moving propellers only run for the active craft. */
export function TransportModel(props: TransportModelProps) {
  return isWatercraft(props.type) ? (
    <BoatModel {...props} />
  ) : (
    <AircraftModel {...props} />
  );
}

export default TransportModel;
