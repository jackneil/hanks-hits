"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useFourWheeler3dStore } from "../lib/store";
import { useGameContext } from "../lib/gameContext";
import { useAdventureSession } from "../lib/adventureSession";
import { transportTuning } from "../lib/transport";
import {
  fovForSpeed,
  shakeOffset,
  springStep,
  type SpringState,
  type Vec3,
} from "../lib/camera";
import {
  advanceOrbit,
  cameraPreset,
  createOrbit,
  cycleCameraPreset,
  dragOrbit,
  presetCameraTarget,
  zoomOrbit,
} from "../lib/cameraPresets";
import { tuningFor, type VehicleId } from "../lib/vehicles";
import type { OneShot } from "../lib/controls";

const SPRING = { stiffness: 90 },
  CLEARANCE = 0.3;
export type LandingReport = { id: number; airtime: number };
export type ChaseCameraProps = {
  id: VehicleId;
  takeOneShot: (action: OneShot) => boolean;
  landing: React.RefObject<LandingReport>;
};

export function ChaseCamera({ id, takeOneShot, landing }: ChaseCameraProps) {
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext(),
    { world, rapier } = useRapier();
  const canvas = useThree((s) => s.gl.domElement),
    tuning = tuningFor(id);
  const x = useRef<SpringState>({ value: 0, velocity: 0 }),
    y = useRef<SpringState>({ value: 0, velocity: 0 }),
    z = useRef<SpringState>({ value: 0, velocity: 0 });
  const previousMode = useRef<string | null>(null);
  const seeded = useRef(false),
    snap = useRef(false),
    orbit = useRef(createOrbit()),
    reduced = useRef(false),
    seenPreset = useRef(-1),
    seenLanding = useRef(0),
    shakeAge = useRef(Infinity),
    shakeMagnitude = useRef(0);
  const desired = useRef<Vec3>({ x: 0, y: 0, z: 0 }),
    shake = useRef<Vec3>({ x: 0, y: 0, z: 0 }),
    seat = useRef(new THREE.Vector3()),
    direction = useRef(new THREE.Vector3()),
    eyes = useRef(new THREE.Vector3()),
    yawEuler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const ray = useRef<InstanceType<typeof rapier.Ray> | null>(null);
  useEffect(() => {
    ray.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  }, [rapier]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)"),
      update = () => {
        reduced.current = query.matches;
      };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let pointer: number | null = null,
      lastX = 0,
      lastY = 0,
      lastTime = 0,
      moved = false,
      startX = 0,
      startY = 0;
    const previousTouch = canvas.style.touchAction;
    canvas.style.setProperty("touch-action", "none");
    const enabled = () => {
      const s = useFourWheeler3dStore.getState(),
        ui = useAdventureSession.getState();
      return (
        s.hasStarted &&
        !s.isPaused &&
        !ui.panel &&
        !ui.scope &&
        !s.progress.settings.helmetCam &&
        s.mode !== "space" &&
        s.mode !== "planet"
      );
    };
    const release = () => {
      const held = pointer;
      pointer = null;
      orbit.current.dragging = false;
      if (held !== null && canvas.hasPointerCapture(held))
        canvas.releasePointerCapture(held);
    };
    const cancel = () => {
      release();
      orbit.current.velocityYaw = orbit.current.velocityPitch = 0;
    };
    const down = (e: PointerEvent) => {
      if (!enabled() || pointer !== null || ![0, 1, 2].includes(e.button))
        return;
      pointer = e.pointerId;
      lastX = startX = e.clientX;
      lastY = startY = e.clientY;
      lastTime = e.timeStamp;
      moved = false;
      orbit.current.dragging = true;
      orbit.current.velocityYaw = orbit.current.velocityPitch = 0;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!enabled()) {
        cancel();
        return;
      }
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5)
        return;
      moved = true;
      const rect = canvas.getBoundingClientRect();
      dragOrbit(
        orbit.current,
        e.clientX - lastX,
        e.clientY - lastY,
        rect.width,
        rect.height,
        (e.timeStamp - lastTime) / 1000,
        useAdventureSession.getState().cameraPreset,
      );
      lastX = e.clientX;
      lastY = e.clientY;
      lastTime = e.timeStamp;
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!moved || e.timeStamp - lastTime > 100)
        orbit.current.velocityYaw = orbit.current.velocityPitch = 0;
      release();
    };
    const wheel = (e: WheelEvent) => {
      if (!enabled() || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      zoomOrbit(
        orbit.current,
        e.deltaY *
          (e.deltaMode === 1
            ? 16
            : e.deltaMode === 2
              ? canvas.clientHeight
              : 1),
      );
    };
    const context = (e: MouseEvent) => {
      if (enabled()) e.preventDefault();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    const lost = (e: PointerEvent) => {
      if (e.pointerId === pointer) cancel();
    };
    const unsubscribe = useAdventureSession.subscribe((s, old) => {
      if (s.panel || s.scope) cancel();
      if (
        !s.action ||
        s.action.id === old.action?.id ||
        s.action.name !== "camera:reset"
      )
        return;
      cancel();
      orbit.current = createOrbit();
      snap.current = true;
    });
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("lostpointercapture", lost);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", context);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unsubscribe();
      cancel();
      canvas.style.setProperty("touch-action", previousTouch);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", lost);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", context);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [canvas]);
  useFrame(({ camera }, raw) => {
    const store = useFourWheeler3dStore.getState(),
      session = useAdventureSession.getState();
    if (store.mode === "space" || store.mode === "planet") {
      seeded.current = false;
      return;
    }
    if (takeOneShot("camera")) {
      const next = cycleCameraPreset(session.cameraPreset);
      useAdventureSession.setState({ cameraPreset: next });
      if (store.progress.settings.helmetCam)
        store.updateSettings({ helmetCam: false });
      store.setHint(
        `${cameraPreset(next).name} camera. Drag the world to look around.`,
      );
    }
    const preset = useAdventureSession.getState().cameraPreset,
      position = playerPos.current,
      rotation = playerQuat.current,
      dt = Math.min(raw, 0.1),
      indoors = store.mode === "interior";
    if (previousMode.current !== store.mode) {
      previousMode.current = store.mode;
      seeded.current = false;
      orbit.current = createOrbit();
    }
    if (session.scope) {
      camera.position.set(position.x, position.y + 1.55, position.z);
      camera.quaternion.copy(rotation);
      camera.rotateY(Math.PI);
      applyFov(camera, 25);
      seeded.current = false;
      return;
    }
    if (store.progress.settings.helmetCam) {
      eyes.current
        .set(0, store.mode === "mount" ? 2.14 : indoors ? 1.55 : 1.15, 0.1)
        .applyQuaternion(rotation)
        .add(position);
      camera.position.copy(eyes.current);
      camera.quaternion.copy(rotation);
      camera.rotateY(Math.PI);
      applyFov(
        camera,
        reduced.current
          ? 60
          : fovForSpeed(playerSpeedRef.current, tuning.maxSpeed),
      );
      seeded.current = false;
      return;
    }
    if (preset !== seenPreset.current) {
      seenPreset.current = preset;
      orbit.current = createOrbit();
      snap.current = true;
    }
    if (!store.isPaused && !session.panel)
      advanceOrbit(orbit.current, dt, reduced.current, preset);
    const craft =
      store.progress.adventure.fleet[
        store.progress.adventure.activeVehicleId ?? ""
      ];
    const length =
      craft && ["boat", "aircraft", "deck"].includes(store.mode)
        ? transportTuning(craft.type).length
        : store.mode === "train"
          ? 16
          : tuning.chassis.length;
    yawEuler.current.setFromQuaternion(rotation, "YXZ");
    presetCameraTarget(
      position,
      yawEuler.current.y,
      length,
      preset,
      orbit.current,
      desired.current,
    );
    if (indoors) {
      const radius = Math.max(3, Math.min(6, 4.8 * orbit.current.zoom)),
        pitch = Math.max(0.22, Math.min(0.85, 0.56 + orbit.current.pitch)),
        yaw = yawEuler.current.y + orbit.current.yaw;
      desired.current.x = position.x - Math.sin(yaw) * Math.cos(pitch) * radius;
      desired.current.z = position.z - Math.cos(yaw) * Math.cos(pitch) * radius;
      desired.current.y = position.y + 1.25 + Math.sin(pitch) * radius;
    }
    seat.current.set(position.x, position.y + (indoors ? 1.25 : 1), position.z);
    direction.current.set(
      desired.current.x - seat.current.x,
      desired.current.y - seat.current.y,
      desired.current.z - seat.current.z,
    );
    const reach = direction.current.length();
    if (ray.current && reach > 0.001) {
      direction.current.multiplyScalar(1 / reach);
      Object.assign(ray.current.origin, seat.current);
      Object.assign(ray.current.dir, direction.current);
      const hit = world.castRay(
        ray.current,
        reach,
        true,
        rapier.QueryFilterFlags.EXCLUDE_DYNAMIC |
          rapier.QueryFilterFlags.EXCLUDE_KINEMATIC |
          rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      if (hit) {
        const stop = Math.max(0.5, hit.timeOfImpact - CLEARANCE);
        desired.current.x = seat.current.x + direction.current.x * stop;
        desired.current.y = seat.current.y + direction.current.y * stop;
        desired.current.z = seat.current.z + direction.current.z * stop;
      }
    }
    if (
      indoors &&
      Math.hypot(
        desired.current.x - seat.current.x,
        desired.current.z - seat.current.z,
      ) < 1.8
    ) {
      camera.position.set(position.x, position.y + 1.55, position.z);
      camera.quaternion.copy(rotation);
      camera.rotateY(Math.PI);
      applyFov(camera, 68);
      seeded.current = false;
      return;
    }
    // Direct manipulation is exact while held. Preset switches do not sweep through the scenery.
    const direct = orbit.current.dragging || snap.current || !seeded.current;
    if (direct) {
      x.current = { value: desired.current.x, velocity: 0 };
      y.current = { value: desired.current.y, velocity: 0 };
      z.current = { value: desired.current.z, velocity: 0 };
      seeded.current = true;
      snap.current = false;
    }
    const nx = springStep(x.current, desired.current.x, dt, SPRING),
      ny = springStep(y.current, desired.current.y, dt, SPRING),
      nz = springStep(z.current, desired.current.z, dt, SPRING);
    const report = landing.current;
    if (report.id !== seenLanding.current) {
      seenLanding.current = report.id;
      if (!indoors && !reduced.current && report.airtime >= 0.3) {
        shakeAge.current = 0;
        shakeMagnitude.current = Math.min(0.18, report.airtime * 0.15);
      }
    }
    if (!indoors && !reduced.current && shakeAge.current < 1) {
      shakeAge.current += dt;
      shakeOffset(shakeAge.current, shakeMagnitude.current, shake.current);
    } else {
      shake.current.x = shake.current.y = 0;
    }
    camera.position.set(nx + shake.current.x, ny + shake.current.y, nz);
    // Collision also constrains the interpolated position, so a spring cannot lag inside a wall.
    if (ray.current) {
      direction.current.copy(camera.position).sub(seat.current);
      const distance = direction.current.length();
      if (distance > 0.001) {
        direction.current.multiplyScalar(1 / distance);
        Object.assign(ray.current.origin, seat.current);
        Object.assign(ray.current.dir, direction.current);
        const hit = world.castRay(
          ray.current,
          distance,
          true,
          rapier.QueryFilterFlags.EXCLUDE_DYNAMIC |
            rapier.QueryFilterFlags.EXCLUDE_KINEMATIC |
            rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        );
        if (hit) {
          camera.position
            .copy(seat.current)
            .addScaledVector(
              direction.current,
              Math.max(0.5, hit.timeOfImpact - CLEARANCE),
            );
          x.current.value = camera.position.x;
          y.current.value = camera.position.y;
          z.current.value = camera.position.z;
          x.current.velocity = y.current.velocity = z.current.velocity = 0;
        }
      }
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(seat.current);
    applyFov(
      camera,
      indoors
        ? 68
        : reduced.current
          ? 60
          : fovForSpeed(playerSpeedRef.current, tuning.maxSpeed),
    );
  });
  return null;
}
function applyFov(camera: THREE.Camera, value: number) {
  const perspective = camera as THREE.PerspectiveCamera;
  if (
    !perspective.isPerspectiveCamera ||
    Math.abs(perspective.fov - value) < 0.05
  )
    return;
  perspective.fov = value;
  perspective.updateProjectionMatrix();
}
export default ChaseCamera;
