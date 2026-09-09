"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import { heightAt } from "../lib/terrain";
import { LANDMARKS } from "../lib/landmarks";
import { isAirVehicle, isLandVehicle } from "../lib/catalog";
import {
  ANIMAL_TYPES,
  buildWildlife,
  callWildlife,
  canAim,
  consumeCorn,
  isAnimalType,
  nearestShot,
  refillFromCornTrailer,
  retrieveCarcass,
  sellHuntingKills,
  stepWildlife,
  tagWildlife,
  applyHuntingItem,
  wolfReset,
  type AnimalType,
} from "../lib/hunting";
import type { AdventurePosition } from "../lib/adventureTypes";
import { parseAirImpact } from "../lib/transport";
import { wildlifeMapRuntime } from "../lib/mapData";
import { bar, ellipsoid, rounded } from "./models/modelGeometry";

const DRAW_DISTANCE = 240;
const matrix = new THREE.Matrix4(),
  position = new THREE.Vector3(),
  rotation = new THREE.Quaternion(),
  scale = new THREE.Vector3(1, 1, 1);
const up = new THREE.Vector3(0, 1, 0);
const offset = new THREE.Vector3(),
  legRotation = new THREE.Quaternion(),
  swingRotation = new THREE.Quaternion(),
  sideAxis = new THREE.Vector3(1, 0, 0);
