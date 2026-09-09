/**
 * The chase camera math, with no Three.js and no React in it.
 *
 * The camera sits behind and above the seat, catches up with a spring, widens
 * its view as you speed up, and shakes when you land a jump. All of that is
 * plain numbers here so the tests can prove it settles instead of wobbling.
 */

export type Vec3 = { x: number; y: number; z: number };

export type ChaseOptions = {
  /** Meters behind the seat. */
  back: number;
  /** Meters above the seat. */
  up: number;
};

export const CHASE_DEFAULTS: ChaseOptions = { back: 5, up: 2.2 };

/**
 * Where the camera wants to be.
 *
 * The vehicle drives along its local +Z, so "behind" is local -Z turned by the
 * vehicle rotation. The quaternion is applied by hand to keep this file free of
 * Three.js, and the result is written into `out` so nothing is allocated in a
 * frame loop.
 */
export function chaseTarget(
  position: Vec3,
  quaternion: { x: number; y: number; z: number; w: number },
  options: ChaseOptions,
  out: Vec3,
): Vec3 {
  // The local offset: back along -Z, up along +Y.
  const lx = 0;
  const ly = 0;
  const lz = -options.back;

  // Rotate (lx, ly, lz) by the quaternion: v + 2 * q.xyz cross (q.xyz cross v + q.w * v)
  const { x: qx, y: qy, z: qz, w: qw } = quaternion;
  const tx = 2 * (qy * lz - qz * ly);
  const ty = 2 * (qz * lx - qx * lz);
  const tz = 2 * (qx * ly - qy * lx);
  const rx = lx + qw * tx + (qy * tz - qz * ty);
  const ry = ly + qw * ty + (qz * tx - qx * tz);
  const rz = lz + qw * tz + (qx * ty - qy * tx);

  out.x = position.x + rx;
  out.y = position.y + options.up + ry;
  out.z = position.z + rz;
  return out;
}

export type SpringTuning = {
  stiffness: number;
  /** Leave this out for a spring that settles without any bounce. */
  damping?: number;
};

/** A spring that settles with no bounce at all. */
export function criticalDamping(stiffness: number): number {
  return 2 * Math.sqrt(stiffness);
}

/** One axis of the spring: where it is now and how fast it is moving. */
export type SpringState = { value: number; velocity: number };

/**
 * The longest slice of time the spring integrates at once.
 *
 * A long frame integrated in one go can throw the spring past its target. The
 * step is cut into slices no longer than this, so a slow frame settles the
 * same way a fast one does.
 */
const MAX_SUB_STEP = 1 / 120;

/**
 * Move a spring one frame closer to its target.
 *
 * The state is written in place and the new value comes back, because this
 * runs three times per frame and a returned object would be three allocations
 * every frame.
 */
export function springStep(
  state: SpringState,
  target: number,
  dt: number,
  tuning: SpringTuning,
): number {
  const stiffness = tuning.stiffness;
  const damping = tuning.damping ?? criticalDamping(stiffness);
  let remaining = Math.max(0, Math.min(dt, 0.25));

  while (remaining > 0) {
    const step = Math.min(MAX_SUB_STEP, remaining);
    const acceleration =
      stiffness * (target - state.value) - damping * state.velocity;
    state.velocity += acceleration * step;
    state.value += state.velocity * step;
    remaining -= step;
  }

  return state.value;
}

/** The narrowest and widest the view ever gets. */
export const FOV_MIN = 60;
export const FOV_MAX = 75;

/** The view widens with speed, which is what makes fast feel fast. */
export function fovForSpeed(speed: number, maxSpeed: number): number {
  if (maxSpeed <= 0) return FOV_MIN;
  const t = Math.max(0, Math.min(1, Math.abs(speed) / maxSpeed));
  return FOV_MIN + (FOV_MAX - FOV_MIN) * t;
}

/**
 * How much of a landing shake is left.
 *
 * The shake fades fast: a knock this size is gone in about half a second, so
 * it reads as a thump and never as a broken camera.
 */
const SHAKE_FADE_SECONDS = 0.12;

export function shakeEnvelope(time: number, magnitude: number): number {
  if (time < 0) return 0;
  return magnitude * Math.exp(-time / SHAKE_FADE_SECONDS);
}

/**
 * The camera wobble a landing adds, in meters.
 *
 * Two different speeds on the two axes keep it from looking like a bounce.
 * The result is written into `out`, so a frame loop allocates nothing.
 */
export function shakeOffset(time: number, magnitude: number, out: Vec3): Vec3 {
  const envelope = shakeEnvelope(time, magnitude);
  out.x = envelope * Math.sin(time * 62);
  out.y = envelope * Math.sin(time * 47 + 1.3);
  out.z = 0;
  return out;
}
