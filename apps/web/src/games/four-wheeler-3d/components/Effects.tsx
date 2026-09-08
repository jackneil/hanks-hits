"use client";

/**
 * Dust and tire tracks.
 *
 * Both are fixed size pools that are written round and round: 300 dust specks
 * and 400 track marks, which is two marks (one per rear wheel) every 0.6 m,
 * so the trail behind the rider is the last 120 meters of riding. Nothing is
 * created or thrown away while the game runs, which is what keeps a long ride
 * from stuttering. The oldest mark fades into the ground as a new one is laid.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { useGameContext } from "../lib/gameContext";
import { heightAt, surfaceAt, type Surface } from "../lib/terrain";

/** How many dust specks may be in the air at once. */
const DUST_COUNT = 300;

/** How long one speck lives, in seconds. */
const DUST_LIFETIME = 0.8;

/** Below this speed the wheels do not kick anything up. */
const DUST_MIN_SPEED = 3;

/** How many track marks the ground remembers. */
const TRACK_COUNT = 400;

/** How far the vehicle travels between two pairs of marks, in meters. */
const TRACK_SPACING = 0.6;

/** One mark: as wide as a tire and as long as the spacing. */
const TRACK_WIDTH = 0.22;
const TRACK_LENGTH = 0.6;

/** A speck parked here is out of play and out of sight. */
const PARKED_Y = -10000;

/** Where the back wheels meet the ground, in vehicle space. */
const rearLeft = new THREE.Vector3(0.39, 0, -0.79);
const rearRight = new THREE.Vector3(-0.39, 0, -0.79);

/** Both back wheels, held in one array so no frame ever builds one. */
const REAR_WHEELS = [rearLeft, rearRight];

const scratchSpot = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3(1, 1, 1);
const scratchColor = new THREE.Color();

/** Turned face up, so a mark lies on the ground. */
const FLAT_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0)
);

/** Dust is thicker where the ground is loose. */
function dustPerSecond(surface: Surface): number {
  if (surface === "sand") return 90;
  if (surface === "dirt") return 70;
  if (surface === "snow") return 50;
  return 30;
}

/**
 * The color a tire leaves on each kind of ground.
 *
 * Each one is a darker version of the ground it is pressed into, so a mark
 * reads as a rut rather than as a sticker laid on top.
 */
const TRACK_COLORS: Record<Surface, THREE.Color> = {
  dirt: new THREE.Color("#6b4f2a"),
  grass: new THREE.Color("#3f6a2c"),
  sand: new THREE.Color("#9c8657"),
  snow: new THREE.Color("#8fa6bd"),
  water: new THREE.Color("#3f6a2c"),
};

/** What an old mark fades to before it is written over. */
const FADED_TRACK_COLOR = new THREE.Color("#6d6a5c");

/** Ground a tire cannot print on. */
function holdsAPrint(surface: Surface): boolean {
  return surface !== "water";
}

/**
 * A soft round speck, drawn once into a canvas.
 *
 * A point with no texture draws as a hard square, which is what makes cheap
 * dust look like flying bricks. This paints a circle that fades to nothing at
 * its edge. It is drawn in the browser at run time, so no file is loaded.
 */
function makeDustTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.5)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** One fixed pool of dust specks, made once when the game mounts. */
function makeDustPool() {
  const positions = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i += 1) positions[i * 3 + 1] = PARKED_Y;
  return {
    positions,
    velocity: new Float32Array(DUST_COUNT * 3),
    life: new Float32Array(DUST_COUNT),
    next: 0,
    /** Part of a speck left over from the last frame. */
    carry: 0,
  };
}

