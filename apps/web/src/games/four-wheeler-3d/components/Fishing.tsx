"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import { FISH_TYPES } from "../lib/constants";
import {
  advanceFish,
  advanceReel,
  BAITS,
  catchLakeFish,
  createFishingSession,
  createLakeFish,
  FISH,
  fishSaleValue,
  nearbyFish,
  netFish,
  rollCastTargets,
  type LakeFish,
} from "../lib/fishing";

export function Fishing() {
  const { playerPos } = useGameContext();
  const [population] = useState(createLakeFish);
  const session = useRef(createFishingSession());
  const hooked = useRef<LakeFish[]>([]);
  const castBait = useRef<string | null>(null);
  const netCooldown = useRef(0);
  const reportAfter = useRef(0);
  const fishMeshes = useRef<Array<THREE.InstancedMesh | null>>([]);
  const bobber = useRef<THREE.Mesh>(null);
  const matrix = useRef(new THREE.Object3D());
  const fishGeometry = useMemo(() => {
    const body = new THREE.SphereGeometry(1, 10, 6);
    const tail = new THREE.ConeGeometry(0.6, 0.65, 3);
    tail.rotateX(Math.PI / 2).translate(0, 0, -1.1);
    const combined = mergeGeometries([body, tail])!;
    body.dispose();
    tail.dispose();
    return combined;
  }, []);
  useEffect(() => {
    fishMeshes.current.forEach((mesh) => {
      if (mesh) mesh.count = 0;
    });
    return () => fishGeometry.dispose();
  }, [fishGeometry]);

  useEffect(() => {
    const reward = (caught: LakeFish[], usesBait: boolean) => {
      if (!caught.length) return;
      useFourWheeler3dStore.getState().updateProgress((p) => {
        const counts = { ...p.fishCaught };
        let prize = 0;
        let biggest = p.biggestFish;
        for (const f of caught) {
          if (f.type === "rainbow") prize += FISH.rainbow.value;
          else counts[f.type] = (counts[f.type] ?? 0) + 1;
          if (
            FISH_TYPES.indexOf(f.type) >
            FISH_TYPES.indexOf(biggest as (typeof FISH_TYPES)[number])
          )
            biggest = f.type;
        }
        const hunting = { ...p.adventure.hunting };
        if (usesBait && hunting.activeBait === "rainbow") {
          hunting.rainbowBaitUses = Math.max(
            0,
            hunting.rainbowBaitUses - caught.length,
          );
          if (!hunting.rainbowBaitUses) hunting.activeBait = null;
        }
        return {
          ...p,
          fishCaught: counts,
          biggestFish: biggest,
          money: p.money + prize,
          totalEarned: p.totalEarned + prize,
          adventure: { ...p.adventure, hunting },
        };
      });
    };
    // The callback lives on the ref because the frame loop completes the reel.
    finishCatch.current = reward;
    return useAdventureSession.subscribe((next, previous) => {
      if (next.generation !== previous.generation) {
        session.current = createFishingSession();
        hooked.current = [];
        castBait.current = null;
        netCooldown.current = 0;
        reportAfter.current = 0;
        return;
      }
      const action = next.action;
      if (!action || action.id === previous.action?.id) return;
      const store = useFourWheeler3dStore.getState();
      if (action.name === "boat:net") {
        const craft =
          store.progress.adventure.fleet[
            store.progress.adventure.activeVehicleId ?? ""
          ];
        if (
          craft?.type !== "yacht" ||
          !["boat", "deck"].includes(store.mode) ||
          netCooldown.current > 0
        )
          return;
        const caught = netFish(
          population,
          playerPos.current.x,
          playerPos.current.z,
        );
        netCooldown.current = 2;
        reward(caught, false);
        store.setHint(
          caught.length
            ? `Nets hauled in ${caught.length} fish. Sell them from your fishing bag.`
            : "Empty nets. Move closer to a school of fish.",
        );
        return;
      }
      if (!action.name.startsWith("fishing:")) return;
      const live = session.current;
      if (action.name === "fishing:find") {
        const nearest = nearbyFish(
          population,
          playerPos.current.x,
          playerPos.current.z,
          Infinity,
          1,
        )[0];
        if (nearest) {
          next.setWaypoint({
            id: "fish-school",
            label: "Nearby fish",
            x: nearest.x,
            z: nearest.z,
          });
          next.openPanel(null);
          store.setHint("Follow the fish marker, stop nearby, and cast.");
        }
        return;
      }
      if (action.name === "fishing:cast") {
        if (!["boat", "deck"].includes(store.mode)) {
          store.setHint("Fish from a boat or its deck.");
          return;
        }
        const rods = store.progress.adventure.inventory.rod ?? 0;
        if (!rods) {
          store.setHint("Buy a fishing rod at the store first.");
          return;
        }
        if (["casting", "bite", "reeling"].includes(live.phase)) return;
        const hunting = store.progress.adventure.hunting;
        castBait.current = hunting.activeBait;
        hooked.current = rollCastTargets(
          population,
          playerPos.current.x,
          playerPos.current.z,
          rods,
          hunting.activeBait,
          hunting.rainbowBaitUses,
        );
        session.current = {
          ...createFishingSession(),
          rainbowCelebration: live.rainbowCelebration,
          phase: "casting",
          wait: 1.5 + Math.random(),
          fishId: hooked.current[0] ? String(hooked.current[0].id) : null,
          species: hooked.current[0]?.type ?? null,
          message: `Casting ${rods} ${rods === 1 ? "line" : "lines"}...`,
        };
      } else if (action.name === "fishing:reel") live.reeling = true;
      else if (action.name === "fishing:release") live.reeling = false;
      else if (action.name === "fishing:close") {
        session.current = {
          ...createFishingSession(),
          rainbowCelebration: live.rainbowCelebration,
        };
        hooked.current = [];
      } else if (action.name === "fishing:sell") {
        const value = fishSaleValue(store.progress.fishCaught);
        if (!value) {
          store.setHint("Your fish bag is empty.");
          return;
        }
        store.updateProgress((p) => {
          const money = fishSaleValue(p.fishCaught);
          return {
            ...p,
            money: p.money + money,
            totalEarned: p.totalEarned + money,
            fishCaught: Object.fromEntries(FISH_TYPES.map((type) => [type, 0])),
          };
        });
        store.setHint(`Fish sold for $${value.toLocaleString("en-US")}.`);
      } else if (action.name === "fishing:bait") {
        if (
          action.payload &&
          action.payload !== store.progress.adventure.hunting.activeBait
        ) {
          store.setHint(
            BAITS[action.payload]
              ? "Buy that bait at the store to use it."
              : "Choose a bait sold in the store.",
          );
          return;
        }
        if (!action.payload)
          store.updateProgress((p) => ({
            ...p,
            adventure: {
              ...p.adventure,
              hunting: {
                ...p.adventure.hunting,
                activeBait: null,
                rainbowBaitUses: 0,
              },
            },
          }));
      }
      useAdventureSession.setState({ fishing: { ...session.current } });
    });
  }, [population, playerPos]);
  const finishCatch = useRef<(fish: LakeFish[], usesBait: boolean) => void>(
    () => {},
  );

  useFrame((_, delta) => {
    const store = useFourWheeler3dStore.getState();
    if (store.isPaused || !store.hasStarted) return;
    const dt = Math.min(delta, 0.1);
    advanceFish(population, dt);
    netCooldown.current = Math.max(0, netCooldown.current - dt);
    const live = session.current;
    live.rainbowCelebration = Math.max(0, live.rainbowCelebration - dt);
    const previousPhase = live.phase;
    if (live.phase === "casting") {
      live.wait -= dt;
      if (live.wait <= 0) {
        live.phase = hooked.current.length ? "bite" : "escaped";
        live.wait = 0;
        live.message = hooked.current.length
          ? "Bite! Hold Reel, then release before the line gets too tight."
          : "Nothing took the bait. Move nearer a school and try again.";
      }
    } else advanceReel(live, dt);
    if (live.phase === "caught" && previousPhase !== "caught") {
      const caught = hooked.current.filter(
        (f) =>
          f.alive &&
          Math.hypot(f.x - playerPos.current.x, f.z - playerPos.current.z) < 35,
      );
      caught.forEach(catchLakeFish);
      if (caught.some((f) => f.type === "rainbow")) live.rainbowCelebration = 6;
      finishCatch.current(caught, castBait.current === "rainbow");
      live.message = caught.some((f) => f.type === "rainbow")
        ? "Rainbow fish! $1,000,000 earned."
        : caught.length
          ? `${caught.length} fish landed. Added to your bag.`
          : "The school moved away. Cast closer next time.";
      hooked.current = [];
    }
    if (bobber.current) {
      const target = hooked.current[0];
      bobber.current.visible = Boolean(
        target && ["casting", "bite", "reeling"].includes(live.phase),
      );
      if (target)
        bobber.current.position.set(
          target.x,
          0.15 + Math.sin(performance.now() * 0.005) * 0.04,
          target.z,
        );
    }
    reportAfter.current += dt;
    if (reportAfter.current < 0.1) return;
    reportAfter.current = 0;
    useAdventureSession.setState({ fishing: { ...live } });
    const counts = [0, 0, 0, 0, 0];
    for (const fish of population) {
      if (
        !fish.alive ||
        Math.hypot(fish.x - playerPos.current.x, fish.z - playerPos.current.z) >
          110
      )
        continue;
      const species = FISH_TYPES.indexOf(fish.type);
      const mesh = fishMeshes.current[species];
      if (!mesh) continue;
      matrix.current.position.set(fish.x, -0.12, fish.z);
      matrix.current.rotation.set(0, fish.heading, 0);
      const size = FISH[fish.type].size;
      matrix.current.scale.set(size * 0.28, size * 0.18, size);
      matrix.current.updateMatrix();
      mesh.setMatrixAt(counts[species]++, matrix.current.matrix);
    }
    fishMeshes.current.forEach((mesh, i) => {
      if (mesh) {
        mesh.count = counts[i];
        mesh.instanceMatrix.needsUpdate = true;
      }
    });
  });

  return (
    <group name="lake-fish">
      {FISH_TYPES.map((type, i) => (
        <instancedMesh
          key={type}
          ref={(mesh) => {
            fishMeshes.current[i] = mesh;
          }}
          args={[fishGeometry, undefined, 902]}
          frustumCulled={false}
        >
          <meshStandardMaterial
            color={FISH[type].color}
            roughness={0.4}
            metalness={0.15}
          />
        </instancedMesh>
      ))}
      <mesh ref={bobber} visible={false}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#e36242" />
      </mesh>
    </group>
  );
}

export default Fishing;
