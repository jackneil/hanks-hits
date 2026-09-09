import type { Vec3 } from "./camera";
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
/** Interpolate a one-second authoritative countdown tick, never predict completion. */
export function visualRemaining(authoritative: number, sinceTick: number) {
  return Math.max(0.001, authoritative - clamp(sinceTick, 0, 0.999));
}
/** Same saved 38-second order drives the flight; this function cannot grant an item. */
export function deliveryFlightPosition(
  origin: Vec3,
  target: Vec3,
  remaining: number,
  out: Vec3,
) {
  const t = clamp(1 - remaining / 38, 0, 1);
  out.x = origin.x + (target.x - origin.x) * t;
  out.z = origin.z + (target.z - origin.z) * t;
  out.y =
    origin.y + (target.y + 12 - origin.y) * t + Math.sin(t * Math.PI) * 24;
  return out;
}
/** Original helper follows 80 source units behind and closes 18% per 60Hz tick. */
export function helperFollow(position: Vec3, target: Vec3, dt: number) {
  const dx = target.x - position.x,
    dz = target.z - position.z,
    d = Math.hypot(dx, dz);
  if (d < 5 / 18) return 0;
  const step = Math.min(
    d,
    Math.max(
      10 * clamp(dt, 0, 0.1),
      d * (1 - Math.exp(Math.log(0.82) * 60 * clamp(dt, 0, 0.1))),
    ),
  );
  position.x += (dx / d) * step;
  position.z += (dz / d) * step;
  return step;
}
/** Leave and return during the existing four-second errand, ending at the exact follow anchor. */
export function helperErrandTarget(
  anchor: Vec3,
  heading: number,
  remaining: number,
  out: Vec3,
) {
  const t = clamp(1 - remaining / 4, 0, 1),
    excursion = Math.sin(t * Math.PI) * 10;
  out.x = anchor.x + Math.cos(heading) * excursion;
  out.y = anchor.y;
  out.z = anchor.z - Math.sin(heading) * excursion;
  return out;
}