const flatDistance = (a: AdventurePosition, b: AdventurePosition) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** Full logical population; only nearby animals submit geometry to the renderer. */
export function Hunting() {
  const { playerPos, playerSpeedRef } = useGameContext();
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const progress = useFourWheeler3dStore((s) => s.progress.adventure);
  const models = useMemo(
    () => ANIMAL_TYPES.map((type) => animalGeometry(type)),
    [],
  );
  const population = useMemo(
    () => buildWildlife(progress.hunting.worldSeed),
    [progress.hunting.worldSeed],
  );
  useEffect(() => {
    wildlifeMapRuntime.animals = population;
    const stop = useAdventureSession.subscribe((session, previous) => {
      if (
        session.action?.name !== "air:impact" ||
        session.action.id === previous.action?.id
      )
        return;
      const hit = parseAirImpact(session.action.payload);
      if (!hit) return;
      const tagged = population.filter(
        (a) =>
          a.alive &&
          a.id !== session.mountId &&
          Math.hypot(a.position.x - hit.x, a.position.z - hit.z) <
            hit.animalRadius,
      );
      if (!tagged.length) return;
      useFourWheeler3dStore.getState().updateProgress((p) => {
        let adventure = p.adventure;
        for (const animal of tagged) adventure = tagWildlife(adventure, animal);
        return { ...p, adventure };
      });
      tagged.forEach((animal) => {
        animal.alive = false;
      });
    });
    return () => {
      stop();
      if (wildlifeMapRuntime.animals === population)
        wildlifeMapRuntime.animals = [];
    };
  }, [population]);
  const byType = useMemo(
    () => ANIMAL_TYPES.map((type) => population.filter((a) => a.type === type)),
    [population],
  );
  const aiBatches = useMemo(
    () =>
      [0, 1, 2, 3].map((batch) =>
        population.filter((_, index) => index % 4 === batch),
      ),
    [population],
  );
  const displayed = useMemo(
    () =>
      population.map((a) => new THREE.Vector3(a.position.x, 0, a.position.z)),
    [population],
  );
  const meshes = useRef<Array<THREE.InstancedMesh | null>>([]);
  const legs = useRef<Array<THREE.InstancedMesh | null>>([]);
  const seen = useRef(0),
    aiClock = useRef(0),
    cornClock = useRef(0),
    protection = useRef(3.5),
    fireCooldown = useRef(0);
  const aiBatch = useRef(0);
  const reducedMotion = useRef(false);
  const retrieval = useRef<{ id: string; phase: "out" | "back" } | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const audio = useRef<AudioContext | null>(null);
  const impact = useRef<THREE.Mesh>(null),
    impactFor = useRef(0);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotion.current = preference.matches;
    };
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const removed = new Set(progress.hunting.removedAnimalIds);
    for (const animal of population) animal.alive = !removed.has(animal.id);
  }, [population, progress.hunting.removedAnimalIds]);
  useEffect(
    () => () => {
      models.forEach((m) => {
        m.body.dispose();
        m.leg.dispose();
        m.carcass.dispose();
      });
      void audio.current?.close();
      useAdventureSession.setState({ dogTarget: null });
    },
    [models],
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const store = useFourWheeler3dStore.getState();
      if (
        !store.hasStarted ||
        store.isPaused ||
        event.repeat ||
        (event.target instanceof HTMLElement &&
          (event.target.matches("input,textarea,select") ||
            event.target.isContentEditable))
      )
        return;
      if (!canAim(store.mode)) return;
      const names: Record<string, string> = {
        KeyG: "scope",
        KeyN: "grunt",
        KeyB: "corn",
        KeyV: "feeder",
        KeyJ: "stand-tree",
      };
      const action = names[event.code];
      if (action) {
        event.preventDefault();
        useAdventureSession.getState().requestAction(`hunt:${action}`);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const sound = (kind: "rifle" | "bow" | "grunt") => {
    if (!useFourWheeler3dStore.getState().progress.settings.soundEnabled)
      return;
    try {
      const ctx = (audio.current ??= new AudioContext());
      void ctx.resume();
      if (kind === "rifle") {
        playRifleShot(ctx);
        return;
      }
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.type = kind === "grunt" ? "sawtooth" : "triangle";
      const duration = kind === "grunt" ? 0.36 : 0.18;
      oscillator.frequency.setValueAtTime(
        kind === "grunt" ? 125 : 420,
        ctx.currentTime,
      );
      oscillator.frequency.exponentialRampToValueAtTime(
        kind === "grunt" ? 68 : 110,
        ctx.currentTime + duration,
      );
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch {
      useFourWheeler3dStore
        .getState()
        .setHint("Sound is off. You can keep playing.");
    }
  };

  useFrame((_, rawDelta) => {
    const store = useFourWheeler3dStore.getState(),
      session = useAdventureSession.getState();
    if (!store.hasStarted || store.isPaused) return;
    const dt = Math.min(rawDelta, 0.1),
      player = playerPos.current;
    protection.current = Math.max(0, protection.current - dt);
    fireCooldown.current = Math.max(0, fireCooldown.current - dt);
    impactFor.current = Math.max(0, impactFor.current - dt);
    if (impact.current) {
      impact.current.visible = impactFor.current > 0;
      impact.current.scale.setScalar(
        reducedMotion.current ? 0.5 : 0.3 + (0.3 - impactFor.current) * 2,
      );
    }
    cornClock.current += dt;
    if (cornClock.current >= 5) {
      const hours = cornClock.current / 60;
      cornClock.current = 0;
      store.updateProgress((p) => ({
        ...p,
        adventure: refillFromCornTrailer(consumeCorn(p.adventure, hours)),
      }));
    }
    const a = useFourWheeler3dStore.getState().progress.adventure;
    const outside = !["interior", "space", "planet"].includes(store.mode);
    if (!outside && session.scope)
      useAdventureSession.setState({ scope: false });
    if (session.action && session.action.id !== seen.current) {
      seen.current = session.action.id;
      if (session.action.name.startsWith("hunt:")) {
        const action = session.action.name.slice(5);
        if (!outside) store.setHint("Go outside to hunt.");
        else if (action === "scope") {
          if (!canAim(store.mode)) store.setHint("Hop off your ride to aim.");
          else if (!(a.inventory.rifle > 0 || a.inventory.bow > 0))
            store.setHint("You need your toy rifle or bow to aim.");
          else
            useAdventureSession.setState({
              scope: !session.scope,
              panel: null,
            });
        } else if (action === "fire") {
          if (!session.scope || !canAim(store.mode))
            store.setHint("Raise your scope first.");
          else if (
            !(a.hunting.useBow ? a.inventory.bow > 0 : a.inventory.rifle > 0)
          )
            store.setHint("You need your toy rifle or bow to fire.");
          else if (fireCooldown.current <= 0) {
            fireCooldown.current = 0.25;
            let pointer = { x: 0, y: 0 };
            try {
              if (session.action.payload)
                pointer = JSON.parse(session.action.payload);
            } catch {
              /* Keyboard fire uses the center. */
            }
            if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y))
              pointer = { x: 0, y: 0 };
            raycaster.setFromCamera(
              new THREE.Vector2(
                Math.max(-1, Math.min(1, pointer.x)),
                Math.max(-1, Math.min(1, pointer.y)),
              ),
              camera,
            );
            const ray = raycaster.ray;
            const animal = nearestShot(
              population,
              ray.origin,
              ray.direction,
              heightAt,
            );
            sound(a.hunting.useBow ? "bow" : "rifle");
            const target = animal
              ? new THREE.Vector3(
                  animal.position.x,
                  heightAt(animal.position.x, animal.position.z) + 0.8,
                  animal.position.z,
                )
              : ray.at(40, new THREE.Vector3());
            const blocker = world.castRay(
              new rapier.Ray(ray.origin, ray.direction),
              Math.max(0, ray.origin.distanceTo(target) - 1),
              true,
              rapier.QueryFilterFlags.EXCLUDE_DYNAMIC,
            );
            if (animal && !blocker) {
              store.updateProgress((p) => ({
                ...p,
                adventure: tagWildlife(p.adventure, animal),
              }));
              animal.alive = false;
              store.setHint(
                `Tagged a ${animal.type}! Send your dog to retrieve it.`,
              );
            } else store.setHint("Missed! Try aiming at the animal's body.");
            impact.current?.position.copy(target);
            impactFor.current = 0.3;
          }
        } else if (action === "retrieve") {
          if (!a.dog.alive) store.setHint("Your dog needs your help first.");
          else if (retrieval.current)
            store.setHint("Your dog is already fetching.");
          else {
            const carcass = [...a.hunting.carcasses].sort(
              (x, y) =>
                flatDistance(x.position, player) -
                flatDistance(y.position, player),
            )[0];
            if (!carcass)
              store.setHint("Tag an animal first, then send your dog.");
            else {
              retrieval.current = { id: carcass.id, phase: "out" };
              useAdventureSession.setState({
                dogTarget: {
                  ...carcass.position,
                  y: heightAt(carcass.position.x, carcass.position.z),
                },
              });
              store.setHint("Go get it, buddy!");
            }
          }
        } else if (action === "sell") {
          let message = "";
          store.updateProgress((p) => {
            const result = sellHuntingKills(p, player);
            message = result.message;
            return result.progress;
          });
          store.setHint(message);
        } else if (action === "climb") {
          const stand = [...a.stands].sort(
            (x, y) =>
              flatDistance(x.position, player) -
              flatDistance(y.position, player),
          )[0];
          if (
            store.mode !== "foot" ||
            !stand ||
            flatDistance(stand.position, player) > 80 / 18
          )
            store.setHint("Walk close to a stand, then climb.");
          else {
            useAdventureSession.setState({ standId: stand.id, panel: null });
            store.setMode("stand");
            session.relocate({
              ...stand.position,
              y:
                heightAt(stand.position.x, stand.position.z) +
                (stand.type === "tree" ? 3 : 0.45),
            });
            store.setHint("In the stand. Raise your scope when you are ready.");
          }
        } else if (action === "leave") {
          const stand = a.stands.find((s) => s.id === session.standId);
          if (store.mode === "stand" && stand) {
            store.setMode("foot");
            useAdventureSession.setState({ standId: null, scope: false });
            session.relocate({
              x: stand.position.x + 2,
              y: heightAt(stand.position.x + 2, stand.position.z) + 1,
              z: stand.position.z,
            });
          } else if (
            store.mode === "mount" &&
            session.mountId?.startsWith("animal-")
          ) {
            store.setMode("foot");
            useAdventureSession.setState({ mountId: null });
          }
        } else {
          let succeeded = false,
            message = "";
          store.updateProgress((p) => {
            const result = applyHuntingItem(p, action, player, store.mode);
            succeeded = result.ok;
            message = result.message;
            return result.progress;
          });
          if (succeeded && action === "grunt") {
            const count = callWildlife(population, player);
            sound("grunt");
            message += ` ${count} deer heard you.`;
          }
          store.setHint(message);
        }
      }
    }
    const fetch = retrieval.current;
    if (fetch) {
      const carcass = a.hunting.carcasses.find((c) => c.id === fetch.id);
      if (!carcass || !a.dog.alive) {
        retrieval.current = null;
        useAdventureSession.setState({ dogTarget: null });
      } else if (session.dogPosition) {
        if (
          fetch.phase === "out" &&
          flatDistance(session.dogPosition, carcass.position) < 1.5
        )
          fetch.phase = "back";
        if (fetch.phase === "back") {
          if (
            !session.dogTarget ||
            flatDistance(session.dogTarget, player) > 0.5
          )
            useAdventureSession.setState({
              dogTarget: { x: player.x, y: player.y, z: player.z },
            });
          if (flatDistance(session.dogPosition, player) < 2) {
            store.updateProgress((p) => ({
              ...p,
              adventure: retrieveCarcass(p.adventure, fetch.id),
            }));
            retrieval.current = null;
            useAdventureSession.setState({ dogTarget: null });
            store.setHint(
              `Your dog brought a ${carcass.type}. Sell your tags for a trophy!`,
            );
          }
        }
      }
    }
    if (outside) {
      aiClock.current += dt;
      if (aiClock.current >= 0.025) {
        const step = aiClock.current;
        aiClock.current = 0;
        const batch = aiBatches[aiBatch.current];
        aiBatch.current = (aiBatch.current + 1) % aiBatches.length;
        const caught = stepWildlife(
          batch,
          {
            player,
            mode: store.mode,
            camo: a.hunting.camoOn,
            feeders: a.feeders,
            protected: protection.current > 0,
            mountId: session.mountId,
          },
          step * aiBatches.length,
        );
        if (caught) {
          store.updateProgress(wolfReset);
          store.setMode("foot");
          session.relocate({
            x: LANDMARKS.garage.x,
            y: 2,
            z: LANDMARKS.garage.z + 11,
          });
          useAdventureSession.setState({
            standId: null,
            mountId: null,
            scope: false,
            interior: null,
            panel: null,
            dogTarget: null,
          });
          protection.current = 3.5;
          retrieval.current = null;
          const rebuilt = buildWildlife(a.hunting.worldSeed);
          population.forEach((animal, i) => Object.assign(animal, rebuilt[i]));
          store.setHint(
            "A wolf caught you! Your fleet and trophies reset. Your cash and land are safe.",
          );
        }
        const ride = a.activeVehicleId ? a.fleet[a.activeVehicleId] : null;
        const roadkill =
          ride &&
          ((isLandVehicle(ride.type) &&
            Math.abs(playerSpeedRef.current) > 1.5 * 0.38) ||
            (isAirVehicle(ride.type) &&
              player.y - heightAt(player.x, player.z) < 55 / 18));
        for (const animal of population) {
          if (!animal.alive) continue;
          if (animal.id === session.mountId) {
            animal.position.x = player.x;
            animal.position.z = player.z;
            animal.heading = session.playerSnapshot.heading;
            continue;
          }
          const reach = flatDistance(animal.position, player);
          if (roadkill && reach < 26 / 18) {
            store.updateProgress((p) => ({
              ...p,
              adventure: tagWildlife(p.adventure, animal),
            }));
            animal.alive = false;
          } else if (
            store.mode === "parachute" &&
            animal.type !== "wolf" &&
            reach < 34 / 18 &&
            player.y - heightAt(player.x, player.z) < 60 / 18
          ) {
            store.setMode("mount");
            useAdventureSession.setState({ mountId: animal.id });
            store.setHint(`Riding a ${animal.type}! Tap Hop Off to leave.`);
            break;
          }
        }
        if (store.mode === "foot") {
          const picked = a.hunting.looseSkulls.filter(
            (s) => flatDistance(s.position, player) < 46 / 18,
          );
          if (picked.length) {
            const ids = new Set(picked.map((s) => s.id));
            store.updateProgress((p) => ({
              ...p,
              trophies: p.adventure.collectedSkulls + picked.length,
              adventure: {
                ...p.adventure,
                collectedSkulls: p.adventure.collectedSkulls + picked.length,
                hunting: {
                  ...p.adventure.hunting,
                  looseSkulls: p.adventure.hunting.looseSkulls.filter(
                    (s) => !ids.has(s.id),
                  ),
                },
              },
            }));
          }
        }
      }
    }
    for (let typeIndex = 0; typeIndex < ANIMAL_TYPES.length; typeIndex++) {
      const body = meshes.current[typeIndex],
        leg = legs.current[typeIndex];
      if (!body || !leg) continue;
      let count = 0,
        legCount = 0;
      const type = ANIMAL_TYPES[typeIndex],
        small = type === "rabbit" || type === "bat";
      for (const animal of byType[typeIndex]) {
        if (
          !outside ||
          !animal.alive ||
          animal.type !== type ||
          flatDistance(animal.position, player) > DRAW_DISTANCE
        )
          continue;
        const floor = heightAt(animal.position.x, animal.position.z),
          gait = reducedMotion.current
            ? 0
            : Math.sin(_.clock.elapsedTime * 9 + Number(animal.id.slice(7))) *
              Math.min(0.055, animal.speed * 0.01);
        position.set(
          animal.position.x,
          floor +
            (type === "bat"
              ? 3 +
                (reducedMotion.current
                  ? 0
                  : Math.sin(_.clock.elapsedTime * 3) * 0.2)
              : Math.abs(gait)),
          animal.position.z,
        );
        const rendered = displayed[Number(animal.id.slice(7))];
        if (rendered.distanceToSquared(position) > 25) rendered.copy(position);
        else rendered.lerp(position, 1 - Math.exp(-18 * dt));
        position.copy(rendered);
        rotation.setFromAxisAngle(up, animal.heading);
        matrix.compose(position, rotation, scale);
        body.setMatrixAt(count++, matrix);
        if (type !== "bat")
          for (let foot = 0; foot < 4; foot++) {
            offset
              .set(
                (foot % 2 ? 1 : -1) * (small ? 0.16 : 0.25),
                small ? 0.28 : 0.9,
                (foot < 2 ? 1 : -1) * (small ? 0.2 : 0.5),
              )
              .applyQuaternion(rotation)
              .add(position);
            const stride =
              Math.sin(
                _.clock.elapsedTime * 9 +
                  (foot === 0 || foot === 3 ? 0 : Math.PI),
              ) *
              Math.min(reducedMotion.current ? 0.2 : 0.55, animal.speed * 0.12);
            legRotation
              .copy(rotation)
              .multiply(swingRotation.setFromAxisAngle(sideAxis, stride));
            matrix.compose(offset, legRotation, scale);
            leg.setMatrixAt(legCount++, matrix);
          }
      }
      body.count = count;
      leg.count = legCount;
      body.instanceMatrix.needsUpdate = true;
      leg.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group name="hunting-world">
      {models.map((model, i) => (
        <group key={ANIMAL_TYPES[i]}>
          <instancedMesh
            ref={(m) => {
              meshes.current[i] = m;
            }}
            args={[model.body, undefined, byType[i].length]}
            count={0}
            frustumCulled={false}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              vertexColors
              roughness={0.96}
              side={THREE.DoubleSide}
            />
          </instancedMesh>
          <instancedMesh
            ref={(m) => {
              legs.current[i] = m;
            }}
            args={[model.leg, undefined, byType[i].length * 4]}
            count={0}
            frustumCulled={false}
            castShadow
          >
            <meshStandardMaterial vertexColors roughness={0.96} />
          </instancedMesh>
        </group>
      ))}
      {progress.hunting.carcasses
        .filter((c) => isAnimalType(c.type))
        .map((c) => (
          <mesh
            key={c.id}
            geometry={
              models[ANIMAL_TYPES.indexOf(c.type as AnimalType)].carcass
            }
            position={[
              c.position.x,
              heightAt(c.position.x, c.position.z),
              c.position.z,
            ]}
            rotation={[0, c.heading, 0]}
            castShadow
          >
            <meshStandardMaterial vertexColors roughness={1} />
          </mesh>
        ))}
      {progress.feeders.map((f) => (
        <group
          key={f.id}
          position={[
            f.position.x,
            heightAt(f.position.x, f.position.z),
            f.position.z,
          ]}
        >
          <mesh position={[0, 1.25, 0]} castShadow>
            <cylinderGeometry args={[0.48, 0.3, 0.7, 16]} />
            <meshStandardMaterial
              color="#586044"
              roughness={0.8}
              metalness={0.25}
            />
          </mesh>
          <mesh position={[0, 1.65, 0]} castShadow>
            <coneGeometry args={[0.53, 0.14, 16]} />
            <meshStandardMaterial color="#303829" />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * 0.3, 0.5, 0]}
              rotation={[0, 0, side * 0.2]}
            >
              <cylinderGeometry args={[0.035, 0.04, 1.2, 8]} />
              <meshStandardMaterial color="#4b503c" />
            </mesh>
          ))}
          {f.corn > 0 && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
              <circleGeometry args={[0.7, 18]} />
              <meshStandardMaterial color="#c7a34a" roughness={1} />
            </mesh>
          )}
        </group>
      ))}
      {progress.stands.map((s) => (
        <group
          key={s.id}
          position={[
            s.position.x,
            heightAt(s.position.x, s.position.z),
            s.position.z,
          ]}
        >
          <mesh
            position={[0, s.type === "tree" ? 2.8 : 0.1, 0]}
            receiveShadow
            castShadow
          >
            <boxGeometry args={[1.8, 0.18, 1.8]} />
            <meshStandardMaterial color="#665342" />
          </mesh>
          {s.type === "tree" ? (
            <>
              {[-0.75, 0.75].map((x) => (
                <mesh key={x} position={[x, 1.4, -0.7]}>
                  <cylinderGeometry args={[0.045, 0.045, 2.8, 8]} />
                  <meshStandardMaterial color="#444b3a" />
                </mesh>
              ))}
              {Array.from({ length: 9 }, (_, i) => (
                <mesh key={i} position={[0, i * 0.3 + 0.2, -0.7]}>
                  <boxGeometry args={[1.5, 0.06, 0.06]} />
                  <meshStandardMaterial color="#555b48" />
                </mesh>
              ))}
            </>
          ) : (
            <mesh position={[0, 0.85, 0]}>
              <cylinderGeometry args={[0.9, 1.1, 1.6, 8, 1, true]} />
              <meshStandardMaterial color="#5a6543" side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      ))}
      {progress.hunting.looseSkulls.map((s) => (
        <mesh
          key={s.id}
          position={[
            s.position.x,
            heightAt(s.position.x, s.position.z) + 0.2,
            s.position.z,
          ]}
          scale={[0.15, 0.18, 0.25]}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#e8dec4" />
        </mesh>
      ))}
      <mesh ref={impact} visible={false}>
        <icosahedronGeometry args={[0.6, 1]} />
        <meshBasicMaterial color="#eac973" wireframe />
      </mesh>
    </group>
  );
}

