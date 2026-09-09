"use client";

/**
 * Dust and tire tracks.
 *
 * Both are fixed size pools that are written round and round: 300 dust specks
 * and 600 track marks, which is two marks (one per rear wheel) every 0.6 m,
 * so the trail behind the rider is the last 180 meters of riding. Nothing is
 * created or thrown away while the game runs, which is what keeps a long ride
 * from stuttering. The oldest mark fades into the ground as a new one is laid.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { useGameContext } from "../lib/gameContext";
import { useFourWheeler3dStore } from "../lib/store";
import { heightAt, surfaceAt, type Surface } from "../lib/terrain";

/** How many dust specks may be in the air at once. */
const DUST_COUNT = 300;

/** How long one speck lives, in seconds. */
const DUST_LIFETIME = 0.8;

/** Below this speed the wheels do not kick anything up. */
const DUST_MIN_SPEED = 3;

/** How many track marks the ground remembers. */
const TRACK_COUNT = 600;

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
const trackNormal = new THREE.Vector3(),
  trackForward = new THREE.Vector3(),
  trackRight = new THREE.Vector3(),
  trackBasis = new THREE.Matrix4();

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
  dirt: new THREE.Color("#302920"),
  grass: new THREE.Color("#283323"),
  sand: new THREE.Color("#5a503e"),
  snow: new THREE.Color("#778a99"),
  water: new THREE.Color("#283323"),
};

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

