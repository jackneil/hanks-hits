"use client";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { useGameContext } from "../lib/gameContext";
import { BONE_POINTS } from "../lib/mapData";
import { RiderModel } from "./models/RiderModel";
import {
  advanceFarmPose,
  boundsForHorse,
  cowPoses,
  createFarmPose,
  flushFarmPoses,
  horsePoses,
  horseWithPose,
  nearestCow,
  registerFarmFlush,
} from "../lib/farmRuntime";
import { heightAt } from "../lib/terrain";

function BodyPart({
  at,
  scale,
  color,
}: {
  at: [number, number, number];
  scale: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={at} scale={scale} castShadow>
      <sphereGeometry args={[1, 12, 8]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}
function FarmAnimal({
  id,
  horse = false,
  color = "#e0ddd0",
  saddle = false,
  ridden = false,
}: {
  id: string;
  horse?: boolean;
  color?: string;
  saddle?: boolean;
  ridden?: boolean;
}) {
  const legs = useRef<THREE.Group>(null),
    root = useRef<THREE.Group>(null),
    rider = useRef<THREE.Group>(null),
    reduced = useRef(false);
  useEffect(() => {
    if (!ridden) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)"),
      sync = () => {
        reduced.current = query.matches;
      };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [ridden]);
  useFrame(() => {
    const pose = (horse ? horsePoses : cowPoses).get(id);
    if (!pose || !root.current) return;
    root.current.position.set(
      pose.position.x,
      pose.position.y,
      pose.position.z,
    );
    root.current.rotation.y = pose.heading;
    const amplitude = Math.min(0.5, pose.speed * 0.65),
      phase = pose.distance * 4.8;
    legs.current?.children.forEach((leg, i) => {
      leg.rotation.x =
        Math.sin(phase + [0, Math.PI, 0.65 * Math.PI, 1.65 * Math.PI][i]) *
        amplitude;
    });
    if (rider.current)
      rider.current.position.y =
        1.13 +
        (reduced.current
          ? 0
          : Math.sin(phase * 2) * Math.min(0.035, pose.speed * 0.015));
  });
  return (
    <group ref={root}>
      <BodyPart
        at={[0, 1.1, 0]}
        scale={[0.45, 0.5, horse ? 0.95 : 0.8]}
        color={color}
      />
      <BodyPart
        at={[0, 1.4, 0.75]}
        scale={[0.25, horse ? 0.7 : 0.4, 0.3]}
        color={color}
      />
      <BodyPart
        at={[0, horse ? 2 : 1.65, 1]}
        scale={[0.25, 0.3, horse ? 0.48 : 0.35]}
        color={color}
      />
      <BodyPart
        at={[0, horse ? 1.9 : 1.55, 1.35]}
        scale={[0.25, 0.19, 0.23]}
        color={horse ? "#4f3828" : "#bb9582"}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <BodyPart
            at={[side * 0.19, horse ? 2.3 : 1.97, 0.96]}
            scale={[0.07, 0.18, 0.09]}
            color={color}
          />
          <BodyPart
            at={[side * 0.245, horse ? 2.04 : 1.73, 1.2]}
            scale={[0.045, 0.05, 0.035]}
            color="#171816"
          />
        </group>
      ))}
      <group ref={legs}>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <group key={`${x}:${z}`} position={[x * 0.29, 1.05, z * 0.57]}>
              <mesh position={[0, -0.45, 0]} castShadow>
                <capsuleGeometry args={[0.1, 0.8, 4, 8]} />
                <meshStandardMaterial color={color} />
              </mesh>
              <BodyPart
                at={[0, -0.95, 0.03]}
                scale={[0.14, 0.1, 0.2]}
                color="#292923"
              />
            </group>
          )),
        )}
      </group>
      <mesh position={[0, 0.98, -0.98]} rotation={[0.2, 0, 0]} castShadow>
        <capsuleGeometry args={[0.055, 0.7, 4, 8]} />
        <meshStandardMaterial color={horse ? "#35281e" : color} />
      </mesh>
      {horse ? (
        <mesh position={[0, 1.77, 0.51]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.08, 0.65, 0.13]} />
          <meshStandardMaterial color="#302a22" />
        </mesh>
      ) : (
        <>
          <BodyPart
            at={[0.38, 1.26, 0.12]}
            scale={[0.08, 0.28, 0.35]}
            color="#303731"
          />
          <BodyPart
            at={[-0.36, 1.1, -0.2]}
            scale={[0.1, 0.33, 0.4]}
            color="#303731"
          />
          <BodyPart
            at={[0, 0.65, -0.3]}
            scale={[0.24, 0.23, 0.28]}
            color="#c59f95"
          />
        </>
      )}
      {saddle && (
        <mesh position={[0, 1.52, -0.15]} castShadow>
          <boxGeometry args={[0.8, 0.15, 0.7]} />
          <meshStandardMaterial color="#714a2c" roughness={0.8} />
        </mesh>
      )}
      {ridden && (
        <group ref={rider} position={[0, 1.13, 0]} scale={[1.25, 1, 1]}>
          <RiderModel paint="#a99b74" />
        </group>
      )}
    </group>
  );
}
export function Farm() {
  const horses = useFourWheeler3dStore((s) => s.progress.adventure.horses),
    collected = useFourWheeler3dStore(
      (s) => s.progress.adventure.collectedBones,
    );
  const { playerPos, playerQuat } = useGameContext(),
    timer = useRef(0),
    saveTimer = useRef(0),
    lastMounted = useRef<string | null>(null),
    heldCow = useRef<string | null>(null);
  const snapshots = useRef(new Map<string, string>()),
    euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  const mountId = useAdventureSession((s) => s.mountId),
    mode = useFourWheeler3dStore((s) => s.mode),
    helmetCam = useFourWheeler3dStore((s) => s.progress.settings.helmetCam);
  const bonePoints = useMemo(
    () => BONE_POINTS.map((b) => ({ ...b, y: heightAt(b.x, b.z) + 0.7 })),
    [],
  );
  useEffect(() => {
    const ids = new Set(horses.map((h) => h.id));
    for (const id of horsePoses.keys())
      if (!ids.has(id)) {
        horsePoses.delete(id);
        snapshots.current.delete(id);
      }
    for (const h of horses) {
      const signature = JSON.stringify([h.position, h.heading]);
      if (!horsePoses.has(h.id) || snapshots.current.get(h.id) !== signature) {
        const p = createFarmPose(h.id, "horse", h.position, h.heading);
        p.position.y = heightAt(p.position.x, p.position.z);
        horsePoses.set(h.id, p);
      }
      snapshots.current.set(h.id, signature);
    }
  }, [horses]);
  useEffect(() => {
    const persist = () => {
      const store = useFourWheeler3dStore.getState();
      let changed = false;
      const next = store.progress.adventure.horses.map((h) => {
        const pose = horsePoses.get(h.id);
        if (
          !pose ||
          snapshots.current.get(h.id) !==
            JSON.stringify([h.position, h.heading])
        )
          return h;
        if (
          Math.hypot(
            pose.position.x - h.position.x,
            pose.position.z - h.position.z,
          ) < 0.01 &&
          Math.abs(pose.heading - h.heading) < 0.01
        )
          return h;
        changed = true;
        const next = horseWithPose(h, pose);
        snapshots.current.set(
          h.id,
          JSON.stringify([next.position, next.heading]),
        );
        return next;
      });
      if (changed)
        store.updateProgress((p) => ({
          ...p,
          adventure: { ...p.adventure, horses: next },
        }));
      saveTimer.current = 0;
    };
    const unregister = registerFarmFlush(persist);
    const stopStore = useFourWheeler3dStore.subscribe((state, previous) => {
      if (
        (state.isPaused && !previous.isPaused) ||
        (!state.hasStarted && previous.hasStarted) ||
        state.mode !== previous.mode
      )
        persist();
    });
    const stopSession = useAdventureSession.subscribe((state, previous) => {
      if (
        state.action?.id !== previous.action?.id &&
        state.action?.name.startsWith("farm:")
      )
        persist();
    });
    const onPageHide = () => persist();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      persist();
      unregister();
      stopStore();
      stopSession();
      window.removeEventListener("pagehide", onPageHide);
      horsePoses.clear();
    };
  }, []);
  useFrame((_, delta) => {
    const store = useFourWheeler3dStore.getState(),
      session = useAdventureSession.getState();
    if (!store.hasStarted || store.isPaused || session.panel) return;
    const dt = Math.min(delta, 0.1);
    if (dt <= 0) return;
    const mountedId = store.mode === "mount" ? session.mountId : null;
    if (lastMounted.current && lastMounted.current !== mountedId) {
      const horse = horsePoses.get(lastMounted.current);
      if (horse) {
        horse.bounds = boundsForHorse(horse.position);
        horse.target = { x: horse.position.x, z: horse.position.z };
        horse.rest = 5;
      }
    }
    lastMounted.current = mountedId;
    if (!session.milking) heldCow.current = null;
    else if (!heldCow.current)
      heldCow.current = nearestCow(session.milking.origin)?.id ?? null;
    for (const cow of cowPoses.values()) {
      advanceFarmPose(cow, dt, cowPoses.values(), cow.id === heldCow.current);
      cow.position.y = heightAt(cow.position.x, cow.position.z);
    }
    for (const horse of horsePoses.values()) {
      if (horse.id === mountedId) {
        const distance = Math.hypot(
          playerPos.current.x - horse.position.x,
          playerPos.current.z - horse.position.z,
        );
        horse.speed = distance / dt;
        horse.distance += Math.min(distance, dt * 12);
        horse.position = {
          x: playerPos.current.x,
          y: playerPos.current.y,
          z: playerPos.current.z,
        };
        euler.setFromQuaternion(playerQuat.current);
        horse.heading = euler.y;
      } else {
        advanceFarmPose(horse, dt, horsePoses.values());
        horse.position.y = heightAt(horse.position.x, horse.position.z);
      }
    }
    saveTimer.current += dt;
    if (saveTimer.current >= 5) flushFarmPoses();
    timer.current += dt;
    if (timer.current < 0.2 || store.mode === "interior") return;
    timer.current = 0;
    const found = BONE_POINTS.find(
      (b) =>
        !store.progress.adventure.collectedBones.includes(b.id) &&
        Math.hypot(playerPos.current.x - b.x, playerPos.current.z - b.z) < 2,
    );
    if (found) {
      store.updateProgress((p) => ({
        ...p,
        adventure: {
          ...p.adventure,
          collectedBones: [...p.adventure.collectedBones, found.id],
        },
      }));
      store.setHint(
        `Found a bone! ${store.progress.adventure.collectedBones.length + 1} of ${BONE_POINTS.length}.`,
      );
    }
  });
  return (
    <>
      {horses.map((h) => (
        <FarmAnimal
          key={h.id}
          id={h.id}
          horse
          color={h.color}
          saddle={!!h.saddle}
          ridden={h.id === mountId && mode === "mount" && !helmetCam}
        />
      ))}
      {Array.from(cowPoses.keys()).map((id) => (
        <FarmAnimal key={id} id={id} />
      ))}
      {bonePoints
        .filter((b) => !collected.includes(b.id))
        .map((b) => (
          <group key={b.id} position={[b.x, b.y, b.z]} rotation={[0, 0.4, 0.3]}>
            <mesh>
              <capsuleGeometry args={[0.12, 0.65, 4, 8]} />
              <meshStandardMaterial
                color="#eddfaf"
                emissive="#a28638"
                emissiveIntensity={0.2}
              />
            </mesh>
            {[-0.42, 0.42].flatMap((y) =>
              [-0.1, 0.1].map((x) => (
                <BodyPart
                  key={`${x}:${y}`}
                  at={[x, y, 0]}
                  scale={[0.17, 0.17, 0.17]}
                  color="#eddfaf"
                />
              )),
            )}
          </group>
        ))}
    </>
  );
}
