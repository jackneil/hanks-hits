"use client";

/**
 * The camera that rides behind the ATV.
 *
 * It hangs back and above the seat and catches up on a spring, so a turn
 * swings the view instead of snapping it. The view widens as you speed up, a
 * landing gives it a short shake, and a ray keeps it from sliding inside a
 * hill. Pressing C puts it inside the helmet instead.
 *
 * The frame loop allocates nothing: every vector lives at the top of the file.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";

import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import {
  CHASE_DEFAULTS,
  chaseTarget,
  fovForSpeed,
  shakeOffset,
  springStep,
  type SpringState,
  type Vec3,
} from "../lib/camera";
import { tuningFor, type VehicleId } from "../lib/vehicles";
import type { ControlValues } from "../lib/controls";

/** How hard the camera pulls toward where it wants to be. */
const SPRING_STIFFNESS = 90;

/** How far in front of the terrain the camera stops, in meters. */
const CLEARANCE = 0.3;

/** Where the rider's eyes are, in chassis space. */
const HELMET_OFFSET = new THREE.Vector3(0, 1.15, 0.1);

/** The camera looks at a point this far above the middle of the vehicle. */
const LOOK_UP = 1;

/** A landing shorter than this is a bump, not a jump. */
const SHAKE_MIN_AIRTIME = 0.3;

/** The biggest landing shake, in meters. */
const SHAKE_MAX = 0.35;

/** The one spring setting, made once so the frame loop allocates nothing. */
const SPRING = { stiffness: SPRING_STIFFNESS };

const desired: Vec3 = { x: 0, y: 0, z: 0 };
const shake: Vec3 = { x: 0, y: 0, z: 0 };
const seat = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const helmetSpot = new THREE.Vector3();

export type LandingReport = {
  /** Counts up by one on every landing, so the camera can spot a new one. */
  id: number;
  /** How long the vehicle was in the air. */
  airtime: number;
};

export type ChaseCameraProps = {
  id: VehicleId;
  getControls: () => ControlValues;
  /** Written by the vehicle when it touches down. */
  landing: React.RefObject<LandingReport>;
};

export function ChaseCamera({ id, getControls, landing }: ChaseCameraProps) {
  const camera = useThree((state) => state.camera);
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  const { world, rapier } = useRapier();
  const tuning = tuningFor(id);

  const helmetCam = useFourWheeler3dStore(
    (state) => state.progress.settings.helmetCam
  );
  const updateSettings = useFourWheeler3dStore((state) => state.updateSettings);

  const springX = useRef<SpringState>({ value: 0, velocity: 0 });
  const springY = useRef<SpringState>({ value: 0, velocity: 0 });
  const springZ = useRef<SpringState>({ value: 0, velocity: 0 });
  const seeded = useRef(false);
  const cameraPressed = useRef(false);
  const shakeSince = useRef(Number.POSITIVE_INFINITY);
  const shakeFrom = useRef(0);
  const seenLanding = useRef(0);
  const ray = useRef<InstanceType<typeof rapier.Ray> | null>(null);

  // One ray, reused every frame.
  useEffect(() => {
    if (!rapier?.Ray) return;
    ray.current = new rapier.Ray(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }
    );
  }, [rapier]);

  useFrame((_, delta) => {
    const controls = getControls();

    // C swaps between riding behind and riding in the helmet.
    if (controls.camera && !cameraPressed.current) {
      updateSettings({ helmetCam: !helmetCam });
    }
    cameraPressed.current = controls.camera;

    const position = playerPos.current;
    const rotation = playerQuat.current;

    if (helmetCam) {
      helmetSpot.copy(HELMET_OFFSET).applyQuaternion(rotation).add(position);
      camera.position.copy(helmetSpot);
      camera.quaternion.copy(rotation);
      // The model faces +Z and a camera looks down -Z, so turn it around.
      camera.rotateY(Math.PI);
      seeded.current = false;
      applyFov(camera, playerSpeedRef.current, tuning.maxSpeed);
      return;
    }

    chaseTarget(position, rotation, CHASE_DEFAULTS, desired);

    // Stop the camera in front of a hill instead of letting it sink into one.
    seat.set(position.x, position.y + LOOK_UP, position.z);
    toCamera.set(desired.x - seat.x, desired.y - seat.y, desired.z - seat.z);
    const reach = toCamera.length();
    if (ray.current && reach > 0.001) {
      toCamera.multiplyScalar(1 / reach);
      ray.current.origin.x = seat.x;
      ray.current.origin.y = seat.y;
      ray.current.origin.z = seat.z;
      ray.current.dir.x = toCamera.x;
      ray.current.dir.y = toCamera.y;
      ray.current.dir.z = toCamera.z;
      // Only the ground and the buildings block the view, never the vehicle.
      const hit = world.castRay(
        ray.current,
        reach,
        true,
        rapier?.QueryFilterFlags?.EXCLUDE_DYNAMIC
      );
      if (hit) {
        const stop = Math.max(0.5, hit.timeOfImpact - CLEARANCE);
        desired.x = seat.x + toCamera.x * stop;
        desired.y = seat.y + toCamera.y * stop;
        desired.z = seat.z + toCamera.z * stop;
      }
    }

    // The first frame after a switch starts where the camera already is.
    if (!seeded.current) {
      springX.current.value = desired.x;
      springY.current.value = desired.y;
      springZ.current.value = desired.z;
      springX.current.velocity = 0;
      springY.current.velocity = 0;
      springZ.current.velocity = 0;
      seeded.current = true;
    }

    const nextX = springStep(springX.current, desired.x, delta, SPRING);
    const nextY = springStep(springY.current, desired.y, delta, SPRING);
    const nextZ = springStep(springZ.current, desired.z, delta, SPRING);

    // A landing knocks the camera about for a moment. The vehicle reports it,
    // the camera keeps the timing, so nothing writes to the other's state.
    const report = landing.current;
    if (report.id !== seenLanding.current) {
      seenLanding.current = report.id;
      if (report.airtime >= SHAKE_MIN_AIRTIME) {
        shakeSince.current = 0;
        shakeFrom.current = Math.min(SHAKE_MAX, report.airtime * 0.25);
      }
    }
    if (shakeSince.current <= 1) {
      shakeSince.current += delta;
      shakeOffset(shakeSince.current, shakeFrom.current, shake);
    } else {
      shake.x = 0;
      shake.y = 0;
    }

    camera.position.set(nextX + shake.x, nextY + shake.y, nextZ);

    lookTarget.set(position.x, position.y + LOOK_UP, position.z);
    camera.lookAt(lookTarget);
    applyFov(camera, playerSpeedRef.current, tuning.maxSpeed);
  });

  return null;
}

/** Widen the view with speed. The matrix is only rebuilt when it moves. */
function applyFov(
  camera: THREE.Camera,
  speed: number,
  maxSpeed: number
): void {
  const perspective = camera as THREE.PerspectiveCamera;
  if (!perspective.isPerspectiveCamera) return;
  const next = fovForSpeed(speed, maxSpeed);
  if (Math.abs(perspective.fov - next) < 0.05) return;
  perspective.fov = next;
  perspective.updateProjectionMatrix();
}

export default ChaseCamera;
