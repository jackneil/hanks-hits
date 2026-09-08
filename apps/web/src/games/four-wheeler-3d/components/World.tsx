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
import { SPAWN } from "../lib/gameContext";
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
    (state) => state.progress.weather
  ) as Weather;
  const snowLevel = useFourWheeler3dStore((state) => state.snowLevel);

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
    if (!position) return [SPAWN[0], SPAWN[1], SPAWN[2]];
    return [position.x, heightAt(position.x, position.z) + 2, position.z];
  });

  return (
    <>
      <GameSky timeOfDay={timeOfDay} weather={weather} />
      <OutdoorEnvironment timeOfDay={timeOfDay} />
      <WeatherEffects weather={weather} snowLevel={snowLevel} />
      <Buildings timeOfDay={timeOfDay} />
      <Roads />
      <Water />

      <Physics gravity={[0, -9.81, 0]}>
        <ChunkStreamer />
        <Vehicle
          id="atv"
          spawn={spawn}
          getControls={controls.getControlValues}
          takeOneShot={controls.takeOneShot}
          onSpeed={onSpeed}
          onAir={handleAir}
        />
        <Effects />
        <ChaseCamera
          id="atv"
          takeOneShot={controls.takeOneShot}
          landing={landing}
        />
      </Physics>
    </>
  );
}

export default World;