/** Four chevron blocks with soft edges and a center drainage gap, authored locally. */
function makeTreadTexture() {
  const width = 96,
    height = 192,
    data = new Uint8Array(width * height * 4);
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = ((x + 0.5) / width) * 2 - 1,
        v = (y + 0.5) / height,
        edge = 1 - smooth(0.68, 0.99, Math.abs(u)),
        ends = smooth(0, 0.08, v) * (1 - smooth(0.92, 1, v));
      const phase = (v * 4 + Math.abs(u) * 0.45) % 1,
        block = smooth(0.04, 0.1, phase) * (1 - smooth(0.39, 0.46, phase)),
        groove = smooth(0.035, 0.12, Math.abs(u));
      const grain = 0.86 + 0.14 * Math.sin(x * 12.9898 + y * 78.233),
        alpha = edge * ends * (0.07 + block * groove * 0.83) * grain,
        i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  const texture = new THREE.DataTexture(data, width, height);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
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
  const trail = useRef({
    next: 0,
    sinceLast: 0,
    last: new THREE.Vector3(),
    seeded: false,
  });
  const markSurfaces = useRef<Array<Surface | null>>(
    Array(TRACK_COUNT).fill(null),
  );
  const wasSnow = useRef(false);

  const treadTexture = useMemo(() => makeTreadTexture(), []);
  const trackGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(TRACK_WIDTH, TRACK_LENGTH);
    geometry.setAttribute(
      "instanceFade",
      new THREE.InstancedBufferAttribute(new Float32Array(TRACK_COUNT), 1),
    );
    return geometry;
  }, []);
  const trackMaterial = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      map: treadTexture,
      transparent: true,
      opacity: 0.72,
      roughness: 1,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float instanceFade;varying float vTrackFade;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvTrackFade=instanceFade;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vTrackFade;",
        )
        .replace(
          "#include <alphamap_fragment>",
          "#include <alphamap_fragment>\ndiffuseColor.a *= vTrackFade;",
        );
    };
    material.customProgramCacheKey = () => "ground-tread-fade-v1";
    return material;
  }, [treadTexture]);
  useEffect(() => {
    const marks = tracks.current;
    if (marks) {
      scratchMatrix.makeScale(0, 0, 0);
      for (let i = 0; i < TRACK_COUNT; i++) marks.setMatrixAt(i, scratchMatrix);
      marks.instanceMatrix.needsUpdate = true;
    }
    return () => {
      treadTexture.dispose();
      trackGeometry.dispose();
      trackMaterial.dispose();
    };
  }, [treadTexture, trackGeometry, trackMaterial]);

  const dustTexture = useMemo(() => makeDustTexture(), []);
  useEffect(() => () => dustTexture?.dispose(), [dustTexture]);

  const dustGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(makeDustPool().positions, 3),
    );
    return geometry;
  }, []);
  useEffect(() => {
    dust.current.positions = dustGeometry.getAttribute("position")
      .array as Float32Array<ArrayBuffer>;
  }, [dustGeometry]);
  useEffect(() => () => dustGeometry.dispose(), [dustGeometry]);

  useFrame((_, rawDelta) => {
    // A tab that was in the background comes back with a huge delta.
    const delta = Math.min(rawDelta, 0.1);
    const position = playerPos.current;
    const speed = Math.abs(playerSpeedRef.current);
    const store = useFourWheeler3dStore.getState();
    if (!store.hasStarted || store.isPaused) return;
    const baseSurface = surfaceAt(position.x, position.z);
    const snowy = store.snowLevel > 0.15;
    const surface: Surface =
      snowy && baseSurface !== "water" ? "snow" : baseSurface;
    if (wasSnow.current && !snowy && tracks.current) {
      for (let i = 0; i < TRACK_COUNT; i++)
        if (markSurfaces.current[i] === "snow") {
          scratchMatrix.makeScale(0, 0, 0);
          tracks.current.setMatrixAt(i, scratchMatrix);
          markSurfaces.current[i] = null;
        }
      tracks.current.instanceMatrix.needsUpdate = true;
    }
    wasSnow.current = snowy;
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
    if (
      store.mode === "vehicle" &&
      onGround &&
      speed > DUST_MIN_SPEED &&
      surface !== "water"
    ) {
      dust.current.carry +=
        dustPerSecond(surface) * delta * Math.min(1, speed / 12);
      while (dust.current.carry >= 1) {
        dust.current.carry -= 1;
        const i = dust.current.next;
        dust.current.next = (dust.current.next + 1) % DUST_COUNT;
        const side = i % 2 === 0 ? rearLeft : rearRight;
        scratchSpot
          .copy(side)
          .applyQuaternion(playerQuat.current)
          .add(position);
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
      (
        points.current.geometry.attributes.position as THREE.BufferAttribute
      ).needsUpdate = true;
    }

    // Lay a mark under each back wheel on ground that holds a print.
    const marks = tracks.current;
    const frameDistance = trail.current.seeded
      ? trail.current.last.distanceTo(position)
      : 0;
    if (!trail.current.seeded || frameDistance > 20) {
      trail.current.last.copy(position);
      trail.current.sinceLast = 0;
      trail.current.seeded = true;
    }
    if (
      marks &&
      store.mode === "vehicle" &&
      onGround &&
      holdsAPrint(surface) &&
      speed > 1
    ) {
      trail.current.sinceLast += frameDistance > 20 ? 0 : frameDistance;
      let laid = false;

      while (trail.current.sinceLast >= TRACK_SPACING) {
        trail.current.sinceLast -= TRACK_SPACING;
        laid = true;

        // Distribute marks over the actual traveled segment, even at low frame rates.
        const fraction =
          frameDistance > 0
            ? Math.max(0, 1 - trail.current.sinceLast / frameDistance)
            : 1;

        for (let wheel = 0; wheel < REAR_WHEELS.length; wheel += 1) {
          const side = REAR_WHEELS[wheel];
          const i = trail.current.next;
          trail.current.next = (trail.current.next + 1) % TRACK_COUNT;
          scratchSpot
            .copy(side)
            .applyQuaternion(playerQuat.current)
            .addScaledVector(trail.current.last, 1 - fraction)
            .addScaledVector(position, fraction);
          scratchSpot.y = heightAt(scratchSpot.x, scratchSpot.z) + 0.014;
          trackNormal
            .set(
              heightAt(scratchSpot.x - 0.2, scratchSpot.z) -
                heightAt(scratchSpot.x + 0.2, scratchSpot.z),
              0.4,
              heightAt(scratchSpot.x, scratchSpot.z - 0.2) -
                heightAt(scratchSpot.x, scratchSpot.z + 0.2),
            )
            .normalize();
          trackForward.set(0, 0, 1).applyQuaternion(playerQuat.current);
          trackRight.crossVectors(trackNormal, trackForward).normalize();
          trackForward.crossVectors(trackRight, trackNormal).negate();
          trackBasis.makeBasis(trackRight, trackForward, trackNormal);
          scratchQuat.setFromRotationMatrix(trackBasis);
          scratchMatrix.compose(scratchSpot, scratchQuat, scratchScale);
          marks.setMatrixAt(i, scratchMatrix);
          markSurfaces.current[i] = surface;
        }
      }

      if (laid) {
        // Repaint the ring from newest to oldest, so the trail tapers off
        // into the ground behind the rider.

        for (let step = 0; step < TRACK_COUNT; step += 1) {
          const age = step / TRACK_COUNT;
          const index =
            (trail.current.next - 1 - step + TRACK_COUNT * 2) % TRACK_COUNT;
          scratchColor.copy(
            TRACK_COLORS[markSurfaces.current[index] ?? surface],
          );
          trackGeometry
            .getAttribute("instanceFade")
            .setX(
              index,
              markSurfaces.current[index] ? (1 - age) * (1 - age) : 0,
            );
          marks.setColorAt(index, scratchColor);
        }
        trackGeometry.getAttribute("instanceFade").needsUpdate = true;
        marks.instanceMatrix.needsUpdate = true;
        if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
      }
    } else trail.current.sinceLast = 0;
    trail.current.last.copy(position);
  });

  return (
    <>
      <points ref={points} geometry={dustGeometry} frustumCulled={false}>
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
        args={[trackGeometry, trackMaterial, TRACK_COUNT]}
        receiveShadow
        frustumCulled={false}
      />
    </>
  );
}

export default Effects;
