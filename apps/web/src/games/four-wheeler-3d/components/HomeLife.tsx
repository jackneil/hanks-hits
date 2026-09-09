"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import { LANDMARKS } from "../lib/landmarks";
import { DESTINATIONS, distanceTo } from "../lib/destinations";
import { eatMeal, hungerReset, saddleHorse } from "../lib/life";
import { rollWeather } from "../lib/dayNight";
import { resetActivitiesSession } from "../lib/activitiesSession";
import { heightAt } from "../lib/terrain";
import * as THREE from "three";
import { VehicleModel } from "./models";
import { WheelModel } from "./models/WheelModel";
import { tuningFor } from "../lib/vehicles";

import { parkActive, saveRiderPosition } from "./AdventureRuntime";
import { nearbyCamper, positionXYZ } from "../lib/rideTransitions";
import { nearestCow, nearestHorse, flushFarmPoses } from "../lib/farmRuntime";

export const INTERIOR_Y = 2000;
export const INTERIOR_EXIT = {
  id: "home:exit",
  label: "Go outside",
  kind: "interior",
  icon: "⌂",
  distance: 0,
  ready: true,
} as const;
const stations = [
  { id: "home:exit", label: "Go outside", x: -4, z: 5 },
  { id: "home:eat", label: "Eat a meal · $100", x: -3, z: -3 },
  { id: "home:rest", label: "Choose wake-up time", x: 4, z: -3 },
  { id: "home:closet", label: "Change your clothes", x: 4, z: 3 },
];
export function interiorInteraction(
  kind: string,
  position: { x: number; z: number },
) {
  const point = (
    kind === "garage" || kind === "trophy" ? [] : stations.slice(1)
  ).find((v) => Math.hypot(position.x - v.x, position.z - v.z) < 2);
  return point
    ? {
        id: point.id,
        label: point.label,
        kind: "interior",
        icon: "⌂",
        distance: 0,
        ready: true,
      }
    : { ...INTERIOR_EXIT };
}
export function enterInterior(id: string, kind: string, rooms = 1) {
  const s = useAdventureSession.getState(),
    store = useFourWheeler3dStore.getState();
  if (["vehicle", "boat", "aircraft"].includes(store.mode)) parkActive();
  if (
    (kind === "rv" || kind === "yacht") &&
    store.progress.adventure.fleet[id]
  ) {
    const craft = store.progress.adventure.fleet[id];
    store.updateProgress((p) => ({
      ...p,
      currentVehicle: craft.type,
      paint: craft.paint,
      adventure: { ...p.adventure, activeVehicleId: id },
    }));
  }
  useAdventureSession.setState({
    interior: {
      id,
      kind,
      rooms,
      returnPosition: positionXYZ(s.playerSnapshot),
    },
    interaction: { ...INTERIOR_EXIT },
    scope: false,
    mountId: null,
    milking: null,
  });
  s.openPanel(null);
  s.relocate(
    { x: 0, y: INTERIOR_Y + 0.1, z: kind === "garage" ? 0 : 0.5 },
    Math.PI,
  );
  store.setMode("interior");
  store.setHint("You’re inside. Press E or Go outside to leave.");
  saveRiderPosition();
}
export function leaveInterior() {
  const s = useAdventureSession.getState(),
    store = useFourWheeler3dStore.getState();
  if (!s.interior) return;
  const interior = s.interior,
    p = interior.returnPosition;
  s.setInteraction(null);
  if (interior.kind === "rv") {
    const rv = store.progress.adventure.fleet[interior.id];
    if (rv) {
      store.updateProgress((p) => ({
        ...p,
        currentVehicle: rv.type,
        paint: rv.paint,
        adventure: {
          ...p.adventure,
          activeVehicleId: rv.id,
          rider: {
            mode: "vehicle",
            position: positionXYZ(rv.position),
            heading: rv.heading,
          },
          fleet: { ...p.adventure.fleet, [rv.id]: { ...rv, parked: false } },
        },
      }));
      useAdventureSession.setState({ interior: null });
      s.relocate(rv.position, rv.heading);
      store.setMode("vehicle");
      s.openPanel(null);
      return;
    }
  }
  if (interior.kind === "yacht") {
    const yacht = store.progress.adventure.fleet[interior.id];
    if (yacht) {
      s.requestAction("boat:helm");
      return;
    }
  }
  s.relocate({ ...p, y: Math.max(heightAt(p.x, p.z) + 0.1, p.y) }, 0);
  useAdventureSession.setState({ interior: null });
  store.setMode("foot");
  store.updateProgress((current) => ({
    ...current,
    adventure: {
      ...current.adventure,
      rider: {
        mode: "foot",
        position: { x: p.x, y: Math.max(0, heightAt(p.x, p.z)) + 0.1, z: p.z },
        heading: 0,
      },
    },
  }));
  s.openPanel(null);
}
export function HomeLife() {
  const { playerPos } = useGameContext();
  const elapsed = useRef(0),
    hungerElapsed = useRef(0),
    bowl = useRef(false);
  const interior = useAdventureSession((s) => s.interior);
  useEffect(
    () =>
      useAdventureSession.subscribe((s, previous) => {
        const action = s.action;
        if (!action || action.id === previous.action?.id) return;
        if (action.name.startsWith("farm:")) flushFarmPoses();
        const store = useFourWheeler3dStore.getState(),
          p = store.progress;
        if (!store.hasStarted || store.isPaused) return;
        const home = DESTINATIONS.find(
          (d) =>
            d.kind === "home" && distanceTo(s.playerSnapshot, d) < d.radius,
        );
        if (action.name === "home:enter" && home) {
          if (Math.abs(s.playerSnapshot.speed) > 3) {
            store.setHint("Stop before going inside.");
            return;
          }
          enterInterior(home.id, "house");
          return;
        }
        if (action.name === "home:camper" || action.name === "home:rv") {
          const active = p.adventure.fleet[p.adventure.activeVehicleId ?? ""];
          const camper =
            action.name === "home:rv" &&
            store.mode === "vehicle" &&
            active?.type === "rv"
              ? active
              : nearbyCamper(p.adventure, s.playerSnapshot, store.mode);
          if (
            !camper ||
            (action.payload && camper.id !== action.payload) ||
            Math.abs(s.playerSnapshot.speed) > 3
          ) {
            store.setHint("Stop your RV, or walk up to a camper to go inside.");
            return;
          }
          enterInterior(camper.id, camper.type, 1);
          return;
        }
        if (action.name === "home:exit") {
          leaveInterior();
          return;
        }
        if (action.name === "home:eat" && (home || s.interior)) {
          const next = eatMeal(p);
          if (next) {
            store.updateProgress(() => next);
            store.setHint("A good meal. You’re full again!");
          } else store.setHint("You need $100 for a meal.");
          return;
        }
        if (action.name === "home:sleep" && (home || s.interior)) {
          const hour = Number(action.payload);
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
            store.setTimeOfDay(hour);
            store.flushClock();
            store.updateProgress((p) => ({
              ...p,
              weather: rollWeather(Math.random),
            }));
            s.openPanel(null);
            store.setHint(`Good morning! It’s ${hour}:00.`);
          }
          return;
        }
        if (action.name === "home:rest" || action.name === "home:closet") {
          if (s.interior) s.openPanel("home");
          return;
        }
        if (action.name === "dog:feed" || action.name === "dog:whistle") {
          if (action.name === "dog:whistle") {
            if (!s.dogTarget) store.setHint("Your dog is coming!");
            return;
          }
          if (s.dogTarget || bowl.current) {
            store.setHint("Your dog is busy. Let it finish first.");
            return;
          }
          if (p.money < 10) {
            store.setHint("You need $10 for dog food.");
            return;
          }
          store.addMoney(-10);
          bowl.current = true;
          useAdventureSession.setState({
            dogTarget: {
              ...LANDMARKS.dogHouse,
              y: heightAt(LANDMARKS.dogHouse.x, LANDMARKS.dogHouse.z),
            },
          });
          store.setHint("Your dog is running to its bowl.");
        }
        if (action.name === "farm:milk") {
          if (s.milking) {
            useAdventureSession.setState({ milking: null });
            store.setHint("Stopped milking.");
            return;
          }
          if (store.mode !== "foot" || !nearestCow(s.playerSnapshot, 8.4)) {
            store.setHint("Walk up to a cow first.");
            return;
          }
          if (!p.adventure.bucket) {
            store.setHint("Buy a bucket at the bucket shop first.");
            return;
          }
          if (p.adventure.bucket.fill >= 1) {
            store.setHint(
              "Your bucket is full. Sell the milk at the sell box.",
            );
            return;
          }
          useAdventureSession.setState({
            milking: { progress: 0, origin: { ...s.playerSnapshot } },
          });
          s.openPanel(null);
        }
        if (action.name === "farm:saddle" || action.name === "farm:ride") {
          if (store.mode === "mount" && action.name === "farm:ride") {
            const id = s.mountId;
            store.updateProgress((p) => ({
              ...p,
              adventure: {
                ...p.adventure,
                horses: p.adventure.horses.map((h) =>
                  h.id === id
                    ? {
                        ...h,
                        position: {
                          x: s.playerSnapshot.x,
                          y: s.playerSnapshot.y,
                          z: s.playerSnapshot.z,
                        },
                        heading: s.playerSnapshot.heading,
                      }
                    : h,
                ),
              },
            }));
            store.setMode("foot");
            useAdventureSession.setState({ mountId: null });
            return;
          }
          if (store.mode !== "foot") {
            store.setHint("Hop off and walk up to a horse first.");
            return;
          }
          const horse = nearestHorse(s.playerSnapshot, p.adventure.horses, 8.4);
          if (!horse) {
            store.setHint("Walk closer to a horse.");
            return;
          }
          if (action.name === "farm:saddle") {
            const a = saddleHorse(p.adventure, horse.id);
            if (a) {
              store.updateProgress((p) => ({ ...p, adventure: a }));
              store.setHint("Saddled up! You can ride now.");
            } else
              store.setHint(
                horse.saddle
                  ? "This horse already has a saddle."
                  : "Buy a saddle at the saddle shop.",
              );
          } else if (horse.saddle) {
            useAdventureSession.setState({ mountId: horse.id });
            s.relocate(
              {
                ...horse.position,
                y: heightAt(horse.position.x, horse.position.z),
              },
              horse.heading,
            );
            store.setMode("mount");
            s.openPanel(null);
          } else store.setHint("Put a saddle on this horse first.");
        }
      }),
    [],
  );
  useFrame((_, delta) => {
    const store = useFourWheeler3dStore.getState(),
      s = useAdventureSession.getState();
    if (!store.hasStarted || store.isPaused) return;
    if (s.interior) {
      const next = interiorInteraction(s.interior.kind, playerPos.current);
      if (s.interaction?.id !== next.id || s.interaction?.kind !== "interior")
        s.setInteraction(next);
    }
    if (
      bowl.current &&
      s.dogPosition &&
      distanceTo(s.dogPosition, LANDMARKS.dogHouse) < 1.5
    ) {
      bowl.current = false;
      store.updateProgress((p) => ({
        ...p,
        adventure: { ...p.adventure, dog: { alive: true, hungerHours: 0 } },
      }));
      useAdventureSession.setState({ dogTarget: null });
      store.setHint("Your dog ate its dinner. Happy pup!");
    }
    elapsed.current += Math.min(delta, 0.1);
    if (elapsed.current < 1) return;
    const dt = elapsed.current;
    elapsed.current = 0;
    hungerElapsed.current += dt;
    const p = store.progress,
      hunger = Math.min(24, p.hunger + hungerElapsed.current / 60),
      dogHunger = Math.min(
        24,
        p.adventure.dog.hungerHours + hungerElapsed.current / 60,
      );
    if (hunger >= 24 || dogHunger >= 24) {
      hungerElapsed.current = 0;
      resetActivitiesSession();
      store.updateProgress(hungerReset);
      store.setMode("foot");
      s.reset();
      s.relocate({ x: -400, y: 3, z: 12 });
      store.setHint(
        hunger >= 24
          ? "You ran out of energy. Your family brought you home for a fresh start."
          : "Your dog needed food. Time for a fresh start at home.",
      );
      return;
    }
    // Save hunger in minute batches, not every frame.
    if (hungerElapsed.current >= 10) {
      hungerElapsed.current = 0;
      store.updateProgress((p) => ({
        ...p,
        hunger,
        adventure: {
          ...p.adventure,
          dog: { ...p.adventure.dog, hungerHours: dogHunger },
        },
      }));
    }
    if (s.milking) {
      if (
        distanceTo(playerPos.current, s.milking.origin) > 2 ||
        store.mode !== "foot" ||
        !nearestCow(playerPos.current, 8.4)
      ) {
        useAdventureSession.setState({ milking: null });
        store.setHint("You moved away from the cow.");
      } else {
        const progress = Math.min(1, s.milking.progress + dt / 10);
        useAdventureSession.setState({
          milking: progress >= 1 ? null : { ...s.milking, progress },
        });
        if (progress >= 1) {
          store.updateProgress((p) => ({
            ...p,
            adventure: {
              ...p.adventure,
              bucket: p.adventure.bucket
                ? {
                    ...p.adventure.bucket,
                    fill: Math.min(1, p.adventure.bucket.fill + 0.2),
                    uses: p.adventure.bucket.uses + 1,
                  }
                : null,
            },
          }));
          store.setHint("Finished milking. Your bucket gained 20% milk!");
        }
      }
    }
  });
  return interior ? (
    <Interior rooms={interior.rooms} kind={interior.kind} id={interior.id} />
  ) : null;
}
function Interior({
  rooms,
  kind,
  id,
}: {
  rooms: number;
  kind: string;
  id: string;
}) {
  const adventure = useFourWheeler3dStore((s) => s.progress.adventure);
  const [plotId, slot] = id.split(":");
  const stored =
    adventure.plots[plotId]?.buildings.find((b) => b.slot === Number(slot))
      ?.parkedVehicleIds ?? [];
  const garage = kind === "garage",
    trophy = kind === "trophy";
  if (garage) return <GarageInterior stored={stored} fleet={adventure.fleet} />;
  const width = 12 * rooms;
  return (
    <group position={[0, INTERIOR_Y, 0]}>
      <ambientLight intensity={1.2} />
      <pointLight
        position={[0, 4, 0]}
        intensity={55}
        color="#ffdda0"
        distance={30}
      />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[width / 2, 0.1, 7]}
          position={[width / 2 - 6, -0.1, 0]}
        />
        {[
          [width / 2 - 6, 2, -7, width, 4, 0.2],
          [-6, 2, 0, 0.2, 4, 14],
          [width - 6, 2, 0, 0.2, 4, 14],
          [width / 2 - 6, 2, 7, width, 4, 0.2],
        ].map(([x, y, z, w, h, d], i) => (
          <group key={i}>
            <CuboidCollider args={[w / 2, h / 2, d / 2]} position={[x, y, z]} />
            <mesh position={[x, y, z]} receiveShadow>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial color="#d4c6a6" roughness={0.95} />
            </mesh>
          </group>
        ))}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[width / 2 - 6, 0.01, 0]}
          receiveShadow
        >
          <planeGeometry args={[width, 14]} />
          <meshStandardMaterial color="#8f7351" roughness={0.85} />
        </mesh>
      </RigidBody>
      {!garage && !trophy && (
        <>
          <mesh position={[-3, 0.55, -4]} castShadow>
            <boxGeometry args={[3, 1.1, 1.3]} />
            <meshStandardMaterial color="#4c6654" roughness={0.7} />
          </mesh>
          <mesh position={[-3, 1.15, -4]}>
            <boxGeometry args={[3.2, 0.1, 1.4]} />
            <meshStandardMaterial color="#d9d3bb" roughness={0.4} />
          </mesh>
          {Array.from({ length: rooms }, (_, i) => (
            <group key={i} position={[i * 12, 0, 0]}>
              <mesh position={[3, 0.35, -3]} castShadow>
                <boxGeometry args={[2.5, 0.7, 3.4]} />
                <meshStandardMaterial color="#566674" roughness={0.9} />
              </mesh>
              <mesh position={[3, 0.78, -4]}>
                <boxGeometry args={[2, 0.2, 0.8]} />
                <meshStandardMaterial color="#eee5d2" />
              </mesh>
              <mesh position={[4, 1.2, 4]} castShadow>
                <boxGeometry args={[2, 2.4, 1]} />
                <meshStandardMaterial color="#66523d" roughness={0.85} />
              </mesh>
              <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[4, 5]} />
                <meshStandardMaterial color="#ac6c48" roughness={1} />
              </mesh>
            </group>
          ))}
        </>
      )}
      {trophy && (
        <>
          {Object.entries(adventure.trophyCounts)
            .filter(([, n]) => n > 0)
            .map(([type, n], i) => (
              <group
                key={type}
                position={[
                  -4 + (i % 5) * 2,
                  1.6,
                  -6.7 + Math.floor(i / 5) * 12,
                ]}
              >
                <mesh>
                  <boxGeometry args={[1.5, 1.8, 0.15]} />
                  <meshStandardMaterial color="#6e5136" roughness={0.85} />
                </mesh>
                <mesh position={[0, 0, 0.3]} scale={[0.3, 0.4, 0.4]}>
                  <sphereGeometry args={[1, 12, 8]} />
                  <meshStandardMaterial
                    color={type === "buck" ? "#d1c29e" : "#9e7c53"}
                  />
                </mesh>
                {type === "buck" &&
                  [-1, 1].map((side) => (
                    <mesh
                      key={side}
                      position={[side * 0.35, 0.5, 0.3]}
                      rotation={[0, 0, -side * 0.6]}
                    >
                      <capsuleGeometry args={[0.04, 0.8, 4, 8]} />
                      <meshStandardMaterial color="#ddd0ad" />
                    </mesh>
                  ))}
                <mesh
                  position={[0, -0.65, 0.12]}
                  scale={[Math.min(1, n / 10), 1, 1]}
                >
                  <boxGeometry args={[1, 0.08, 0.05]} />
                  <meshStandardMaterial color="#dfbc65" metalness={0.7} />
                </mesh>
              </group>
            ))}
        </>
      )}
      <mesh position={[-4, 1, 6.85]}>
        <boxGeometry args={[1.5, 2, 0.1]} />
        <meshStandardMaterial color="#354d41" />
      </mesh>
    </group>
  );
}

