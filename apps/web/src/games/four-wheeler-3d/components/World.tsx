"use client";

/**
 * Everything inside the Canvas: the sky, the streamed ground, the lake, the
 * hub and the weather. This is a fragment on purpose, so the scene fog
 * attaches to the scene itself.
 *
 * The rider is still a placeholder box. The real ATV, with its raycast
 * wheels and chase camera, arrives with the next milestone. It already
 * writes its position into the shared ref, which is what the chunk streamer,
 * the sun light and the weather all follow.
 */

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";

import { useFourWheeler3dStore } from "../lib/store";
import { SPAWN, useGameContext } from "../lib/gameContext";
import { readDevParams } from "../lib/devParams";
import { heightAt } from "../lib/terrain";
import { useTimeOfDay } from "../hooks/useTimeOfDay";
import type { Weather } from "../lib/dayNight";

import { ChunkStreamer } from "./ChunkStreamer";
import { Water } from "./Water";
import { Roads } from "./Roads";
import { Buildings } from "./Buildings";
import { GameSky } from "./Sky";
import { WeatherEffects } from "./Weather";

/** Where the camera watches from until the chase camera exists. */
const CAMERA_SPOT: [number, number, number] = [-400, 6, 24];

export function World() {
  // The live session clock, not the saved one. See lib/store.ts.
  const timeOfDay = useFourWheeler3dStore((state) => state.clock);
  const weather = useFourWheeler3dStore(
    (state) => state.progress.weather
  ) as Weather;
  const snowLevel = useFourWheeler3dStore((state) => state.snowLevel);

  useTimeOfDay();

  return (
    <>
      <GameSky timeOfDay={timeOfDay} weather={weather} />
      <WeatherEffects weather={weather} snowLevel={snowLevel} />
      <Buildings timeOfDay={timeOfDay} />
      <Roads />
      <Water />

      <Physics gravity={[0, -9.81, 0]}>
        <ChunkStreamer />
        <PlaceholderRider />
      </Physics>

      <FixedCamera />
    </>
  );
}

/** Point the camera at the yard until the chase camera takes over. */
function FixedCamera() {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.position.set(...CAMERA_SPOT);
    camera.lookAt(SPAWN[0], SPAWN[1] - 1, SPAWN[2]);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

/**
 * The stand-in rider. It is a real dynamic body, so it lands on the streamed
 * terrain and proves the collider and the mesh agree.
 */
function PlaceholderRider() {
  const { playerPos } = useGameContext();
  const bodyRef = useRef<RapierRigidBody>(null);

  // The development ?pos= parameter, so a screenshot can be taken anywhere.
  const [start] = useState<[number, number, number]>(() => {
    const { position } = readDevParams();
    if (!position) return [SPAWN[0], SPAWN[1], SPAWN[2]];
    return [position.x, heightAt(position.x, position.z) + 2, position.z];
  });

  useFrame(() => {
    const body = bodyRef.current;
    if (!body) return;
    const translation = body.translation();
    playerPos.current.set(translation.x, translation.y, translation.z);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders="cuboid"
      position={start}
      canSleep={false}
    >
      <mesh castShadow>
        <boxGeometry args={[1.2, 0.8, 1.9]} />
        <meshStandardMaterial color="#e63946" />
      </mesh>
    </RigidBody>
  );
}

export default World;
