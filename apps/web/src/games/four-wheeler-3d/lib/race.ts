import { inMud } from "./activities";
import { RACE_LOOP, raceLoopPoints, type Vec2 } from "./landmarks";

export type RaceSession = {
  phase: "idle" | "countdown" | "racing" | "finished";
  vehicleType: string;
  countdown: number;
  elapsed: number;
  checkpoint: number;
  totalCheckpoints: number;
  lap: number;
  laps: number;
  strikes: number;
  offTrack: boolean;
  speedFactor: number;
  winner: "player" | "rival" | null;
  rivalProgress: number;
  nosBoxes: boolean[];
  message: string;
};
export const RACE_PRIZE = 10000;
export const RACE_CHECKPOINTS = raceLoopPoints(64);
export const RACE_PATH = raceLoopPoints(512);
const SEGMENT_LENGTHS = RACE_PATH.map((p, i) =>
  Math.hypot(
    RACE_PATH[(i + 1) % RACE_PATH.length].x - p.x,
    RACE_PATH[(i + 1) % RACE_PATH.length].z - p.z,
  ),
);
export const RACE_LENGTH = SEGMENT_LENGTHS.reduce((sum, n) => sum + n, 0);
export const ITEM_CHECKPOINTS = [0.2, 0.4, 0.6, 0.8].map((f) =>
  Math.round(f * RACE_CHECKPOINTS.length),
);
export type RaceRun = {
  session: RaceSession;
  lastPosition: Vec2;
  offTrackSeconds: number;
  playerSlow: number;
  rivalSlow: number;
  rivalSpeed: number;
  maxSpeed: number;
  awarded: boolean;
  needsReturn: boolean;
  rival: { x: number; z: number; heading: number };
  rivalTarget: { x: number; z: number; heading: number };
  rivalPreview: { x: number; z: number; heading: number };
};
export type RaceEvents = { boost: boolean; finished: boolean };
export function createRace(vehicleType: string, maxSpeed: number): RaceRun {
  return {
    session: {
      phase: "countdown",
      vehicleType,
      countdown: 3.2,
      elapsed: 0,
      checkpoint: 0,
      totalCheckpoints: RACE_CHECKPOINTS.length,
      lap: 1,
      laps: 1,
      strikes: 0,
      offTrack: false,
      speedFactor: 1,
      winner: null,
      rivalProgress: 0,
      nosBoxes: [false, false, false, false],
      message: "Ready on the grid.",
    },
    lastPosition: { x: -4, z: RACE_LOOP.half - 2 },
    offTrackSeconds: 0,
    playerSlow: 0,
    rivalSlow: 0,
    rivalSpeed: 0,
    maxSpeed,
    awarded: false,
    needsReturn: false,
    rival: { x: 4, z: RACE_LOOP.half - 2, heading: Math.PI / 2 },
    rivalTarget: { x: 0, z: 0, heading: 0 },
    rivalPreview: { x: 0, z: 0, heading: 0 },
  };
}
function segmentDistanceSquared(
  x: number,
  z: number,
  a: Vec2,
  b: Vec2,
): number {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const t = Math.max(
    0,
    Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)),
  );
  return (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
}
export function trackDistance(x: number, z: number): number {
  let closest = Infinity;
  for (let i = 0; i < RACE_PATH.length; i++)
    closest = Math.min(
      closest,
      segmentDistanceSquared(
        x,
        z,
        RACE_PATH[i],
        RACE_PATH[(i + 1) % RACE_PATH.length],
      ),
    );
  return Math.sqrt(closest);
}
export function racePoint(
  distance: number,
  out: { x: number; z: number; heading: number },
): void {
  let left = ((distance % RACE_LENGTH) + RACE_LENGTH) % RACE_LENGTH;
  for (let i = 0; i < RACE_PATH.length; i++) {
    if (left <= SEGMENT_LENGTHS[i]) {
      const a = RACE_PATH[i],
        b = RACE_PATH[(i + 1) % RACE_PATH.length],
        t = left / SEGMENT_LENGTHS[i];
      out.x = a.x + (b.x - a.x) * t;
      out.z = a.z + (b.z - a.z) * t;
      out.heading = Math.atan2(b.x - a.x, b.z - a.z);
      return;
    }
    left -= SEGMENT_LENGTHS[i];
  }
}

