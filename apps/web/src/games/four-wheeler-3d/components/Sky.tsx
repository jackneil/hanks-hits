"use client";

/**
 * The sky, the sun, the moon, the stars and the fog.
 *
 * The sun light follows the player so its shadow box only has to cover the
 * 60 m the rider can actually see in detail. Everything past that is handled
 * by fog, which is also what hides the edge of the loaded chunks.
 */

import { useEffect, useRef } from "react";
import { Sky as DreiSky, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { nightFactor, skyColors, sunPosition, type Weather } from "../lib/dayNight";
import { useGameContext } from "../lib/gameContext";

/** How wide the shadow box around the player is, in meters. */
const SHADOW_BOX = 30;

/** How far up the sun light sits above the player. */
const SUN_DISTANCE = 90;

/** Scratch objects, so the render loop never allocates. */
const scratchSun = new THREE.Vector3();
const scratchColor = new THREE.Color();

export function GameSky({
  timeOfDay,
  weather,
}: {
  timeOfDay: number;
  weather: Weather;
}) {
  const { playerPos } = useGameContext();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const starsRef = useRef<THREE.Points>(null);
  const fogRef = useRef<THREE.Fog>(null);
  // The render loop needs the newest clock without re-subscribing each frame.
  const clockRef = useRef({ timeOfDay, weather });
  useEffect(() => {
    clockRef.current = { timeOfDay, weather };
  }, [timeOfDay, weather]);

  const palette = skyColors(timeOfDay, weather);
  const sun = sunPosition(timeOfDay);
  const night = nightFactor(timeOfDay);

  // The shadow box only has to change when the projection does.
  useEffect(() => {
    const light = sunRef.current;
    if (!light) return;
    light.shadow.camera.left = -SHADOW_BOX;
    light.shadow.camera.right = SHADOW_BOX;
    light.shadow.camera.top = SHADOW_BOX;
    light.shadow.camera.bottom = -SHADOW_BOX;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = SUN_DISTANCE * 2.4;
    light.shadow.bias = -0.0009;
    light.shadow.camera.updateProjectionMatrix();
  }, []);

  useFrame(() => {
    const player = playerPos.current;
    const direction = sunPosition(clockRef.current.timeOfDay);
    scratchSun.set(direction[0], Math.abs(direction[1]), direction[2]);

    const light = sunRef.current;
    if (light) {
      light.position
        .copy(scratchSun)
        .multiplyScalar(SUN_DISTANCE)
        .add(player);
      light.target.position.copy(player);
      light.target.updateMatrixWorld();
    }

    const moon = moonRef.current;
    if (moon) {
      moon.position.set(player.x - 40, player.y + 70, player.z + 30);
      moon.target.position.copy(player);
      moon.target.updateMatrixWorld();
    }

    const stars = starsRef.current;
    if (stars) stars.position.set(player.x, 0, player.z);
  });

  // A fragment, not a group: the fog must attach to the scene itself, and
  // R3F attaches an element to whichever object is directly above it.
  return (
    <>
      <DreiSky
        distance={4000}
        sunPosition={sun}
        turbidity={weather === "sunny" ? 3 : 9}
        rayleigh={night > 0.5 ? 0.15 : 1.4}
        mieCoefficient={0.006}
        mieDirectionalG={0.85}
      />

      <StarField nightAmount={night} pointsRef={starsRef} />

      <fog
        ref={fogRef}
        attach="fog"
        args={[
          scratchColor.set(palette.fog).getHex(),
          palette.fogNear,
          palette.fogFar,
        ]}
      />

      <ambientLight intensity={palette.ambientIntensity} color={palette.skyBottom} />

      <directionalLight
        ref={sunRef}
        castShadow
        intensity={palette.sunIntensity}
        color={night > 0.2 ? "#ffd9a8" : "#fff6e0"}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      {/* A soft blue moon so night is dim, never pitch black. */}
      <directionalLight
        ref={moonRef}
        intensity={night * 0.5}
        color="#9fb6ff"
      />
    </>
  );
}

/**
 * The stars, faded in by how dark it is. Drei's star material has no opacity
 * to turn down, so the fade dims the star colours instead. It is done once a
 * second at most, and only when the darkness has actually moved.
 */
function StarField({
  nightAmount,
  pointsRef,
}: {
  nightAmount: number;
  pointsRef: React.RefObject<THREE.Points | null>;
}) {
  const applied = useRef(-1);

  useEffect(() => {
    const stars = pointsRef.current;
    if (!stars) return;
    if (Math.abs(applied.current - nightAmount) < 0.02) return;
    applied.current = nightAmount;

    stars.visible = nightAmount > 0.02;
    const colors = stars.geometry.getAttribute("color");
    if (!colors) return;
    const array = colors.array as Float32Array;
    for (let i = 0; i < array.length; i++) array[i] = 0.9 * nightAmount;
    colors.needsUpdate = true;
  }, [nightAmount, pointsRef]);

  return <Stars ref={pointsRef} radius={900} depth={60} count={1400} factor={5} fade speed={0.4} />;
}

export default GameSky;
