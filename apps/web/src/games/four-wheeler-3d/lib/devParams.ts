/**
 * Small development helpers read once from the address bar.
 *
 * They only work outside a production build, so nothing a player can type
 * changes the real game. They exist so a screenshot can be taken at any hour
 * and at any spot without driving there first.
 *
 *   ?tod=14      start the clock at 2 in the afternoon
 *   ?pos=100,-50 drop the rider at x 100, z -50
 */

export type DevParams = {
  timeOfDay: number | null;
  position: { x: number; z: number } | null;
};

const NONE: DevParams = { timeOfDay: null, position: null };

/** Read the development parameters. Returns nothing at all in production. */
export function readDevParams(search?: string): DevParams {
  if (process.env.NODE_ENV === "production") return NONE;

  const query =
    search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!query) return NONE;

  const params = new URLSearchParams(query);

  let timeOfDay: number | null = null;
  const rawTime = params.get("tod");
  if (rawTime !== null) {
    const parsed = Number.parseFloat(rawTime);
    if (Number.isFinite(parsed)) timeOfDay = ((parsed % 24) + 24) % 24;
  }

  let position: { x: number; z: number } | null = null;
  const rawPos = params.get("pos");
  if (rawPos) {
    const [rawX, rawZ] = rawPos.split(",");
    const x = Number.parseFloat(rawX);
    const z = Number.parseFloat(rawZ);
    if (Number.isFinite(x) && Number.isFinite(z)) position = { x, z };
  }

  return { timeOfDay, position };
}
