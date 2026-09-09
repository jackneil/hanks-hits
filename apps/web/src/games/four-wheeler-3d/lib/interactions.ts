import type { Interaction } from "./adventureSession";
/** A parked ride must not hide a nearer shop, property entrance or launch pad. */
export function nearestInteraction(
  candidates: Array<Interaction | null>,
): Interaction | null {
  return (
    candidates
      .filter(
        (item): item is Interaction =>
          item !== null && Number.isFinite(item.distance),
      )
      .sort(
        (a, b) => Number(b.ready) - Number(a.ready) || a.distance - b.distance,
      )[0] ?? null
  );
}