function InteriorSign({
  text,
  at,
  width = 3,
  rotation = [0, 0, 0],
}: {
  text: string;
  at: [number, number, number];
  width?: number;
  rotation?: [number, number, number];
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#293d43";
    ctx.fillRect(0, 0, 768, 160);
    ctx.fillStyle = "#ecebdc";
    ctx.font = "700 78px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 384, 84, 724);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={at} rotation={rotation}>
      <planeGeometry args={[width, (width * 160) / 768]} />
      <meshStandardMaterial map={texture} roughness={0.9} />
    </mesh>
  );
}
function GarageInterior({
  stored,
  fleet,
}: {
  stored: string[];
  fleet: import("../lib/adventureTypes").AdventureProgress["fleet"];
}) {
  const floorTexture = useMemo(() => {
    const size = 128,
      data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const grain = 134 + Math.sin(i * 12.9898) * 9 + Math.sin(i * 0.73) * 4;
      data[i * 4] = grain;
      data[i * 4 + 1] = grain + 2;
      data[i * 4 + 2] = grain;
      data[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, size, size);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(11, 13);
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => floorTexture.dispose(), [floorTexture]);
  const box = (
    key: string,
    at: [number, number, number],
    size: [number, number, number],
    color: string,
    metalness = 0,
  ) => (
    <mesh key={key} position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={metalness ? 0.58 : 0.9}
        metalness={metalness}
      />
    </mesh>
  );
  return (
    <group name="six-bay-garage-interior" position={[0, INTERIOR_Y, 0]}>
      <ambientLight intensity={0.7} />
      <pointLight
        position={[-5, 4.7, -5]}
        intensity={65}
        distance={30}
        color="#e8f0ed"
      />
      <pointLight
        position={[5, 4.7, 5]}
        intensity={65}
        distance={30}
        color="#e8f0ed"
      />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[11, 0.1, 13]} position={[0, -0.1, 0]} />
        {[
          [0, 2.75, -13, 22, 5.5, 0.18],
          [0, 2.75, 13, 22, 5.5, 0.18],
          [-11, 2.75, 0, 0.18, 5.5, 26],
          [11, 2.75, 0, 0.18, 5.5, 26],
        ].map(([x, y, z, w, h, d], i) => (
          <group key={i}>
            <CuboidCollider args={[w / 2, h / 2, d / 2]} position={[x, y, z]} />
            {box(`wall-${i}`, [x, y, z], [w, h, d], "#b6bbb7")}
            {box(
              `base-${i}`,
              [x, 0.7, z],
              [w + 0.015, 1.4, d + 0.015],
              "#536369",
            )}
          </group>
        ))}
        <mesh
          position={[0, 0.008, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[22, 26]} />
          <meshStandardMaterial map={floorTexture} roughness={0.88} />
        </mesh>
        {box("ceiling", [0, 5.5, 0], [22, 0.16, 26], "#7d8787")}
      </RigidBody>
      {[-9, -3, 3, 9].map((z) => (
        <group key={z}>
          {box(`beam${z}`, [0, 5.08, z], [22, 0.2, 0.18], "#465459", 0.55)}
          {[-5, 5].map((x) => (
            <mesh key={x} position={[x, 4.95, z]}>
              <boxGeometry args={[3, 0.06, 0.22]} />
              <meshStandardMaterial
                color="#f3f2df"
                emissive="#ecf1e2"
                emissiveIntensity={1.4}
              />
            </mesh>
          ))}
        </group>
      ))}
      {Array.from({ length: 6 }, (_, i) => {
        const x = ((i % 3) - 1) * 6,
          z = Math.floor(i / 3) === 0 ? -6 : 5,
          v = fleet[stored[i]],
          tuning = v ? tuningFor(v.type) : null;
        return (
          <group key={i} name={`parking-bay-${i + 1}`} position={[x, 0, z]}>
            {[-1, 1].map((side) =>
              box(
                `line${side}`,
                [side * 2.5, 0.018, 0],
                [0.07, 0.008, 8.4],
                "#c2bc8d",
              ),
            )}
            {box("end", [0, 0.018, -4.2], [5, 0.008, 0.07], "#c2bc8d")}
            <InteriorSign
              text={`BAY ${i + 1}`}
              at={[0, 0.022, 4.5]}
              width={2}
              rotation={[-Math.PI / 2, 0, 0]}
            />
            {v && tuning && (
              <group
                position={[
                  0,
                  tuning.wheelRadius + tuning.suspension.restLength,
                  0,
                ]}
                rotation={[0, Math.PI, 0]}
              >
                <VehicleModel
                  id={v.type}
                  tuning={tuning}
                  paint={v.paint}
                  detail="parked"
                  lightsEnabled={false}
                  mud={v.mud}
                />
                {tuning.wheelPositions.map((p, j) => (
                  <group
                    key={j}
                    position={[p[0], p[1] - tuning.suspension.restLength, p[2]]}
                  >
                    <WheelModel radius={tuning.wheelRadius} />
                  </group>
                ))}
              </group>
            )}
          </group>
        );
      })}
      <InteriorSign text="HANK'S GARAGE" at={[0, 3.7, -12.87]} width={7} />
      <InteriorSign
        text={`${stored.length} / 6 RIDES STORED`}
        at={[0, 2.95, -12.86]}
        width={4}
      />
      {box("worktop", [0, 1.05, -12], [7, 0.13, 1.1], "#8d7b5c")}
      {[-2.7, 0, 2.7].map((x) =>
        box(`cabinet${x}`, [x, 0.5, -12], [2.1, 1, 0.95], "#724f41", 0.25),
      )}
      {[-2.7, 0, 2.7].flatMap((x) =>
        [0.22, 0.48, 0.74].map((y) =>
          box(
            `drawer${x}:${y}`,
            [x, y, -11.51],
            [1.8, 0.02, 0.035],
            "#b4bbb8",
            0.75,
          ),
        ),
      )}
      {box("pegboard", [0, 2.05, -12.82], [6, 1.3, 0.08], "#777468")}
      {Array.from({ length: 9 }, (_, i) =>
        box(
          `tool${i}`,
          [-2.4 + i * 0.6, 2.1 + (i % 2) * 0.15, -12.73],
          [0.045, 0.4 + (i % 3) * 0.06, 0.07],
          "#bec5c2",
          0.8,
        ),
      )}
      {box("shelf", [-9.6, 1.3, -9], [1.4, 2.6, 4], "#435157", 0.5)}
      {[0.45, 1.15, 1.9].flatMap((y) =>
        [-10, -8.7].map((z) =>
          box(`supply${y}:${z}`, [-9.5, y, z], [0.9, 0.45, 0.8], "#8f8065"),
        ),
      )}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[9, 0.3 + i * 0.45, -10]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.48, 0.17, 8, 20]} />
          <meshStandardMaterial color="#272c2a" roughness={1} />
        </mesh>
      ))}
      {box("door", [0, 2.1, 12.85], [8, 4.2, 0.12], "#7d898d", 0.45)}
      {Array.from({ length: 14 }, (_, i) =>
        box(
          `door-seam${i}`,
          [0, 0.18 + i * 0.29, 12.76],
          [8, 0.025, 0.03],
          "#4b5d64",
          0.4,
        ),
      )}
      {box("exit", [-9, 1.2, 12.79], [1.4, 2.4, 0.08], "#31584e")}
      <InteriorSign
        text="GO OUTSIDE"
        at={[-9, 2.7, 12.7]}
        width={2.2}
        rotation={[0, Math.PI, 0]}
      />
      <InteriorSign
        text="E TO GO OUTSIDE"
        at={[5.8, 1.9, 12.74]}
        width={3.2}
        rotation={[0, Math.PI, 0]}
      />
    </group>
  );
}