/** Ordered gates plus a plausible travel check stop finish-line and teleport shortcuts. */
export function advanceRace(
  run: RaceRun,
  position: Vec2,
  dt: number,
  events: RaceEvents,
): void {
  const s = run.session;
  events.boost = false;
  events.finished = false;
  if (s.phase === "countdown") {
    s.countdown = Math.max(0, s.countdown - dt);
    run.lastPosition.x = position.x;
    run.lastPosition.z = position.z;
    if (s.countdown === 0) {
      s.phase = "racing";
      s.message = "GO!";
    }
    return;
  }
  if (s.phase !== "racing") return;
  s.elapsed += dt;
  run.playerSlow = Math.max(0, run.playerSlow - dt);
  run.rivalSlow = Math.max(0, run.rivalSlow - dt);
  s.offTrack = trackDistance(position.x, position.z) > RACE_LOOP.width * 0.8;
  run.offTrackSeconds = s.offTrack ? run.offTrackSeconds + dt : 0;
  s.speedFactor = s.offTrack ? 0.55 : run.playerSlow > 0 ? 0.45 : 1;
  if (run.offTrackSeconds >= 2.5) {
    s.strikes += 1;
    run.offTrackSeconds = 0;
    s.message = `Off track: ${s.strikes} ${s.strikes === 1 ? "strike" : "strikes"}. Find the dirt road.`;
  }
  const traveled = Math.hypot(
    position.x - run.lastPosition.x,
    position.z - run.lastPosition.z,
  );
  const plausible = traveled <= Math.max(12, run.maxSpeed * 2.5 * dt + 2);
  if (!plausible) {
    run.needsReturn = true;
    s.message = "Return to your checkpoint to continue the race.";
  }
  const lastGate = RACE_CHECKPOINTS[s.checkpoint % RACE_CHECKPOINTS.length];
  if (
    plausible &&
    Math.hypot(position.x - lastGate.x, position.z - lastGate.z) < 12
  )
    run.needsReturn = false;
  const expected =
    RACE_CHECKPOINTS[(s.checkpoint + 1) % RACE_CHECKPOINTS.length];
  if (
    plausible &&
    !run.needsReturn &&
    !s.offTrack &&
    segmentDistanceSquared(expected.x, expected.z, run.lastPosition, position) <
      12 ** 2
  ) {
    s.checkpoint += 1;
    s.message = `Checkpoint ${s.checkpoint} of ${s.totalCheckpoints}.`;
  }
  run.lastPosition.x = position.x;
  run.lastPosition.z = position.z;
  stepRival(run, dt);
  for (let i = 0; i < ITEM_CHECKPOINTS.length; i++) {
    if (s.nosBoxes[i]) continue;
    const youReached = s.checkpoint >= ITEM_CHECKPOINTS[i];
    const rivalReached =
      s.rivalProgress >=
      (RACE_LENGTH * ITEM_CHECKPOINTS[i]) / RACE_CHECKPOINTS.length;
    if (youReached || rivalReached) {
      s.nosBoxes[i] = true;
      if (youReached) {
        events.boost = true;
        run.rivalSlow = 1.8;
        s.message = "NOS box! Boost on, rival slowed.";
      } else {
        run.playerSlow = 1.8;
        s.message = "Rival got the box. Recovering speed...";
      }
    }
  }
  if (
    s.checkpoint >= s.totalCheckpoints * s.laps ||
    s.rivalProgress >= RACE_LENGTH * s.laps
  ) {
    s.phase = "finished";
    s.speedFactor = 1;
    s.winner = s.checkpoint >= s.totalCheckpoints * s.laps ? "player" : "rival";
    s.message =
      s.winner === "player"
        ? "You win! $10,000 earned."
        : "Your rival won. Try again!";
    events.finished = true;
  }
}

/** Steer a real pose toward six close samples; curvature and mud affect travel. */
export function stepRival(run: RaceRun, dt: number, mudAt = inMud): void {
  const s = run.session,
    pose = run.rival;
  const lookAhead = 6 * Math.max(1, Math.min(2, run.rivalSpeed / 12));
  racePoint(s.rivalProgress + lookAhead, run.rivalTarget);
  racePoint(
    s.rivalProgress + Math.max(30, run.rivalSpeed * 1.6),
    run.rivalPreview,
  );
  const target = run.rivalTarget,
    preview = run.rivalPreview;
  const angle = Math.atan2(
    Math.sin(preview.heading - target.heading),
    Math.cos(preview.heading - target.heading),
  );
  const cornerFactor = 1 - 0.42 * Math.min(1, Math.abs(angle) / (Math.PI / 2));
  const targetSpeed =
    run.maxSpeed * 0.8 * cornerFactor * (run.rivalSlow > 0 ? 0.45 : 1);
  run.rivalSpeed += (targetSpeed - run.rivalSpeed) * (1 - Math.exp(-1.8 * dt));
  if (mudAt(pose.x, pose.z)) run.rivalSpeed *= Math.pow(0.97, dt * 60);
  const x = target.x + Math.cos(target.heading) * 1.8,
    z = target.z - Math.sin(target.heading) * 1.8;
  const desired = Math.atan2(x - pose.x, z - pose.z);
  const turn = Math.atan2(
    Math.sin(desired - pose.heading),
    Math.cos(desired - pose.heading),
  );
  pose.heading += Math.max(-3 * dt, Math.min(3 * dt, turn));
  pose.heading = Math.atan2(Math.sin(pose.heading), Math.cos(pose.heading));
  pose.x += Math.sin(pose.heading) * run.rivalSpeed * dt;
  pose.z += Math.cos(pose.heading) * run.rivalSpeed * dt;
  // Progress follows the actual position instead of advancing an invisible timer.
  let nearest = Infinity,
    at = 0,
    cumulative = 0;
  for (let i = 0; i < RACE_PATH.length; i++) {
    const a = RACE_PATH[i],
      b = RACE_PATH[(i + 1) % RACE_PATH.length],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((pose.x - a.x) * dx + (pose.z - a.z) * dz) / (dx * dx + dz * dz || 1),
      ),
    );
    const d = (pose.x - a.x - t * dx) ** 2 + (pose.z - a.z - t * dz) ** 2;
    if (d < nearest) {
      nearest = d;
      at = cumulative + t * SEGMENT_LENGTHS[i];
    }
    cumulative += SEGMENT_LENGTHS[i];
  }
  const current = ((s.rivalProgress % RACE_LENGTH) + RACE_LENGTH) % RACE_LENGTH;
  let delta = at - current;
  if (delta < -RACE_LENGTH / 2) delta += RACE_LENGTH;
  if (delta > RACE_LENGTH / 2) delta -= RACE_LENGTH;
  if (Math.abs(delta) < Math.max(8, run.maxSpeed * dt * 2))
    s.rivalProgress = Math.max(0, s.rivalProgress + delta);
}