export function Effects() {
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();

  const points = useRef<THREE.Points>(null);
  const tracks = useRef<THREE.InstancedMesh>(null);
  const dust = useRef(makeDustPool());
  const trail = useRef({ next: 0, sinceLast: TRACK_SPACING });

  const dustTexture = useMemo(() => makeDustTexture(), []);
  useEffect(() => () => dustTexture?.dispose(), [dustTexture]);

  // The pool is only ever touched outside render: here, where the points get
  // their position attribute, and inside the frame loop.
  useEffect(() => {
    const cloud = points.current;
    if (!cloud) return;
    cloud.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(dust.current.positions, 3)
    );
  }, []);

  useFrame((_, rawDelta) => {
    // A tab that was in the background comes back with a huge delta.
    const delta = Math.min(rawDelta, 0.1);
    const position = playerPos.current;
    const speed = Math.abs(playerSpeedRef.current);
    const surface = surfaceAt(position.x, position.z);
    const ground = heightAt(position.x, position.z);
    const onGround = position.y - ground < 2;

    // Move the dust that is already in the air.
    for (let i = 0; i < DUST_COUNT; i += 1) {
      if (dust.current.life[i] <= 0) continue;
      dust.current.life[i] -= delta;
      if (dust.current.life[i] <= 0) {
        dust.current.positions[i * 3 + 1] = PARKED_Y;
        continue;
      }
      dust.current.positions[i * 3] += dust.current.velocity[i * 3] * delta;
      dust.current.positions[i * 3 + 1] +=
        dust.current.velocity[i * 3 + 1] * delta;
      dust.current.positions[i * 3 + 2] +=
        dust.current.velocity[i * 3 + 2] * delta;
      // Dust slows down and settles.
      dust.current.velocity[i * 3] *= 0.94;
      dust.current.velocity[i * 3 + 2] *= 0.94;
      dust.current.velocity[i * 3 + 1] -= 0.6 * delta;
    }

    // Kick up new dust behind the back wheels.
    if (onGround && speed > DUST_MIN_SPEED && surface !== "water") {
      dust.current.carry +=
        dustPerSecond(surface) * delta * Math.min(1, speed / 12);
      while (dust.current.carry >= 1) {
        dust.current.carry -= 1;
        const i = dust.current.next;
        dust.current.next = (dust.current.next + 1) % DUST_COUNT;
        const side = i % 2 === 0 ? rearLeft : rearRight;
        scratchSpot.copy(side).applyQuaternion(playerQuat.current).add(position);
        dust.current.positions[i * 3] = scratchSpot.x;
        dust.current.positions[i * 3 + 1] = ground + 0.15;
        dust.current.positions[i * 3 + 2] = scratchSpot.z;
        dust.current.velocity[i * 3] = (Math.random() - 0.5) * 1.6;
        dust.current.velocity[i * 3 + 1] = 0.7 + Math.random() * 0.8;
        dust.current.velocity[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
        dust.current.life[i] = DUST_LIFETIME;
      }
    }

    if (points.current) {
      (points.current.geometry.attributes.position as THREE.BufferAttribute)
        .needsUpdate = true;
    }

    // Lay a mark under each back wheel on ground that holds a print.
    const marks = tracks.current;
    if (marks && onGround && holdsAPrint(surface) && speed > 1) {
      trail.current.sinceLast += speed * delta;
      let laid = false;

      while (trail.current.sinceLast >= TRACK_SPACING) {
        trail.current.sinceLast -= TRACK_SPACING;
        laid = true;

        // The mark lies flat and points the way the vehicle is going.
        scratchQuat.copy(playerQuat.current).multiply(FLAT_QUAT);

        for (let wheel = 0; wheel < REAR_WHEELS.length; wheel += 1) {
          const side = REAR_WHEELS[wheel];
          const i = trail.current.next;
          trail.current.next = (trail.current.next + 1) % TRACK_COUNT;
          scratchSpot
            .copy(side)
            .applyQuaternion(playerQuat.current)
            .add(position);
          scratchSpot.y = heightAt(scratchSpot.x, scratchSpot.z) + 0.02;
          scratchMatrix.compose(scratchSpot, scratchQuat, scratchScale);
          marks.setMatrixAt(i, scratchMatrix);
        }
      }

      if (laid) {
        // Repaint the ring from newest to oldest, so the trail tapers off
        // into the ground behind the rider.
        const fresh = TRACK_COLORS[surface];
        for (let step = 0; step < TRACK_COUNT; step += 1) {
          const age = step / TRACK_COUNT;
          const index =
            (trail.current.next - 1 - step + TRACK_COUNT * 2) % TRACK_COUNT;
          scratchColor.copy(fresh).lerp(FADED_TRACK_COLOR, age);
          marks.setColorAt(index, scratchColor);
        }
        marks.instanceMatrix.needsUpdate = true;
        if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <>
      <points ref={points} frustumCulled={false}>
        <pointsMaterial
          color="#c9b48f"
          size={0.4}
          sizeAttenuation
          map={dustTexture}
          alphaMap={dustTexture}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </points>

      <instancedMesh
        ref={tracks}
        args={[undefined, undefined, TRACK_COUNT]}
        frustumCulled={false}
      >
        <planeGeometry args={[TRACK_WIDTH, TRACK_LENGTH]} />
        <meshBasicMaterial
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </>
  );
}

export default Effects;
