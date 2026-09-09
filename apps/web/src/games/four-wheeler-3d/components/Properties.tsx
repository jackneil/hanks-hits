"use client";

import { useEffect, useMemo } from "react";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { AdventureProgress, PlotBuilding } from "../lib/adventureTypes";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { LAND_PLOTS } from "../lib/landmarks";
import { BUILD_PRICES, LAND_UPGRADE_PRICES } from "../lib/catalog";
import { heightAt } from "../lib/terrain";
import { transact } from "../lib/transactions";
import {
  BUILDING_LABELS,
  buildingDimensions,
  canEnterProperty,
  canManageProperty,
  parkPropertyVehicle,
  propertyCommerce,
  propertyElevation,
  propertySize,
  propertySlot,
  retrievePropertyVehicle,
  togglePropertyDoor,
  type PropertyChange,
} from "../lib/property";
import { enterInterior } from "./HomeLife";

function Sign({
  label,
  detail,
  color = "#3e6650",
}: {
  label: string;
  detail?: string;
  color?: string;
}) {
  return (
    <group>
      <mesh position={[0, 1.2, 0]} castShadow>
        <boxGeometry args={[0.17, 2.4, 0.17]} />
        <meshStandardMaterial color="#746047" roughness={1} />
      </mesh>
      <mesh position={[0, 2.45, 0]} castShadow>
        <boxGeometry args={[3.4, 1.5, 0.13]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Html
        position={[0, 2.5, 0.1]}
        center
        distanceFactor={20}
        style={{ pointerEvents: "none" }}
      >
        <div className="w-36 text-center text-xs font-bold text-white">
          <p>{label}</p>
          {detail && <p className="mt-1 text-[10px] font-normal">{detail}</p>}
        </div>
      </Html>
    </group>
  );
}

function Boundary({
  id,
  size,
  owned,
}: {
  id: string;
  size: number;
  owned: boolean;
}) {
  const plot = LAND_PLOTS.find((p) => p.id === id)!;
  const positions = useMemo(() => {
    const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      values: number[] = [];
    for (let side = 0; side < 4; side++)
      for (let i = 0; i < 20; i++)
        for (const f of [i / 20, (i + 1) / 20]) {
          const a = corners[side],
            b = corners[(side + 1) % 4],
            x = plot.x + ((a[0] + (b[0] - a[0]) * f) * size) / 2,
            z = plot.z + ((a[1] + (b[1] - a[1]) * f) * size) / 2;
          values.push(x, heightAt(x, z) + 0.18, z);
        }
    return new Float32Array(values);
  }, [plot, size]);
  return (
    <group name={`${id}-boundary`}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={owned ? "#d6c88c" : "#d2e2bb"} />
      </lineSegments>
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => {
          const px = plot.x + (x * size) / 2,
            pz = plot.z + (z * size) / 2;
          return (
            <group key={`${x}:${z}`} position={[px, heightAt(px, pz), pz]}>
              <mesh position={[0, 0.5, 0]}>
                <boxGeometry args={[0.18, 1, 0.18]} />
                <meshStandardMaterial color="#736149" />
              </mesh>
              <mesh position={[0, 0.98, 0]}>
                <boxGeometry args={[0.2, 0.18, 0.2]} />
                <meshStandardMaterial color="#e0c970" />
              </mesh>
            </group>
          );
        }),
      )}
    </group>
  );
}

