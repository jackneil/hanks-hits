"use client";

/**
 * Everything inside the Canvas: the sky, the streamed ground, the lake, the
 * hub and the weather. This is a fragment on purpose, so the scene fog
 * attaches to the scene itself.
 *
 * The rider is the ATV: a raycast vehicle with a chase camera behind it. It
 * writes its position into the shared ref, which is what the chunk streamer,
 * the sun light and the weather all follow.
 */

import { useCallback, useRef, useState } from "react";
import { Physics } from "@react-three/rapier";

import { useFourWheeler3dStore } from "../lib/store";
import { sounds } from "../lib/sounds";
import type { GameControls } from "../hooks/useControls";
import { readDevParams } from "../lib/devParams";
import { heightAt } from "../lib/terrain";
import { useTimeOfDay } from "../hooks/useTimeOfDay";
import type { Weather } from "../lib/dayNight";

import { ChunkStreamer } from "./ChunkStreamer";
import { Vehicle } from "./Vehicle";
import { Effects } from "./Effects";
import { ChaseCamera, type LandingReport } from "./ChaseCamera";
import { Water } from "./Water";
import { Roads } from "./Roads";
import { Buildings } from "./Buildings";
import { OutdoorEnvironment } from "./OutdoorEnvironment";
import { GameSky } from "./Sky";
import { WeatherEffects } from "./Weather";
import { useAdventureSession } from "../lib/adventureSession";
import { isAirVehicle, isWaterVehicle } from "../lib/catalog";
import { tuningFor, type VehicleId } from "../lib/vehicles";
import { Player } from "./Player";
import { Dog } from "./Dog";
import { AdventureRuntime } from "./AdventureRuntime";
import { Fleet } from "./Fleet";
import { Hunting } from "./Hunting";
import { Transport, TransportActions } from "./Transport";
import { HomeLife } from "./HomeLife";
import { InteractionMarker } from "./InteractionMarker";
import { DeliveryVisuals } from "./DeliveryVisuals";
import { Properties } from "./Properties";
import { Farm } from "./Farm";
import { Race } from "./Race";
import { Fishing } from "./Fishing";
import { Train } from "./Train";
import { Space } from "./Space";
import { Activities } from "./Activities";
import { savedRider } from "../lib/migration";

/** Anything longer in the air than this lands with a real thump. */
const BIG_AIR_SECONDS = 1.2;

export type WorldProps = {
  /** Keyboard, touch and tilt, read once per step. */
  controls: GameControls;
  /** Called every frame with the speed, for the speedometer. */
  onSpeed: (metersPerSecond: number) => void;
};

export function World({ controls, onSpeed }: WorldProps) {
  // The live session clock, not the saved one. See lib/store.ts.
  const timeOfDay = useFourWheeler3dStore((state) => state.clock);
  const weather = useFourWheeler3dStore(
    (state) => state.progress.weather,
  ) as Weather;
  const snowLevel = useFourWheeler3dStore((state) => state.snowLevel);
  const mode = useFourWheeler3dStore((s) => s.mode);
  const inSpace = mode === "space" || mode === "planet";
  const adventure = useFourWheeler3dStore((s) => s.progress.adventure);
  const active = adventure.activeVehicleId
    ? adventure.fleet[adventure.activeVehicleId]
    : null;
  const paused = useFourWheeler3dStore((s) => s.isPaused || !s.hasStarted);
  const panel = useAdventureSession((s) => s.panel);

  useTimeOfDay();

  // Where the landing shake comes from. The vehicle writes it, the camera
  // reads it, and nothing re-renders in between.
  const landing = useRef<LandingReport>({ id: 0, airtime: 0 });

  const handleAir = useCallback((seconds: number) => {
    landing.current.id += 1;
    landing.current.airtime = seconds;
    sounds.playThud(Math.min(1, seconds / BIG_AIR_SECONDS));
  }, []);

  // The development ?pos= parameter, so a screenshot can be taken anywhere.
  const [spawn] = useState<[number, number, number]>(() => {
    const { position } = readDevParams();
    if (!position) {
      const p = savedRider(
        useFourWheeler3dStore.getState().progress.adventure,
      ).position;
      return [p.x, Math.max(p.y, heightAt(p.x, p.z) + 1.1), p.z];
    }
    return [position.x, heightAt(position.x, position.z) + 2, position.z];
  });

  return (
    <>
      {!inSpace && (
        <>
          <GameSky timeOfDay={timeOfDay} weather={weather} />
          <OutdoorEnvironment timeOfDay={timeOfDay} />
          <WeatherEffects weather={weather} snowLevel={snowLevel} />
          <Roads />
          <DeliveryVisuals />
          <Water />
        </>
      )}

      <Physics gravity={[0, -9.81, 0]} paused={paused || !!panel}>
        {!inSpace && (
          <>
            <Buildings timeOfDay={timeOfDay} />
            <ChunkStreamer />
            <Fleet />
            {mode === "vehicle" && active && (
              <Vehicle
                key={active.id}
                id={tuningFor(active.type).id}
                spawn={
                  active.position.y
                    ? [active.position.x, active.position.y, active.position.z]
                    : spawn
                }
                heading={active.heading}
                speedUpgrade={active.speedUpgrade}
                getControls={controls.getControlValues}
                takeOneShot={controls.takeOneShot}
                onSpeed={onSpeed}
                onAir={handleAir}
              />
            )}
            {![
              "vehicle",
              "boat",
              "aircraft",
              "train",
              "space",
              "planet",
            ].includes(mode) && <Player controls={controls} />}
            {active && ["boat", "aircraft"].includes(mode) && (
              <Transport
                key={active.id}
                vehicle={active}
                controls={controls}
                onSpeed={onSpeed}
              />
            )}
            <TransportActions />
            <Dog />
            <Hunting />
            <HomeLife />
            <Farm />
            <Properties />
            <InteractionMarker />
            <Race />
            <Fishing />
            <Activities />
            <Effects />
            <ChaseCamera
              id={
                (active &&
                !isAirVehicle(active.type) &&
                !isWaterVehicle(active.type)
                  ? tuningFor(active.type).id
                  : "foot") as VehicleId
              }
              takeOneShot={controls.takeOneShot}
              landing={landing}
            />
          </>
        )}
        <Space
          getControls={controls.getControlValues}
          takeOneShot={controls.takeOneShot}
        />
        <Train
          getControls={controls.getControlValues}
          takeOneShot={controls.takeOneShot}
        />
        <AdventureRuntime controls={controls} />
      </Physics>
    </>
  );
}

export default World;
