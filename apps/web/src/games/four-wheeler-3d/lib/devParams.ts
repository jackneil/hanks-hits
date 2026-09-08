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

/**
 * The browser test handle.
 *
 * Outside a production build the game hangs a small object on the window so a
 * browser walk can read the ride out loud instead of guessing from a
 * screenshot:
 *
 *   __fw3d.pos()        where the rider is, as [x, y, z]
 *   __fw3d.speed()      forward speed in meters per second
 *   __fw3d.mph()        the same speed in miles per hour
 *   __fw3d.airtime()    how long the last jump lasted, in seconds
 *   __fw3d.upDot()      1 upright, -1 upside down
 *   __fw3d.wheels()     how many of the four wheels touch the ground
 *   __fw3d.engine()     the engine force being sent to each wheel
 *   __fw3d.helmetCam()  true when the camera is in the helmet
 *   __fw3d.flip()       roll the vehicle over, to test the flip recovery
 *   __fw3d.teleport(x, z)  drop the rider somewhere else on the map
 *
 * It is a read-and-poke handle for testing only. Nothing in the game reads it,
 * and in a production build it is never attached.
 */
export type DevHandle = {
  pos: () => [number, number, number];
  speed: () => number;
  mph: () => number;
  airtime: () => number;
  upDot: () => number;
  wheels: () => number;
  engine: () => number;
  helmetCam: () => boolean;
  flip: () => void;
  teleport: (x: number, z: number) => void;
};

/** True when the development handle is allowed to exist. */
export function devHandleEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

type HandleWindow = Window & { __fw3d?: DevHandle };

/** Hang the handle on the window. Returns a function that takes it away. */
export function attachDevHandle(handle: DevHandle): () => void {
  if (!devHandleEnabled()) return () => {};
  (window as HandleWindow).__fw3d = handle;
  return () => {
    delete (window as HandleWindow).__fw3d;
  };
}