function BuildingExterior({
  adventure,
  id,
  building,
}: {
  adventure: AdventureProgress;
  id: string;
  building: PlotBuilding;
}) {
  const center = propertySlot(adventure, id, building.slot)!,
    d = buildingDimensions(building.type),
    elevation = propertyElevation(adventure, id, building.slot);
  const garage = building.type === "garage",
    trophy = building.type === "trophy",
    front = d.depth / 2;
  const roof = useMemo(
    () =>
      garage ? null : new THREE.ConeGeometry(1, 2, 4).rotateY(Math.PI / 4),
    [garage],
  );
  useEffect(() => () => roof?.dispose(), [roof]);
  const colors = garage
    ? ["#8b9289", "#48534f"]
    : trophy
      ? ["#96734e", "#524c39"]
      : building.type === "house-huge"
        ? ["#d3c6ad", "#535a57"]
        : building.type === "house-medium"
          ? ["#afb9ac", "#626952"]
          : ["#c2a37f", "#74533f"];
  const sideWidth = (d.width - d.doorWidth) / 2,
    doorHeight = garage ? 4.6 : 2.6;
  const walls = [
    { x: 0, y: d.height / 2, z: -front, w: d.width, h: d.height, depth: 0.25 },
    {
      x: -d.width / 2,
      y: d.height / 2,
      z: 0,
      w: 0.25,
      h: d.height,
      depth: d.depth,
    },
    {
      x: d.width / 2,
      y: d.height / 2,
      z: 0,
      w: 0.25,
      h: d.height,
      depth: d.depth,
    },
    ...[-1, 1].map((side) => ({
      x: side * (d.doorWidth / 2 + sideWidth / 2),
      y: d.height / 2,
      z: front,
      w: sideWidth,
      h: d.height,
      depth: 0.25,
    })),
    {
      x: 0,
      y: doorHeight + (d.height - doorHeight) / 2,
      z: front,
      w: d.doorWidth,
      h: d.height - doorHeight,
      depth: 0.25,
    },
  ];
  const rampLength = garage ? 12 : 5,
    endHeight = heightAt(center.x, center.z + front + rampLength),
    drop = elevation - endHeight,
    rampAngle = Math.atan2(drop, rampLength);
  return (
    <group
      name={`${id}-${building.slot}-${building.type}`}
      position={[center.x, elevation, center.z]}
    >
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[d.width / 2, 0.2, d.depth / 2]}
          position={[0, -0.2, 0]}
        />
        <mesh position={[0, -0.2, 0]} receiveShadow>
          <boxGeometry args={[d.width, 0.4, d.depth]} />
          <meshStandardMaterial color="#8d8e80" roughness={0.95} />
        </mesh>
        {walls.map((wall, i) => (
          <group key={i}>
            <CuboidCollider
              args={[wall.w / 2, wall.h / 2, wall.depth / 2]}
              position={[wall.x, wall.y, wall.z]}
            />
            <mesh position={[wall.x, wall.y, wall.z]} castShadow receiveShadow>
              <boxGeometry args={[wall.w, wall.h, wall.depth]} />
              <meshStandardMaterial color={colors[0]} roughness={0.9} />
            </mesh>
          </group>
        ))}
        <CuboidCollider
          args={[d.width / 2 + 0.4, 0.15, d.depth / 2 + 0.5]}
          position={[0, d.height + 0.15, 0]}
        />
        <mesh position={[0, d.height + 0.15, 0]} castShadow>
          <boxGeometry args={[d.width + 0.8, 0.3, d.depth + 1]} />
          <meshStandardMaterial color={colors[1]} roughness={0.82} />
        </mesh>
        {!garage && (
          <mesh position={[0, doorHeight / 2, front]}>
            <boxGeometry args={[d.doorWidth - 0.1, doorHeight, 0.12]} />
            <meshStandardMaterial color="#435447" roughness={0.7} />
          </mesh>
        )}
        {!garage && (
          <CuboidCollider
            args={[d.doorWidth / 2, doorHeight / 2, 0.12]}
            position={[0, doorHeight / 2, front]}
          />
        )}
        {garage && !building.doorOpen && (
          <CuboidCollider
            args={[d.doorWidth / 2, doorHeight / 2, 0.12]}
            position={[0, doorHeight / 2, front]}
          />
        )}
        <CuboidCollider
          args={[
            (d.doorWidth + 1.5) / 2,
            0.12,
            Math.hypot(drop, rampLength) / 2,
          ]}
          position={[0, -drop / 2 - 0.12, front + rampLength / 2]}
          rotation={[rampAngle, 0, 0]}
        />
        <mesh
          position={[0, -drop / 2 - 0.12, front + rampLength / 2]}
          rotation={[rampAngle, 0, 0]}
          receiveShadow
        >
          <boxGeometry
            args={[d.doorWidth + 1.5, 0.24, Math.hypot(drop, rampLength)]}
          />
          <meshStandardMaterial color="#a5a293" roughness={1} />
        </mesh>
      </RigidBody>
      {roof && (
        <mesh
          geometry={roof}
          position={[0, d.height + (trophy ? 1.2 : 1.8), 0]}
          scale={[
            (d.width + 1.2) / Math.SQRT2,
            trophy ? 1.2 : 1.8,
            (d.depth + 1.2) / Math.SQRT2,
          ]}
          castShadow
        >
          <meshStandardMaterial color={colors[1]} roughness={0.92} />
        </mesh>
      )}
      {garage ? (
        <>
          <group
            position={[
              0,
              building.doorOpen ? d.height - 0.3 : doorHeight / 2,
              building.doorOpen ? front - 1.8 : front + 0.02,
            ]}
            rotation={[building.doorOpen ? Math.PI / 2 : 0, 0, 0]}
          >
            <mesh>
              <boxGeometry args={[d.doorWidth, doorHeight, 0.16]} />
              <meshStandardMaterial
                color="#657d7d"
                metalness={0.45}
                roughness={0.5}
              />
            </mesh>
            {Array.from({ length: 12 }, (_, i) => (
              <mesh
                key={i}
                position={[0, -doorHeight / 2 + (i * doorHeight) / 12, 0.1]}
              >
                <boxGeometry args={[d.doorWidth - 0.15, 0.025, 0.025]} />
                <meshStandardMaterial color="#3d5356" />
              </mesh>
            ))}
          </group>
          {[-6, 0, 6].flatMap((x) =>
            [-6, 5].map((z) => (
              <group key={`${x}:${z}`} position={[x, 0.02, z]}>
                {[-2.4, 2.4].map((side) => (
                  <mesh
                    key={side}
                    position={[side, 0, 0]}
                    rotation={[-Math.PI / 2, 0, 0]}
                  >
                    <planeGeometry args={[0.08, 8.7]} />
                    <meshStandardMaterial color="#e4d9ad" />
                  </mesh>
                ))}
              </group>
            )),
          )}
          <mesh position={[-d.width / 2 + 1, 1.1, -front + 1]}>
            <boxGeometry args={[1.4, 2.2, 0.7]} />
            <meshStandardMaterial color="#a24b35" />
          </mesh>
        </>
      ) : (
        <>
          {[-1, 1].flatMap((side) =>
            Array.from(
              { length: building.type === "house-huge" ? 3 : 2 },
              (_, i) => (
                <group
                  key={`${side}:${i}`}
                  position={[(side * d.width) / 2, 2.3, -front + 3 + i * 4.5]}
                >
                  <mesh>
                    <boxGeometry args={[0.3, 1.8, 2.1]} />
                    <meshStandardMaterial color="#e4dec6" />
                  </mesh>
                  <mesh position={[side * 0.16, 0, 0]}>
                    <boxGeometry args={[0.025, 1.5, 1.8]} />
                    <meshStandardMaterial
                      color="#789ba6"
                      metalness={0.5}
                      roughness={0.13}
                    />
                  </mesh>
                </group>
              ),
            ),
          )}
          <mesh position={[0, 3.2, front + 1.1]} castShadow>
            <boxGeometry args={[d.doorWidth + 2.2, 0.2, 2.4]} />
            <meshStandardMaterial color={colors[1]} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (d.doorWidth / 2 + 0.6), 1.6, front + 2]}
            >
              <cylinderGeometry args={[0.07, 0.07, 3.2, 8]} />
              <meshStandardMaterial color="#b8ac90" />
            </mesh>
          ))}
        </>
      )}
      <Html
        position={[0, d.height + 1.3, front]}
        center
        distanceFactor={40}
        style={{ pointerEvents: "none" }}
      >
        <div className="whitespace-nowrap rounded bg-slate-950/80 px-3 py-1 text-xs font-bold text-white">
          {BUILDING_LABELS[building.type]}
          {garage
            ? ` · ${building.parkedVehicleIds.length}/6 bays`
            : building.type.startsWith("house")
              ? ` · ${d.rooms} bedroom${d.rooms > 1 ? "s" : ""}`
              : ""}
        </div>
      </Html>
    </group>
  );
}