/** Short toy-rifle noise crack, with nodes released as soon as the burst ends. */
export function playRifleShot(ctx: AudioContext): void {
  const duration = 0.18;
  const buffer = ctx.createBuffer(
    1,
    Math.ceil(ctx.sampleRate * duration),
    ctx.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++)
    samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
  const source = ctx.createBufferSource(),
    filter = ctx.createBiquadFilter(),
    gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.setValueAtTime(700, ctx.currentTime);
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  source.start();
  source.stop(ctx.currentTime + duration);
}

/** Anatomical forms are baked by species, then reused by every visible instance. */
export function animalGeometry(type: AnimalType): {
  body: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  carcass: THREE.BufferGeometry;
} {
  const parts: THREE.BufferGeometry[] = [],
    feet: THREE.BufferGeometry[] = [];
  const fur = {
    buck: "#94704f",
    deer: "#a87d57",
    rabbit: "#9b9184",
    lion: "#b79460",
    tiger: "#c9914e",
    zebra: "#dedad0",
    bat: "#48434c",
    wolf: "#797f7e",
  }[type];
  const add = (geometry: THREE.BufferGeometry, color = fur, target = parts) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.deleteAttribute("uv");
    const c = new THREE.Color(color),
      colors = new Float32Array(g.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    target.push(g);
  };
  const small = type === "rabbit",
    deer = type === "buck" || type === "deer",
    cat = type === "lion" || type === "tiger";
  if (type === "bat") {
    add(ellipsoid([0.16, 0.25, 0.17], [0, 0, 0]));
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(side * 0.35, 0.4);
      shape.lineTo(side * 1.1, 0.2);
      shape.quadraticCurveTo(side * 0.65, 0.02, side * 0.7, -0.25);
      shape.quadraticCurveTo(side * 0.4, -0.05, side * 0.33, -0.4);
      shape.lineTo(0, -0.2);
      add(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), "#64525e");
      add(bar([0, 0, 0], [side * 1.1, 0, 0.2], 0.02), "#312d32");
      add(ellipsoid([0.06, 0.12, 0.04], [side * 0.09, 0.21, 0.1]));
    }
  } else {
    add(
      ellipsoid(small ? [0.23, 0.27, 0.42] : [0.36, 0.42, 0.82], [
        0,
        small ? 0.38 : 1.05,
        0,
      ]),
    );
    add(
      ellipsoid(small ? [0.25, 0.28, 0.25] : [0.37, 0.43, 0.39], [
        0,
        small ? 0.32 : 1.02,
        -0.5,
      ]),
    );
    const neckY = deer || type === "zebra" ? 1.45 : small ? 0.56 : 1.06;
    add(
      bar(
        [0, small ? 0.4 : 1, 0.45],
        [0, neckY, 0.72],
        small ? 0.11 : deer ? 0.17 : 0.23,
      ),
    );
    const headY = neckY + (deer ? 0.3 : 0.1),
      headZ = small ? 0.42 : 0.95;
    if (type === "lion")
      add(ellipsoid([0.4, 0.46, 0.3], [0, headY, 0.72]), "#735138");
    add(
      ellipsoid(small ? [0.16, 0.18, 0.2] : [0.21, 0.25, 0.3], [
        0,
        headY,
        headZ,
      ]),
    );
    add(
      ellipsoid(
        [small ? 0.09 : 0.15, 0.1, deer ? 0.25 : 0.16],
        [0, headY - 0.09, headZ + 0.22],
      ),
      cat ? "#d7bd94" : fur,
    );
    add(
      ellipsoid(
        [0.07, 0.05, 0.055],
        [0, headY - 0.04, headZ + (deer ? 0.43 : 0.34)],
      ),
      "#252620",
    );
    for (const side of [-1, 1]) {
      add(
        ellipsoid(
          [0.07, small ? 0.3 : deer ? 0.18 : 0.11, 0.05],
          [side * 0.17, headY + (small ? 0.32 : 0.24), headZ - 0.07],
        ),
      );
      add(
        ellipsoid(
          [0.028, 0.034, 0.035],
          [side * 0.17, headY + 0.035, headZ + 0.19],
        ),
        "#181e18",
      );
      if (type === "buck") {
        add(
          bar(
            [side * 0.1, headY + 0.2, headZ - 0.08],
            [side * 0.4, headY + 0.72, headZ - 0.2],
            0.028,
            0.01,
          ),
          "#c1ac80",
        );
        for (let branch = 0; branch < 3; branch++)
          add(
            bar(
              [
                side * (0.17 + branch * 0.07),
                headY + 0.33 + branch * 0.12,
                headZ - 0.12,
              ],
              [
                side * (0.28 + branch * 0.08),
                headY + 0.55 + branch * 0.14,
                headZ + 0.04,
              ],
              0.018,
              0.006,
            ),
            "#c1ac80",
          );
      }
    }
    add(
      bar(
        [0, small ? 0.45 : 1.05, -0.65],
        [0, small ? 0.6 : cat ? 0.65 : 0.85, small ? -0.79 : -1.2],
        small ? 0.1 : 0.045,
      ),
    );
    if (type === "tiger" || type === "zebra")
      for (let i = 0; i < 10; i++) {
        const ring = new THREE.TorusGeometry(1, 0.026, 4, 14)
          .scale(0.366, 0.43, 0.5)
          .translate(0, 1.05, -0.55 + i * 0.12);
        add(ring, "#35342e");
      }
    const length = small ? 0.28 : 0.9;
    add(
      bar(
        [0, 0, 0],
        [0, -length * 0.48, 0.06],
        small ? 0.07 : 0.068,
        small ? 0.09 : 0.11,
      ),
      fur,
      feet,
    );
    add(
      bar([0, -length * 0.48, 0.06], [0, -length + 0.06, 0], 0.04, 0.05),
      fur,
      feet,
    );
    add(
      rounded(
        [0.12, 0.09, cat || small ? 0.22 : 0.14],
        [0, -length + 0.045, 0.04],
        0.035,
      ),
      deer || type === "zebra" ? "#36342b" : fur,
      feet,
    );
  }
  if (!feet.length) add(ellipsoid([0.01, 0.01, 0.01], [0, 0, 0]), fur, feet);
  const body = mergeGeometries(parts)!,
    leg = mergeGeometries(feet)!;
  [...parts, ...feet].forEach((g) => g.dispose());
  // One shared merged mesh per species keeps fifty tagged animals to fifty draws.
  const tagged = [body.clone()];
  if (type !== "bat")
    for (let foot = 0; foot < 4; foot++)
      tagged.push(
        leg
          .clone()
          .translate(
            (foot % 2 ? 1 : -1) * (small ? 0.16 : 0.25),
            small ? 0.28 : 0.9,
            (foot < 2 ? 1 : -1) * (small ? 0.2 : 0.5),
          ),
      );
  const headY =
    type === "bat"
      ? 0.12
      : (deer || type === "zebra" ? 1.45 : small ? 0.56 : 1.06) +
        (deer ? 0.3 : 0.1) +
        0.035;
  const headZ = type === "bat" ? 0.19 : (small ? 0.42 : 0.95) + 0.235;
  for (const side of [-1, 1])
    for (const tilt of [-1, 1]) {
      const x = side * (type === "bat" ? 0.065 : 0.17);
      add(
        bar(
          [x - 0.026, headY - tilt * 0.026, headZ],
          [x + 0.026, headY + tilt * 0.026, headZ],
          0.009,
        ),
        "#f4ecd0",
        tagged,
      );
    }
  const carcass = mergeGeometries(tagged)!;
  tagged.forEach((g) => g.dispose());
  if (type !== "bat") carcass.rotateZ(Math.PI / 2);
  carcass.computeBoundingBox();
  carcass.translate(0, -carcass.boundingBox!.min.y + 0.03, 0);
  return { body, leg, carcass };
}
