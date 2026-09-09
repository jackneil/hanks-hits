import type { AdventurePosition } from "./adventureTypes";
import { trainLoopPoints, trainSpurPoints } from "./landmarks";

export type RailPath = "loop" | "spur" | "sky";
export type RailStop = "south" | "east" | "north" | "west" | "fence";
export type RailSession = {
  path: RailPath;
  distance: number;
  speed: number;
  direction: 1 | -1;
  target: RailStop | null;
  returning: boolean;
  position: AdventurePosition;
  heading: number;
};
export type RailPoint = AdventurePosition;
export type RailTrack = {
  points: RailPoint[];
  cumulative: number[];
  length: number;
  closed: boolean;
};
export const RAIL_STOPS: readonly RailStop[] = [
  "south",
  "east",
  "north",
  "west",
  "fence",
];
export const RAIL_MAX_SPEED = 180;
export const RAIL_BOARD_RANGE = 260 / 18;
const wrap = (v: number, n: number) => ((v % n) + n) % n;

function track(points: RailPoint[], closed: boolean): RailTrack {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++)
    cumulative.push(
      cumulative[i - 1] +
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].z - points[i - 1].z,
        ),
    );
  const last = points[points.length - 1],
    first = points[0];
  return {
    points,
    cumulative,
    closed,
    length:
      cumulative[cumulative.length - 1] +
      (closed ? Math.hypot(last.x - first.x, last.z - first.z) : 0),
  };
}

/** Original 1,200 point edge loop, 320 segment home spur and 1,500 point sky track. */
export function buildRailTracks(): Record<RailPath, RailTrack> {
  const loop = track(
    trainLoopPoints().map((p) => ({ ...p, y: 0 })),
    true,
  );
  const spur = track(
    trainSpurPoints().map((p) => ({
      ...p,
      y: Math.max(
        0,
        (40 / 18) * (1 - Math.abs(p.x - (-2000 + 380 / 18)) / (140 / 18)),
      ),
    })),
    false,
  );
  const radius = 2200 / 18,
    centers = [-1, 0, 1].map((side, i) => ({
      x: side * radius * 1.5,
      z: -800 + (i === 1 ? radius * 0.65 : 0),
    }));
  const raw = centers.flatMap((c) =>
    Array.from({ length: 30 }, (_, i) => ({
      x: c.x + Math.cos((i / 30) * Math.PI * 2) * radius,
      z: c.z + Math.sin((i / 30) * Math.PI * 2) * radius,
      y: 0,
    })),
  );
  const rawTrack = track(raw, true);
  const sky = track(
    Array.from({ length: 1500 }, (_, i) => {
      const p = sampleTrack(rawTrack, (rawTrack.length * i) / 1500);
      const dip = Math.max(0, 1 - Math.min(i, 1500 - i) / 70);
      return { x: p.x, z: p.z, y: (340 * (1 - dip) + 12 * dip) / 18 };
    }),
    true,
  );
  return { loop, spur, sky };
}

export const RAIL_TRACKS = buildRailTracks();