export function Properties() {
  const adventure = useFourWheeler3dStore((s) => s.progress.adventure),
    mode = useFourWheeler3dStore((s) => s.mode);
  const position = useAdventureSession((s) => s.playerSnapshot);
  useEffect(
    () =>
      useAdventureSession.subscribe((s, previous) => {
        const action = s.action;
        if (
          !action ||
          action.id === previous.action?.id ||
          !action.name.startsWith("property:")
        )
          return;
        const store = useFourWheeler3dStore.getState();
        if (!store.hasStarted || store.isPaused) return;
        const [id, slotText, detail] = (action.payload ?? "").split(":"),
          slot = Number(slotText),
          command = action.name.slice(9),
          a = store.progress.adventure;
        if (!a.plots[id]) {
          store.setHint("Visit a land plot first.");
          return;
        }
        const inside = s.interior?.id === `${id}:${slot}`;
        if (command === "manage") {
          if (canManageProperty(a, id, s.playerSnapshot) || inside)
            s.openPanel("land", id);
          else store.setHint("Walk closer to this property.");
          return;
        }
        if (command === "buy" || command === "upgrade" || command === "build") {
          if (
            command === "build" &&
            (!(detail in BUILD_PRICES) || (slot !== 0 && slot !== 1))
          ) {
            store.setHint("Choose one of the available buildings.");
            return;
          }
          transact((p) =>
            propertyCommerce(
              p,
              id,
              command,
              s.playerSnapshot,
              store.mode,
              slot as 0 | 1,
              detail as PlotBuilding["type"],
            ),
          );
          return;
        }
        if (command === "enter") {
          if (!canEnterProperty(a, id, slot, s.playerSnapshot, store.mode)) {
            store.setHint(
              "Walk to the entrance. Garage doors must be open first.",
            );
            return;
          }
          const building = a.plots[id].buildings.find((b) => b.slot === slot)!;
          enterInterior(
            `${id}:${slot}`,
            building.type,
            buildingDimensions(building.type).rooms,
          );
          return;
        }
        let result: PropertyChange;
        if (command === "door")
          result = togglePropertyDoor(
            a,
            id,
            slot,
            s.playerSnapshot,
            store.mode,
          );
        else if (command === "park")
          result = parkPropertyVehicle(
            a,
            id,
            slot,
            s.playerSnapshot,
            store.mode,
            s.playerSnapshot.speed,
          );
        else if (command === "retrieve")
          result = retrievePropertyVehicle(
            a,
            id,
            slot,
            detail,
            s.playerSnapshot,
            store.mode,
            s.interior?.id,
          );
        else return;
        if (!result.ok) {
          store.setHint(result.message);
          return;
        }
        store.updateProgress((p) => ({
          ...p,
          adventure: result.adventure,
          ...(command === "retrieve" && result.vehicleId
            ? {
                currentVehicle: result.adventure.fleet[result.vehicleId].type,
                paint: result.adventure.fleet[result.vehicleId].paint,
              }
            : {}),
        }));
        store.setHint(result.message);
        if (result.position) {
          useAdventureSession.setState({ interior: null, scope: false });
          s.openPanel(null);
          store.setMode(command === "retrieve" ? "vehicle" : "foot");
          s.relocate(result.position, 0);
        }
      }),
    [],
  );
  if (["space", "planet", "interior"].includes(mode)) return null;
  return (
    <group name="purchased-properties">
      {LAND_PLOTS.filter(
        (p) => Math.hypot(p.x - position.x, p.z - position.z) < 460,
      ).map((plot) => {
        const p = adventure.plots[plot.id],
          size = propertySize(adventure, plot.id);
        if (!p) return null;
        return (
          <group key={plot.id}>
            <Boundary id={plot.id} size={size} owned={p.owned} />
            {!p.owned ? (
              <group position={[plot.x, heightAt(plot.x, plot.z), plot.z]}>
                <Sign
                  label={`LAND ${plot.id.split("-")[1]} FOR SALE`}
                  detail="$6,000 · Walk up and press E"
                />
              </group>
            ) : (
              <>
                <group
                  position={[
                    plot.x - size * 0.55,
                    heightAt(plot.x - size * 0.55, plot.z),
                    plot.z,
                  ]}
                >
                  <Sign
                    label={p.sizeLevel === 4 ? "MAX SIZE" : "EXPAND YOUR LAND"}
                    detail={
                      p.sizeLevel === 4
                        ? `${Math.round(size)} m across`
                        : `$${LAND_UPGRADE_PRICES[p.sizeLevel].toLocaleString("en-US")} · Press E`
                    }
                    color="#7e6643"
                  />
                </group>
                {([0, 1] as const)
                  .filter(
                    (slot) =>
                      slot === 0 || p.buildings.some((b) => b.slot === 0),
                  )
                  .map((slot) => {
                    const b = p.buildings.find((b) => b.slot === slot),
                      center = propertySlot(adventure, plot.id, slot)!;
                    return b ? (
                      <BuildingExterior
                        key={slot}
                        adventure={adventure}
                        id={plot.id}
                        building={b}
                      />
                    ) : (
                      <group
                        key={slot}
                        position={[
                          center.x,
                          heightAt(center.x, center.z),
                          center.z,
                        ]}
                      >
                        <Sign
                          label={`BUILD SPOT ${slot + 1}`}
                          detail="Garage · Trophy Room · House"
                          color="#8b6736"
                        />
                        <mesh position={[0, 0.12, 0]}>
                          <boxGeometry args={[5, 0.24, 5]} />
                          <meshStandardMaterial color="#afa594" roughness={1} />
                        </mesh>
                      </group>
                    );
                  })}
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

export default Properties;
