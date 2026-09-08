"use client";

/**
 * Rain, snow and the snow blanket on the ground.
 *
 * Both kinds of weather use one point cloud of 1500 particles that rides
 * along with the player and recycles anything that falls past his feet. The
 * buffer is made once, so the render loop only moves numbers.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { Weather } from "../lib/dayNight";
import { useGameContext } from "../lib/gameContext";
import { setTerrainSnowLevel } from "./terrainMaterial";

/** How many drops or flakes are in the air at once. */
const PARTICLES = 1500;

/** The box the weather falls inside, centred on the player. */
const SPREAD = 60;
const CEILING = 40;

/**
 * A tiny repeatable number source. The starting scatter is built during a
 * render, so it has to be the same every time the component runs.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function WeatherEffects({
  weather,
  snowLevel,
}: {
  weather: Weather;
  snowLevel: number;
}) {
  const { playerPos } = useGameContext();
  const pointsRef = useRef<THREE.Points>(null);
  const recycleRef = useRef(seeded(0xfa11));

  // The ground's snow blanket lives in the shared terrain material.
  useEffect(() => setTerrainSnowLevel(snowLevel), [snowLevel]);

  const geometry = useMemo(() => {
    const random = seeded(0x5eed);
    const positions = new Float32Array(PARTICLES * 3);
    for (let i = 0; i < PARTICLES; i++) {
      positions[i * 3] = (random() - 0.5) * SPREAD * 2;
      positions[i * 3 + 1] = random() * CEILING;
      positions[i * 3 + 2] = (random() - 0.5) * SPREAD * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Rain and snow look different, so each gets its own material rather than
  // one material that is edited after the fact.
  const material = useMemo(() => {
    const rain = weather === "rainy";
    return new THREE.PointsMaterial({
      color: rain ? "#b9d3ef" : "#ffffff",
      size: rain ? 0.32 : 0.75,
      opacity: rain ? 0.6 : 0.9,
      transparent: true,
      depthWrite: false,
    });
  }, [weather]);

  useEffect(() => () => material.dispose(), [material]);

  const falling = weather === "rainy" || weather === "snowy";

  useFrame((_state, delta) => {
    if (!falling) return;
    const points = pointsRef.current;
    if (!points) return;
    const recycle = recycleRef.current;

    const player = playerPos.current;
    points.position.set(player.x, 0, player.z);

    const attribute = points.geometry.getAttribute("position");
    const array = attribute.array as Float32Array;
    const fall = weather === "rainy" ? 26 : 3.2;
    const drift = weather === "rainy" ? 2 : 0.9;
    const step = Math.min(delta, 0.1);

    for (let i = 0; i < PARTICLES; i++) {
      const at = i * 3;
      array[at + 1] -= fall * step;
      array[at] += drift * step;
      if (array[at + 1] < -6) {
        // Back to the top of the box, in a fresh spot.
        array[at + 1] = CEILING;
        array[at] = (recycle() - 0.5) * SPREAD * 2;
        array[at + 2] = (recycle() - 0.5) * SPREAD * 2;
      }
      if (array[at] > SPREAD) array[at] -= SPREAD * 2;
    }
    attribute.needsUpdate = true;
  });

  if (!falling) return null;

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

export default WeatherEffects;
