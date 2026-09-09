import type { Vec3 } from "./camera";
/** Original names, zoom and tilt are retained. Pitch is their perspective-camera equivalent. */
export const CAMERA_PRESETS = [
  { name: "Top-Down", zoom: 1, tilt: 1, pitch: 1.48 },
  { name: "Close", zoom: 1.5, tilt: 1, pitch: 1.35 },
  { name: "Far", zoom: 0.7, tilt: 1, pitch: 1.43 },
  { name: "Bird's Eye", zoom: 0.5, tilt: 1, pitch: 1.48 },
  { name: "Oblique", zoom: 1.1, tilt: 0.7, pitch: 0.4 },
  { name: "Low Angle", zoom: 1.4, tilt: 0.55, pitch: 0.22 },
  { name: "Cinematic", zoom: 0.9, tilt: 0.8, pitch: 0.52 },
  { name: "Action", zoom: 1.7, tilt: 0.5, pitch: 0.16 },
  { name: "Wide", zoom: 0.6, tilt: 0.85, pitch: 0.64 },
  { name: "Super Zoom", zoom: 2, tilt: 0.9, pitch: 0.83 },
] as const;
export const DEFAULT_CAMERA_PRESET = 4;
export type OrbitState = {
  yaw: number;
  pitch: number;
  zoom: number;
  velocityYaw: number;
  velocityPitch: number;
  dragging: boolean;
};
export function createOrbit(): OrbitState {
  return {
    yaw: 0,
    pitch: 0,
    zoom: 1,
    velocityYaw: 0,
    velocityPitch: 0,
    dragging: false,
  };
}
export function cameraPreset(index: number) {
  return CAMERA_PRESETS[
    Number.isFinite(index)
      ? ((Math.trunc(index) % 10) + 10) % 10
      : DEFAULT_CAMERA_PRESET
  ];
}
export function cycleCameraPreset(index: number) {
  return Number.isFinite(index)
    ? ((((Math.trunc(index) % 10) + 10) % 10) + 1) % 10
    : DEFAULT_CAMERA_PRESET;
}
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
/** Dragging right carries the camera toward the rider's right, without changing steering. */
export function dragOrbit(
  state: OrbitState,
  dx: number,
  dy: number,
  width: number,
  height: number,
  elapsedSeconds: number,
  preset: number,
) {
  const yaw = (-dx / Math.max(240, width)) * Math.PI * 2,
    pitch = (-dy / Math.max(200, height)) * Math.PI;
  state.yaw = Math.atan2(Math.sin(state.yaw + yaw), Math.cos(state.yaw + yaw));
  const base = cameraPreset(preset).pitch,
    old = state.pitch;
  state.pitch = clamp(state.pitch + pitch, 0.1 - base, 1.49 - base);
  const dt = clamp(elapsedSeconds, 0.008, 0.1);
  state.velocityYaw = clamp(yaw / dt, -3, 3);
  state.velocityPitch = clamp((state.pitch - old) / dt, -2, 2);
}
export function zoomOrbit(state: OrbitState, delta: number) {
  state.zoom = clamp(
    state.zoom * Math.exp(clamp(delta, -500, 500) * 0.0015),
    0.55,
    3,
  );
}
/** Exact exponential momentum is stable across 30/60/120Hz and stops immediately when re-grabbed. */
export function advanceOrbit(
  state: OrbitState,
  dt: number,
  reducedMotion: boolean,
  preset: number,
) {
  if (state.dragging) return;
  if (reducedMotion) {
    state.velocityYaw = state.velocityPitch = 0;
    return;
  }
  const decay = Math.exp(-9 * clamp(dt, 0, 0.1)),
    integral = (1 - decay) / 9;
  state.yaw += state.velocityYaw * integral;
  const base = cameraPreset(preset).pitch;
  state.pitch = clamp(
    state.pitch + state.velocityPitch * integral,
    0.1 - base,
    1.49 - base,
  );
  state.velocityYaw *= decay;
  state.velocityPitch *= decay;
  if (Math.abs(state.velocityYaw) < 0.001) state.velocityYaw = 0;
  if (Math.abs(state.velocityPitch) < 0.001) state.velocityPitch = 0;
}
/** Only vehicle yaw enters a chase pose: suspension pitch and body roll cannot roll the horizon. */
export function presetCameraTarget(
  position: Vec3,
  heading: number,
  length: number,
  preset: number,
  orbit: OrbitState,
  out: Vec3,
  lookUp = 1,
) {
  const p = cameraPreset(preset),
    base = p.tilt === 1 ? 14 : 7.5,
    distance =
      (Math.max(base, Math.max(1, length) * 1.5) / p.zoom) * orbit.zoom;
  const pitch = clamp(p.pitch + orbit.pitch, 0.1, 1.49),
    yaw = heading + orbit.yaw,
    flat = Math.cos(pitch) * distance;
  out.x = position.x - Math.sin(yaw) * flat;
  out.y = position.y + lookUp + Math.sin(pitch) * distance;
  out.z = position.z - Math.cos(yaw) * flat;
  return out;
}