/** Binary search keeps sampling constant enough even during fast train travel. */
export function sampleTrack(
  t: RailTrack,
  distance: number,
): AdventurePosition & { heading: number } {
  const d = t.closed
    ? wrap(distance, t.length)
    : Math.max(0, Math.min(t.length, distance));
  let lo = 0,
    hi = t.points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (t.cumulative[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = t.points[Math.min(lo, t.closed ? lo : t.points.length - 2)],
    next = t.closed
      ? (lo + 1) % t.points.length
      : Math.min(lo + 1, t.points.length - 1),
    b = t.points[next];
  const start = t.cumulative[t.closed ? lo : Math.min(lo, t.points.length - 2)];
  const end = next === 0 ? t.length : t.cumulative[next];
  const f = end === start ? 0 : (d - start) / (end - start);
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

export function gapHeight(distance: number): number {
  const index =
    (wrap(distance, RAIL_TRACKS.loop.length) / RAIL_TRACKS.loop.length) * 1200;
  for (const fraction of [0.12, 0.37, 0.63, 0.88]) {
    const d = index - Math.floor(1200 * fraction);
    if (Math.abs(d) < 13)
      return (Math.sin(((d + 13) / 26) * Math.PI) * 80) / 18;
  }
  return 0;
}

export function railPose(
  state: Pick<RailSession, "path" | "distance" | "direction">,
): AdventurePosition & { heading: number } {
  const p = sampleTrack(RAIL_TRACKS[state.path], state.distance);
  return {
    ...p,
    y: p.y + (state.path === "loop" ? gapHeight(state.distance) : 0),
    heading: p.heading + (state.direction === -1 ? Math.PI : 0),
  };
}

export function createRailSession(): RailSession {
  // Leave room for both carriages between the cab and the end-of-line buffer.
  const state: RailSession = {
    path: "spur",
    distance: RAIL_TRACKS.spur.length - 17.2,
    direction: -1,
    speed: 0,
    target: null,
    returning: false,
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
  };
  const p = railPose(state);
  return { ...state, position: p, heading: p.heading };
}

export function nearestRailDistance(
  position: AdventurePosition,
  path: RailPath = "loop",
): number {
  const t = RAIL_TRACKS[path];
  let best = Infinity,
    distance = 0;
  t.points.forEach((p, i) => {
    const d = Math.hypot(p.x - position.x, p.z - position.z);
    if (d < best) {
      best = d;
      distance = t.cumulative[i];
    }
  });
  return distance;
}

export function routeTrain(
  state: RailSession,
  target: RailStop,
  returning = false,
): RailSession {
  const next = { ...state, target, returning };
  if (next.path === "sky") {
    next.path = "loop";
    next.distance = nearestRailDistance(next.position);
  }
  if (next.path === "spur") next.direction = target === "fence" ? 1 : -1;
  else {
    const goal =
      RAIL_TRACKS.loop.length *
      (target === "fence" ? 0.75 : RAIL_STOPS.indexOf(target) * 0.25);
    next.direction =
      wrap(goal - next.distance, RAIL_TRACKS.loop.length) <=
      RAIL_TRACKS.loop.length / 2
        ? 1
        : -1;
  }
  return next;
}

export function toggleSkyTrack(state: RailSession): RailSession {
  const path: RailPath = state.path === "sky" ? "loop" : "sky",
    distance = path === "sky" ? 0 : nearestRailDistance(state.position);
  const next = {
    ...state,
    path,
    distance,
    direction: 1 as const,
    target: null,
    returning: false,
  };
  const p = railPose(next);
  return { ...next, position: p, heading: p.heading };
}

/** Boarding at the home buffer faces the cab back toward the countryside. */
export function boardTrain(state: RailSession): RailSession {
  const direction =
    state.path === "spur" && state.distance >= RAIL_TRACKS.spur.length - 0.1
      ? -1
      : state.direction;
  const next = {
    ...state,
    direction: direction as 1 | -1,
    speed: 0,
    target: null,
    returning: false,
  };
  const pose = railPose(next);
  return { ...next, position: pose, heading: pose.heading };
}

/** Integrate travel and station transitions; clamp arrivals so fast frames cannot skip a stop. */
export function stepTrain(
  state: RailSession,
  throttle: number,
  brake: number,
  dt: number,
  boost = false,
): RailSession {
  const next = { ...state };
  const delta = Math.max(0, Math.min(0.1, dt));
  const limit = RAIL_MAX_SPEED * (boost ? 2 : 1);
  next.speed = Math.max(
    0,
    Math.min(
      limit,
      next.speed +
        ((next.target ? 1 : Math.max(-1, Math.min(1, throttle))) * 24 -
          Math.max(0, brake) * 70) *
          delta,
    ),
  );
  if (!next.target && throttle === 0 && brake === 0)
    next.speed *= Math.exp(-0.3 * delta);
  const t = RAIL_TRACKS[next.path];
  let goal: number | null = null;
  if (next.target)
    goal =
      next.path === "spur"
        ? next.target === "fence"
          ? t.length
          : 0
        : t.length *
          (next.target === "fence"
            ? 0.75
            : RAIL_STOPS.indexOf(next.target) * 0.25);
  const remaining =
    goal === null
      ? Infinity
      : next.path === "spur"
        ? Math.abs(goal - next.distance)
        : wrap((goal - next.distance) * next.direction, t.length);
  if (goal !== null)
    next.speed = Math.min(next.speed, Math.sqrt(2 * 45 * remaining) + 0.5);
  const travel = next.speed * delta;
  next.distance += next.direction * Math.min(travel, remaining);
  const reached = goal !== null && remaining <= travel + 0.00001;
  if (reached) {
    next.distance = goal!;
    if (next.path === "spur" && next.target !== "fence") {
      next.path = "loop";
      next.distance = RAIL_TRACKS.loop.length * 0.75;
      const route = routeTrain(next, next.target!, next.returning);
      next.direction = route.direction;
    } else if (next.path === "loop" && next.target === "fence") {
      next.path = "spur";
      next.distance = 0;
      next.direction = 1;
    } else {
      next.speed = 0;
      next.target = null;
      next.returning = false;
    }
  }
  if (next.path === "spur") {
    if (next.distance <= 0 && !next.target) {
      next.path = "loop";
      next.distance = RAIL_TRACKS.loop.length * 0.75;
      next.direction = 1;
    } else if (next.distance >= RAIL_TRACKS.spur.length) {
      next.distance = RAIL_TRACKS.spur.length;
      if (next.direction === 1) next.speed = 0;
    }
  } else next.distance = wrap(next.distance, RAIL_TRACKS[next.path].length);
  const pose = railPose(next);
  return { ...next, position: pose, heading: pose.heading };
}
