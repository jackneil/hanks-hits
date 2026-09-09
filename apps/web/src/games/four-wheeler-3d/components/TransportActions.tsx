"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";
import { useGameContext } from "../lib/gameContext";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { enterInterior } from "./HomeLife";
import { heightAt } from "../lib/terrain";
import {
  canWalkDeck,
  isWatercraft,
  launchYachtToy,
  loadYachtToy,
  transportTuning,
  createAirEffects,
  dropToyBomb,
  stepAirEffects,
  AIR_EFFECT_LIMITS,
} from "../lib/transport";

/** Keep mounted while on deck/in the cabin, when the active physics craft is unmounted. */
export function TransportActions() {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const store = useFourWheeler3dStore.getState();
      if (
        event.code !== "KeyF" ||
        event.repeat ||
        !store.hasStarted ||
        store.isPaused ||
        useAdventureSession.getState().panel ||
        keyBelongsToTarget(event)
      )
        return;
      if (store.mode === "vehicle") {
        event.preventDefault();
        useAdventureSession.getState().requestAction("vehicle:parachute");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(
    () =>
      useAdventureSession.subscribe((session, previous) => {
        const action = session.action;
        if (
          !action ||
          action.id === previous.action?.id ||
          !/^(boat|air|vehicle):/.test(action.name)
        )
          return;
        const store = useFourWheeler3dStore.getState();
        if (!store.hasStarted || store.isPaused) return;
        if (action.name.startsWith("air:") && action.name !== "air:parachute")
          return;
        const id =
          store.progress.adventure.activeVehicleId ??
          session.transport?.vehicleId;
        if (!id) return;
        let vehicle = store.progress.adventure.fleet[id];
        if (!vehicle) return;
        const water = isWatercraft(vehicle.type);
        const tune = transportTuning(vehicle.type);
        if (action.name === "vehicle:parachute") {
          if (store.mode !== "vehicle" || vehicle.type !== "atv") {
            store.setHint("Try the parachute from your quad or an aircraft.");
            return;
          }
          const p = session.playerSnapshot;
          const landing = {
            x: p.x + Math.cos(p.heading) * 2,
            y: Math.max(0, heightAt(p.x, p.z)) + 0.1,
            z: p.z - Math.sin(p.heading) * 2,
          };
          store.updateProgress((current) => ({
            ...current,
            adventure: {
              ...current.adventure,
              rider: { mode: "foot", position: landing, heading: p.heading },
              fleet: {
                ...current.adventure.fleet,
                [id]: {
                  ...current.adventure.fleet[id],
                  position: { x: p.x, y: p.y, z: p.z },
                  heading: p.heading,
                  parked: true,
                },
              },
            },
          }));
          session.relocate(
            { ...landing, y: Math.max(p.y, landing.y) + 140 / 18 },
            p.heading,
          );
          store.setMode("parachute");
          store.clearNos();
          session.openPanel(null);
          store.setHint("Parachute open! Your quad is parked below.");
          return;
        }
        // The transition saves the actual live position before changing controller ownership.
        if (store.mode === "boat" || store.mode === "aircraft") {
          const p = session.playerSnapshot;
          vehicle = {
            ...vehicle,
            position: {
              x: p.x,
              y: p.y - (water ? tune.deckHeight : 0),
              z: p.z,
            },
            heading: p.heading,
          };
          const saved = vehicle;
          store.updateProgress((p) => ({
            ...p,
            adventure: {
              ...p.adventure,
              fleet: { ...p.adventure.fleet, [id]: saved },
            },
          }));
        }
        if (action.name === "air:parachute") {
          if (water || store.mode !== "aircraft") return;
          const altitude =
            vehicle.position.y -
            Math.max(0, heightAt(vehicle.position.x, vehicle.position.z));
          if (altitude < 4) {
            store.setHint(
              "Climb a little higher before opening the parachute.",
            );
            return;
          }
          const position = {
            ...vehicle.position,
            x: vehicle.position.x + Math.cos(vehicle.heading) * 2,
          };
          session.relocate(position, vehicle.heading);
          store.setMode("parachute");
          store.setHint("Parachute open! Steer toward a clear landing.");
          return;
        }
        if (action.name.startsWith("air:")) return;
        if (action.name === "boat:load") {
          const result = loadYachtToy(
            useFourWheeler3dStore.getState().progress.adventure,
            id,
          );
          if (!result.ok) {
            store.setHint(result.message);
            return;
          }
          store.updateProgress((p) => ({
            ...p,
            currentVehicle: result.vehicle.type,
            adventure: result.adventure,
          }));
          session.relocate(result.vehicle.position, result.vehicle.heading);
          store.setMode("boat");
          store.setHint("Loaded back aboard the yacht.");
          return;
        }
        if (!water) return;
        if (
          !["boat", "deck"].includes(store.mode) &&
          !(
            action.name === "boat:helm" &&
            store.mode === "interior" &&
            session.interior?.id === id
          )
        ) {
          store.setHint("Board this boat before using its equipment.");
          return;
        }
        if (action.name === "boat:deck") {
          if (!canWalkDeck(vehicle.type)) {
            store.setHint("This boat does not have a walking deck.");
            return;
          }
          session.relocate(
            {
              ...vehicle.position,
              y: vehicle.position.y + tune.deckHeight + 0.1,
              z:
                vehicle.position.z -
                Math.cos(vehicle.heading) * tune.length * 0.25,
              x:
                vehicle.position.x -
                Math.sin(vehicle.heading) * tune.length * 0.25,
            },
            vehicle.heading,
          );
          store.setMode("deck");
          store.setHint("On deck. Cast a line or return to the helm.");
        } else if (action.name === "boat:helm") {
          useAdventureSession.setState({ interior: null, panel: null });
          store.updateProgress((p) => ({
            ...p,
            adventure: { ...p.adventure, activeVehicleId: id },
          }));
          session.relocate(vehicle.position, vehicle.heading);
          store.setMode("boat");
        } else if (action.name === "boat:cabin") {
          if (vehicle.type !== "yacht") {
            store.setHint("The Mega Yacht has the cabin you can enter.");
            return;
          }
          enterInterior(id, "yacht", 3);
        } else if (
          ["boat:tender", "boat:jetski", "boat:utv", "boat:heli"].includes(
            action.name,
          )
        ) {
          const types: Record<string, string> = {
            "boat:tender": "minifishingboat",
            "boat:jetski": "jetski",
            "boat:utv": "utv",
            "boat:heli": "heli",
          };
          const result = launchYachtToy(
            useFourWheeler3dStore.getState().progress.adventure,
            id,
            types[action.name],
            heightAt,
          );
          if (!result.ok) {
            store.setHint(result.message);
            return;
          }
          store.updateProgress((p) => ({
            ...p,
            currentVehicle: result.vehicle.type,
            adventure: result.adventure,
          }));
          session.relocate(result.vehicle.position, result.vehicle.heading);
          store.setMode(
            isWatercraft(result.vehicle.type)
              ? "boat"
              : result.vehicle.type === "heli"
                ? "aircraft"
                : "vehicle",
          );
          store.setHint(
            "Extra launched. Return beside the yacht to load it again.",
          );
        } else {
          const transport = useAdventureSession.getState().transport;
          if (!transport || transport.vehicleId !== id) return;
          if (action.name === "boat:net" && vehicle.type === "yacht")
            useAdventureSession.setState({
              transport: { ...transport, netDeployed: !transport.netDeployed },
            });
          if (action.name === "boat:anchor")
            useAdventureSession.setState({
              transport: { ...transport, anchorDown: !transport.anchorDown },
            });
          if (action.name === "boat:lights")
            useAdventureSession.setState({
              transport: { ...transport, lightsOn: !transport.lightsOn },
            });
          if (action.name === "boat:canopy")
            useAdventureSession.setState({
              transport: { ...transport, canopyOpen: !transport.canopyOpen },
            });
        }
      }),
    [],
  );
  return <AirToyEffects />;
}

const FADED_POOF = new THREE.Color("#d8ddd3");

/** Remains alive across craft changes so a dropped toy lands after the pilot bails out. */
function AirToyEffects() {
  const effects = useRef(createAirEffects());
  const bombs = useRef<THREE.InstancedMesh>(null),
    poofs = useRef<THREE.InstancedMesh>(null),
    scorches = useRef<THREE.InstancedMesh>(null);
  const matrix = useRef(new THREE.Object3D()),
    color = useRef(new THREE.Color());
  const { playerPos, playerSpeedRef } = useGameContext();
  const audio = useRef<AudioContext | null>(null),
    soundCooldown = useRef(0);
  useEffect(() => {
    for (const mesh of [bombs.current, poofs.current, scorches.current])
      if (mesh) mesh.count = 0;
    const unsubscribe = useAdventureSession.subscribe((s, old) => {
      if (s.action?.name !== "air:bomb" || s.action.id === old.action?.id)
        return;
      const store = useFourWheeler3dStore.getState();
      if (store.mode !== "aircraft" || store.isPaused || !store.hasStarted)
        return;
      dropToyBomb(effects.current, {
        ...playerPos.current,
        heading: s.playerSnapshot.heading,
        speed: playerSpeedRef.current,
      });
      store.setHint("Toy bomb away! A bright poof tags nearby wildlife.");
    });
    return () => {
      unsubscribe();
      void audio.current?.close();
    };
  }, [playerPos, playerSpeedRef]);
  useFrame((_, rawDt) => {
    const store = useFourWheeler3dStore.getState();
    if (!store.hasStarted || store.isPaused) return;
    const dt = Math.min(rawDt, 0.1);
    soundCooldown.current = Math.max(0, soundCooldown.current - dt);
    stepAirEffects(effects.current, dt, heightAt, (p) => {
      useAdventureSession
        .getState()
        .requestAction("air:impact", JSON.stringify(p));
      if (store.progress.settings.soundEnabled && soundCooldown.current === 0) {
        soundCooldown.current = 0.12;
        try {
          const ctx = audio.current ?? (audio.current = new AudioContext());
          void ctx.resume();
          const buffer = ctx.createBuffer(
              1,
              Math.floor(ctx.sampleRate * 0.55),
              ctx.sampleRate,
            ),
            data = buffer.getChannelData(0);
          for (let i = 0; i < data.length; i++)
            data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
          const source = ctx.createBufferSource(),
            filter = ctx.createBiquadFilter(),
            gain = ctx.createGain();
          source.buffer = buffer;
          filter.type = "lowpass";
          filter.frequency.value = 700;
          gain.gain.value = 0.12;
          source.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          source.onended = () => {
            source.disconnect();
            filter.disconnect();
            gain.disconnect();
          };
          source.start();
        } catch {
          store.setHint("Poof! Sound is unavailable on this device.");
        }
      }
    });
    const m = matrix.current;
    if (bombs.current) {
      bombs.current.count = AIR_EFFECT_LIMITS.bombs;
      effects.current.bombs.forEach((b, i) => {
        m.position.set(b.x, b.y, b.z);
        m.rotation.set(0, 0, 0);
        m.scale.setScalar(b.active ? 0.22 : 0);
        m.updateMatrix();
        bombs.current!.setMatrixAt(i, m.matrix);
      });
      bombs.current.instanceMatrix.needsUpdate = true;
    }
    if (poofs.current) {
      poofs.current.count = AIR_EFFECT_LIMITS.particles;
      effects.current.particles.forEach((p, i) => {
        m.position.set(p.x, p.y, p.z);
        m.rotation.set(0, 0, 0);
        m.scale.setScalar(p.life > 0 ? 0.12 + (1 - p.life) * 0.7 : 0);
        m.updateMatrix();
        poofs.current!.setMatrixAt(i, m.matrix);
        color.current
          .set(p.fire ? "#efb847" : "#a3b6bd")
          .lerp(FADED_POOF, 1 - p.life);
        poofs.current!.setColorAt(i, color.current);
      });
      poofs.current.instanceMatrix.needsUpdate = true;
      if (poofs.current.instanceColor)
        poofs.current.instanceColor.needsUpdate = true;
    }
    if (scorches.current) {
      scorches.current.count = effects.current.scorches.length;
      effects.current.scorches.forEach((p, i) => {
        m.position.set(p.x, p.y, p.z);
        m.rotation.set(-Math.PI / 2, 0, 0);
        m.scale.setScalar(p.radius);
        m.updateMatrix();
        scorches.current!.setMatrixAt(i, m.matrix);
      });
      scorches.current.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group name="toy-bomb-effects">
      <instancedMesh
        ref={bombs}
        args={[undefined, undefined, AIR_EFFECT_LIMITS.bombs]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#eac248" roughness={0.5} />
      </instancedMesh>
      <instancedMesh
        ref={poofs}
        args={[undefined, undefined, AIR_EFFECT_LIMITS.particles]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial transparent opacity={0.65} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={scorches}
        args={[undefined, undefined, AIR_EFFECT_LIMITS.scorches]}
        frustumCulled={false}
      >
        <circleGeometry args={[1, 16]} />
        <meshBasicMaterial
          color="#574d3c"
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}
