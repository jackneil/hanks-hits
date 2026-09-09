"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAdventureSession } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import { isLandVehicle } from "../lib/catalog";
import { heightAt } from "../lib/terrain";
import { RACE_LOOP } from "../lib/landmarks";
import { tuningFor } from "../lib/vehicles";
import {
  advanceRace,
  createRace,
  ITEM_CHECKPOINTS,
  RACE_CHECKPOINTS,
  RACE_PRIZE,
  type RaceEvents,
  type RaceRun,
} from "../lib/race";
import { VehicleModel } from "./models";
import { WheelModel } from "./models/WheelModel";

export function Race() {
  const { playerPos } = useGameContext();
  const run = useRef<RaceRun | null>(null);
  const rival = useRef<THREE.Group>(null);
  const gate = useRef<THREE.Group>(null);
  const boxes = useRef<Array<THREE.Mesh | null>>([]);
  const events = useRef<RaceEvents>({ boost: false, finished: false });
  const reportAfter = useRef(0);
  const session = useAdventureSession((s) => s.race);
  const tuning = tuningFor(session?.vehicleType ?? "atv");

  useEffect(
    () =>
      useAdventureSession.subscribe((session, previous) => {
        if (session.generation !== previous.generation) {
          run.current = null;
          events.current = { boost: false, finished: false };
          reportAfter.current = 0;
          return;
        }
        const action = session.action;
        if (!action || action.id === previous.action?.id) return;
        const store = useFourWheeler3dStore.getState();
        if (action.name === "race:abandon") {
          run.current = null;
          useAdventureSession.setState({ race: null, waypoint: null });
          store.clearNos();
          store.setHint("Race ended. Back to free roaming.");
          return;
        }
        if (action.name !== "race:start" && action.name !== "race:retry")
          return;
        const fleet = store.progress.adventure.fleet;
        const current = fleet[store.progress.adventure.activeVehicleId ?? ""];
        const vehicle =
          current && isLandVehicle(current.type)
            ? current
            : Object.values(fleet).find((v) => isLandVehicle(v.type));
        if (!vehicle) {
          store.setHint("You need an owned ground vehicle to race.");
          return;
        }
        const state = createRace(
          vehicle.type,
          tuningFor(vehicle.type).maxSpeed + vehicle.speedUpgrade / 2.237,
        );
        run.current = state;
        const position = {
          x: -4,
          z: RACE_LOOP.half + 2,
          y: heightAt(-4, RACE_LOOP.half + 2) + 1.3,
        };
        store.updateProgress((p) => ({
          ...p,
          currentVehicle: vehicle.type,
          adventure: {
            ...p.adventure,
            activeVehicleId: vehicle.id,
            fleet: Object.fromEntries(
              Object.entries(p.adventure.fleet).map(([id, v]) => [
                id,
                id === vehicle.id
                  ? { ...v, position, heading: Math.PI / 2, parked: false }
                  : id === p.adventure.activeVehicleId
                    ? { ...v, parked: true }
                    : v,
              ]),
            ),
          },
        }));
        store.setMode("vehicle");
        store.clearNos();
        session.relocate(position, Math.PI / 2);
        useAdventureSession.setState({
          race: { ...state.session },
          panel: null,
          waypoint: {
            id: "race-next",
            label: "Race checkpoint 1",
            ...RACE_CHECKPOINTS[1],
          },
        });
      }),
    [],
  );

  useFrame((_, rawDelta) => {
    const state = run.current;
    if (!state) {
      if (rival.current) rival.current.visible = false;
      if (gate.current) gate.current.visible = false;
      return;
    }
    const store = useFourWheeler3dStore.getState();
    const paused =
      store.isPaused || Boolean(useAdventureSession.getState().panel);
    const dt = Math.min(rawDelta, 0.1);
    if (store.mode !== "vehicle" && state.session.phase !== "finished") {
      run.current = null;
      useAdventureSession.setState({ race: null, waypoint: null });
      return;
    }
    if (!paused) {
      const previousCheckpoint = state.session.checkpoint;
      advanceRace(state, playerPos.current, dt, events.current);
      if (events.current.boost) store.startNos();
      if (events.current.finished && !state.awarded) {
        state.awarded = true;
        if (state.session.winner === "player") {
          const elapsed = Math.round(state.session.elapsed * 1000);
          store.updateProgress((p) => ({
            ...p,
            money: p.money + RACE_PRIZE,
            totalEarned: p.totalEarned + RACE_PRIZE,
            racesWon: p.racesWon + 1,
            bestRaceTimeMs:
              p.bestRaceTimeMs > 0
                ? Math.min(p.bestRaceTimeMs, elapsed)
                : elapsed,
          }));
        }
        store.setHint(state.session.message);
        useAdventureSession.setState({ waypoint: null });
        useAdventureSession.getState().openPanel("race");
      } else if (state.session.checkpoint !== previousCheckpoint) {
        useAdventureSession.getState().setWaypoint({
          id: "race-next",
          label: `Race checkpoint ${state.session.checkpoint + 1}`,
          ...RACE_CHECKPOINTS[
            (state.session.checkpoint + 1) % RACE_CHECKPOINTS.length
          ],
        });
      }
    }
    const point = state.rival;
    if (rival.current) {
      rival.current.visible = true;
      rival.current.position.set(
        point.x,
        heightAt(point.x, point.z) + 0.8,
        point.z,
      );
      rival.current.rotation.y = point.heading;
    }
    if (gate.current) {
      const index = (state.session.checkpoint + 1) % RACE_CHECKPOINTS.length;
      const p = RACE_CHECKPOINTS[index],
        after = RACE_CHECKPOINTS[(index + 1) % RACE_CHECKPOINTS.length];
      gate.current.visible = state.session.phase !== "finished";
      gate.current.position.set(p.x, heightAt(p.x, p.z), p.z);
      gate.current.rotation.y = Math.atan2(after.x - p.x, after.z - p.z);
    }
    boxes.current.forEach((box, i) => {
      if (box) {
        box.visible =
          !state.session.nosBoxes[i] && state.session.phase !== "finished";
        if (!paused) box.rotation.y += dt;
      }
    });
    reportAfter.current += dt;
    if (reportAfter.current >= 0.1) {
      reportAfter.current = 0;
      useAdventureSession.setState({
        race: { ...state.session, nosBoxes: [...state.session.nosBoxes] },
      });
    }
  });

  return (
    <group name="race-course">
      <group ref={rival} visible={false}>
        <VehicleModel id={tuning.id} tuning={tuning} paint="#427ca0" />
        {tuning.wheelPositions.map(([x, y, z], i) => (
          <group key={i} position={[x, y - tuning.suspension.restLength, z]}>
            <WheelModel radius={tuning.wheelRadius} />
          </group>
        ))}
      </group>
      <group ref={gate} visible={false}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 5, 2, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 4, 8]} />
            <meshStandardMaterial
              color="#eac681"
              emissive="#eac681"
              emissiveIntensity={0.2}
            />
          </mesh>
        ))}
        <mesh position={[0, 4, 0]}>
          <boxGeometry args={[10.3, 0.3, 0.2]} />
          <meshStandardMaterial color="#eac681" />
        </mesh>
      </group>
      {ITEM_CHECKPOINTS.map((checkpoint, i) => {
        const p = RACE_CHECKPOINTS[checkpoint];
        return (
          <mesh
            key={i}
            ref={(mesh) => {
              boxes.current[i] = mesh;
            }}
            visible={Boolean(session)}
            position={[p.x, heightAt(p.x, p.z) + 1.3, p.z]}
          >
            <boxGeometry args={[1.4, 1.4, 1.4]} />
            <meshStandardMaterial
              color="#629cc2"
              emissive="#294658"
              emissiveIntensity={0.4}
            />
          </mesh>
        );
      })}
      <mesh
        position={[0, heightAt(0, RACE_LOOP.half) + 0.04, RACE_LOOP.half]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[1.1, RACE_LOOP.width]} />
        <meshStandardMaterial color="#ebe6d7" />
      </mesh>
    </group>
  );
}

export default Race;
