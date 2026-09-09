import {
  createAdventureProgress,
  type AdventurePosition,
  type AdventureProgress,
} from "./adventureTypes";
import type { TravelMode } from "./adventureSession";
import {
  HALF_WORLD,
  hubBounds,
  LAKE,
  LANDMARKS,
  TREESTANDS,
} from "./landmarks";
import type { FourWheeler3dProgress } from "./store";
import { isTrailer } from "./catalog";

export const ANIMAL_TYPES = [
  "buck",
  "deer",
  "rabbit",
  "lion",
  "tiger",
  "zebra",
  "bat",
  "wolf",
] as const;
export type AnimalType = (typeof ANIMAL_TYPES)[number];
export type WildlifeAnimal = {
  id: string;
  type: AnimalType;
  position: AdventurePosition;
  heading: number;
  speed: number;
  targetSpeed: number;
  turnIn: number;
  calledFor: number;
  alive: boolean;
};
export const WILDLIFE_COUNT = 1876;
export const CORN_MAX = 18;
export const CORN_BAG = 6;
const meters = (original: number) => original / 18;
const distance = (a: AdventurePosition, b: AdventurePosition) =>
  Math.hypot(a.x - b.x, a.z - b.z);
export const canAim = (mode: TravelMode) => mode === "foot" || mode === "stand";
export const killValue = (type: string) =>
  type === "wolf" ? 10000 : type === "bat" ? 8000 : 4000;
export const isAnimalType = (type: string): type is AnimalType =>
  (ANIMAL_TYPES as readonly string[]).includes(type);

function seeded(seed: number) {
  let value = seed | 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) | 0;
    return (value >>> 0) / 4294967296;
  };
}
const insideHub = (x: number, z: number) =>
  x > hubBounds.minX &&
  x < hubBounds.maxX &&
  z > hubBounds.minZ &&
  z < hubBounds.maxZ;
function dryPosition(x: number, z: number): AdventurePosition {
  const radius = Math.hypot(x, z);
  if (radius < LAKE.r + meters(40)) {
    x = (radius ? x / radius : 1) * (LAKE.r + meters(42));
    z = (radius ? z / radius : 0) * (LAKE.r + meters(42));
  }
  if (insideHub(x, z)) x = hubBounds.minX - 2;
  return { x, y: 0, z };
}

/** Every original animal exists; rendering distance never changes the population. */
export function buildWildlife(
  seed = 1987,
  removedIds: readonly string[] = [],
): WildlifeAnimal[] {
  const random = seeded(seed),
    removed = new Set(removedIds),
    result: WildlifeAnimal[] = [];
  const add = (type: AnimalType, p?: AdventurePosition) => {
    const id = `animal-${result.length}`;
    const position =
      p ??
      dryPosition(
        (random() - 0.5) * (HALF_WORLD * 2 - 8),
        (random() - 0.5) * (HALF_WORLD * 2 - 8),
      );
    result.push({
      id,
      type,
      position,
      heading: random() * Math.PI * 2,
      speed: 0,
      targetSpeed: 0,
      turnIn: random() * 2,
      calledFor: 0,
      alive: !removed.has(id),
    });
  };
  const deer = (chance: number) =>
    random() < chance ? "buck" : random() < 0.7 ? "deer" : "rabbit";
  for (let i = 0; i < 1240; i++) add(deer(0.58));
  for (const stand of TREESTANDS)
    for (let i = 0; i < 24; i++) {
      const angle = random() * Math.PI * 2,
        radius = meters(130 + random() * 490);
      add(
        deer(0.8),
        dryPosition(
          stand.x + Math.cos(angle) * radius,
          stand.z + Math.sin(angle) * radius,
        ),
      );
    }
  for (const [type, count] of [
    ["lion", 108],
    ["tiger", 108],
    ["zebra", 120],
    ["bat", 120],
    ["wolf", 84],
  ] as const)
    for (let i = 0; i < count; i++) add(type);
  return result;
}

export type WildlifeContext = {
  player: AdventurePosition;
  mode: TravelMode;
  camo: boolean;
  feeders: AdventureProgress["feeders"];
  protected: boolean;
  mountId?: string | null;
};
/** Advances live simulation only. Calls into persistence happen only at discrete events. */
export function stepWildlife(
  animals: WildlifeAnimal[],
  context: WildlifeContext,
  seconds: number,
  random = Math.random,
): string | null {
  const dt = Math.min(0.25, Math.max(0, seconds));
  let caught: string | null = null;
  for (const animal of animals) {
    if (!animal.alive || animal.id === context.mountId) continue;
    const fast = animal.type === "rabbit" || animal.type === "bat";
    const p = animal.position,
      reach = distance(p, context.player);
    animal.turnIn -= dt;
    animal.calledFor = Math.max(0, animal.calledFor - dt);
    if (animal.turnIn <= 0) {
      animal.heading += (random() - 0.5) * 2;
      animal.targetSpeed = random() < 0.5 ? 0 : ((fast ? 2.4 : 1.3) * 60) / 18;
      animal.turnIn = 1.2 + random() * 2.3;
    }
    const chase =
      animal.type === "wolf" &&
      context.mode === "foot" &&
      !context.camo &&
      reach < meters(720);
    const flee =
      animal.type !== "wolf" &&
      context.mode !== "stand" &&
      !context.camo &&
      reach < meters(210);
    if (chase) {
      animal.heading = Math.atan2(
        context.player.x - p.x,
        context.player.z - p.z,
      );
      animal.targetSpeed = (3.5 * 60) / 18;
      if (reach < meters(30) && !context.protected) caught = animal.id;
    } else if (flee) {
      animal.heading = Math.atan2(
        p.x - context.player.x,
        p.z - context.player.z,
      );
      animal.targetSpeed = ((fast ? 3.4 : 2.3) * 60) / 18;
    } else if (animal.calledFor > 0) {
      animal.heading = Math.atan2(
        context.player.x - p.x,
        context.player.z - p.z,
      );
      animal.targetSpeed = (2.2 * 60) / 18;
    } else {
      let feeder: AdventureProgress["feeders"][number] | undefined,
        nearest = Infinity;
      for (const f of context.feeders) {
        const d = distance(p, f.position);
        if (f.corn > 0 && d < nearest) {
          nearest = d;
          feeder = f;
        }
      }
      if (feeder && nearest < meters(feeder.scented ? 6000 : 3500)) {
        animal.heading = Math.atan2(
          feeder.position.x - p.x,
          feeder.position.z - p.z,
        );
        animal.targetSpeed =
          nearest < meters(30) ? 0 : ((fast ? 2.8 : 2.2) * 60) / 18;
      }
    }
    animal.speed +=
      (animal.targetSpeed - animal.speed) * (1 - Math.exp(-3 * dt));
    let x = p.x + Math.sin(animal.heading) * animal.speed * dt;
    let z = p.z + Math.cos(animal.heading) * animal.speed * dt;
    if (animal.type !== "bat" && Math.hypot(x, z) < LAKE.r + meters(25)) {
      x = p.x;
      z = p.z;
      animal.heading += Math.PI;
    }
    if (insideHub(x, z)) {
      const edges = [
        x - hubBounds.minX,
        hubBounds.maxX - x,
        z - hubBounds.minZ,
        hubBounds.maxZ - z,
      ];
      const edge = edges.indexOf(Math.min(...edges));
      if (edge === 0) x = hubBounds.minX - 0.4;
      else if (edge === 1) x = hubBounds.maxX + 0.4;
      else if (edge === 2) z = hubBounds.minZ - 0.4;
      else z = hubBounds.maxZ + 0.4;
      animal.heading += Math.PI;
    }
    // Preserve the compound's protected opening beside the dock.
    if (
      animal.type !== "bat" &&
      x > hubBounds.maxX &&
      x < 0 &&
      Math.abs(z) < meters(140) &&
      Math.hypot(x, z) > LAKE.r + meters(20)
    ) {
      x = p.x;
      z = Math.sign(z || 1) * meters(142);
      animal.heading += Math.PI;
    }
    p.x = Math.max(-HALF_WORLD + 4, Math.min(HALF_WORLD - 4, x));
    p.z = Math.max(-HALF_WORLD + 4, Math.min(HALF_WORLD - 4, z));
  }
  return caught;
}

export function callWildlife(
  animals: WildlifeAnimal[],
  player: AdventurePosition,
): number {
  let count = 0;
  for (const a of animals)
    if (
      a.alive &&
      (a.type === "buck" || a.type === "deer") &&
      distance(a.position, player) < meters(1100)
    ) {
      a.calledFor = 6;
      count++;
    }
  return count;
}

/** Ray/sphere targeting chooses the frontmost living animal, never one behind the camera. */
export function nearestShot(
  animals: WildlifeAnimal[],
  origin: AdventurePosition,
  direction: AdventurePosition,
  ground: (x: number, z: number) => number = () => 0,
  maxDistance = 250,
): WildlifeAnimal | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length === 0) return null;
  const dx = direction.x / length,
    dy = direction.y / length,
    dz = direction.z / length;
  let best: WildlifeAnimal | null = null,
    bestDistance = maxDistance;
  for (const a of animals) {
    if (!a.alive) continue;
    const small = a.type === "rabbit" || a.type === "bat";
    const x = a.position.x - origin.x,
      z = a.position.z - origin.z;
    const y =
      ground(a.position.x, a.position.z) +
      (a.type === "bat" ? 3 : small ? 0.35 : 1) -
      origin.y;
    const along = x * dx + y * dy + z * dz;
    const radius = small ? 0.5 : 0.85;
    const offSquared = x * x + y * y + z * z - along * along;
    if (along < 0 || offSquared > radius * radius) continue;
    const hit = along - Math.sqrt(Math.max(0, radius * radius - offSquared));
    if (hit >= 0 && hit < bestDistance) {
      best = a;
      bestDistance = hit;
    }
  }
  return best;
}

export function tagWildlife(
  a: AdventureProgress,
  animal: WildlifeAnimal,
): AdventureProgress {
  if (!animal.alive || a.hunting.removedAnimalIds.includes(animal.id)) return a;
  return {
    ...a,
    hunting: {
      ...a.hunting,
      removedAnimalIds: [...a.hunting.removedAnimalIds, animal.id],
      carcasses: [
        ...a.hunting.carcasses,
        {
          id: animal.id,
          type: animal.type,
          position: { ...animal.position },
          heading: animal.heading,
        },
      ].slice(-50),
    },
  };
}
export function retrieveCarcass(
  a: AdventureProgress,
  id: string,
): AdventureProgress {
  const carcass = a.hunting.carcasses.find((c) => c.id === id);
  if (!carcass || !a.dog.alive) return a;
  return {
    ...a,
    heldKills: {
      ...a.heldKills,
      [carcass.type]: (a.heldKills[carcass.type] ?? 0) + 1,
    },
    hunting: {
      ...a.hunting,
      carcasses: a.hunting.carcasses.filter((c) => c.id !== id),
    },
  };
}
export function consumeCorn(
  a: AdventureProgress,
  gameHours: number,
): AdventureProgress {
  if (!Number.isFinite(gameHours) || gameHours <= 0) return a;
  const elapsed = a.hunting.cornHours + gameHours,
    drops = Math.floor(elapsed / 4);
  return {
    ...a,
    hunting: { ...a.hunting, cornHours: elapsed % 4 },
    feeders: drops
      ? a.feeders.map((f) => ({ ...f, corn: Math.max(0, f.corn - drops) }))
      : a.feeders,
  };
}
export type HuntingResult = {
  ok: boolean;
  progress: FourWheeler3dProgress;
  message: string;
};

/** Discrete inventory actions always recheck mode, distance and owned gear at execution. */
export function applyHuntingItem(
  p: FourWheeler3dProgress,
  action: string,
  player: AdventurePosition,
  mode: TravelMode,
): HuntingResult {
  const fail = (message: string): HuntingResult => ({
    ok: false,
    progress: p,
    message,
  });
  const a = structuredClone(p.adventure),
    inv = a.inventory;
  const success = (message: string): HuntingResult => ({
    ok: true,
    progress: { ...p, adventure: a },
    message,
  });
  if (
    ![
      "foot",
      "stand",
      "vehicle",
      "boat",
      "aircraft",
      "mount",
      "parachute",
    ].includes(mode)
  )
    return fail("Go outside to use your hunting gear.");
  const nearFeeder = [...a.feeders].sort(
    (f, g) => distance(player, f.position) - distance(player, g.position),
  )[0];
  const spend = (key: string) => {
    inv[key] = Math.max(0, (inv[key] ?? 0) - 1);
  };
  if (action === "camo" || action === "bow") {
    if (!(inv[action] > 0))
      return fail(
        `Buy ${action === "camo" ? "a camo suit" : "a bow"} at the Hunting Store first.`,
      );
    if (action === "camo") a.hunting.camoOn = !a.hunting.camoOn;
    else a.hunting.useBow = !a.hunting.useBow;
    return success(
      action === "camo"
        ? `Camo ${a.hunting.camoOn ? "on. Animals cannot see you!" : "off."}`
        : `Now using the ${a.hunting.useBow ? "bow" : "toy rifle"}.`,
    );
  }
  if (action === "grunt") {
    if (a.hunting.gruntUses <= 0) return fail("Buy a Grunt Call for 10 calls.");
    a.hunting.gruntUses--;
    if (!a.hunting.gruntUses) inv.call = 0;
    return success(`GRUNT! ${a.hunting.gruntUses} calls left.`);
  }
  if (action === "scent") {
    if (!(inv.scent > 0))
      return fail("Buy Deer Scent at the Hunting Store first.");
    if (!nearFeeder || distance(player, nearFeeder.position) > meters(280))
      return fail("Walk closer to a feeder to spray scent.");
    nearFeeder.scented = true;
    spend("scent");
    return success(
      "Scent sprayed. Animals can find this feeder from farther away!",
    );
  }
  if (mode !== "foot")
    return fail("Hop off and walk to place or carry your gear.");
  if (action === "corn") {
    if (!a.hunting.carryingCorn) {
      if (!(inv.corn > 0)) return fail("Buy a bag of corn first.");
      a.hunting.carryingCorn = true;
      return success(
        "Carrying corn. Walk to a feeder or trailer, then tap Corn again.",
      );
    }
    if (!(inv.corn > 0)) {
      a.hunting.carryingCorn = false;
      return success("Your corn bag is empty.");
    }
    if (nearFeeder && distance(player, nearFeeder.position) < meters(140)) {
      nearFeeder.corn = Math.min(CORN_MAX, nearFeeder.corn + CORN_BAG);
      spend("corn");
      a.hunting.carryingCorn = false;
      return success(
        `${nearFeeder.label} is ${Math.round((nearFeeder.corn / CORN_MAX) * 100)}% full.`,
      );
    }
    const trailer = Object.values(a.fleet)
      .filter((v) => isTrailer(v.type))
      .sort(
        (x, y) => distance(player, x.position) - distance(player, y.position),
      )[0];
    if (trailer && distance(player, trailer.position) < meters(150)) {
      trailer.cornLoad += CORN_BAG;
      spend("corn");
      a.hunting.carryingCorn = false;
      return success("Corn loaded. Tow this trailer near a feeder to fill it.");
    }
    a.hunting.carryingCorn = false;
    return success("Set the bag down. Move closer to a feeder or trailer.");
  }
  if (action === "feeder") {
    if (nearFeeder && distance(player, nearFeeder.position) < meters(55)) {
      a.feeders = a.feeders.filter((f) => f.id !== nearFeeder.id);
      inv.feeder = (inv.feeder ?? 0) + 1;
      return success("Picked up the feeder.");
    }
    if (!(inv.feeder > 0)) return fail("Buy a feeder or decoy first.");
    if (Math.hypot(player.x, player.z) < LAKE.r)
      return fail("Place the feeder on dry land.");
    let id: string;
    do {
      id = `feeder-${a.nextId++}`;
    } while (a.feeders.some((f) => f.id === id));
    spend("feeder");
    a.feeders.push({
      id,
      position: { x: player.x, y: 0, z: player.z },
      label: `Feeder ${a.feeders.length + 1}`,
      corn: CORN_MAX,
      scented: false,
    });
    return success("Feeder placed!");
  }
  if (action === "stand-tree" || action === "stand-ground") {
    if (!(inv[action] > 0))
      return fail("Buy this stand at Stands & Blinds first.");
    if (Math.hypot(player.x, player.z) < LAKE.r)
      return fail("Place your stand on dry land.");
    let id: string;
    do {
      id = `stand-${a.nextId++}`;
    } while (a.stands.some((s) => s.id === id));
    spend(action);
    a.stands.push({
      id,
      position: { x: player.x, y: 0, z: player.z },
      type: action === "stand-tree" ? "tree" : "ground",
    });
    return success("Stand placed. Walk close and tap Climb.");
  }
  return fail("That hunting action is not available.");
}

export function refillFromCornTrailer(a: AdventureProgress): AdventureProgress {
  const vehicle = a.activeVehicleId ? a.fleet[a.activeVehicleId] : null;
  const trailer = vehicle?.hitch ? a.fleet[vehicle.hitch] : null;
  if (!trailer || trailer.cornLoad <= 0) return a;
  let remaining = trailer.cornLoad;
  const feeders = a.feeders.map((f) => {
    if (
      remaining <= 0 ||
      f.corn >= CORN_MAX ||
      distance(f.position, trailer.position) >= meters(150)
    )
      return f;
    const fill = Math.min(remaining, CORN_MAX - f.corn);
    remaining -= fill;
    return { ...f, corn: f.corn + fill };
  });
  if (remaining === trailer.cornLoad) return a;
  return {
    ...a,
    feeders,
    fleet: { ...a.fleet, [trailer.id]: { ...trailer, cornLoad: remaining } },
  };
}

export function sellHuntingKills(
  p: FourWheeler3dProgress,
  player: AdventurePosition,
): HuntingResult {
  const entries = Object.entries(p.adventure.heldKills).filter(
    ([type, count]) => isAnimalType(type) && count > 0,
  );
  if (!entries.length)
    return {
      ok: false,
      progress: p,
      message: "Your dog has no tags to sell yet. Tap Retrieve after a tag.",
    };
  const a = structuredClone(p.adventure);
  let total = 0,
    count = 0;
  for (const [type, n] of entries) {
    total += killValue(type) * n;
    count += n;
    a.trophyCounts[type] = (a.trophyCounts[type] ?? 0) + n;
    if (type === "buck")
      for (let i = 0; i < n; i++)
        a.hunting.looseSkulls.push({
          id: `skull-${a.nextId++}`,
          position: { x: player.x, y: player.y, z: player.z },
        });
  }
  a.heldKills = {};
  return {
    ok: true,
    progress: {
      ...p,
      money: p.money + total,
      totalEarned: p.totalEarned + total,
      adventure: a,
    },
    message: `Sold ${count} tags for $${total.toLocaleString("en-US")}. Trophies added!`,
  };
}

/** Original wolf reset keeps cash and land, but resets fleet, wildlife and trophies. */
export function wolfReset(p: FourWheeler3dProgress): FourWheeler3dProgress {
  const fresh = createAdventureProgress();
  const adventure = {
    ...p.adventure,
    fleet: fresh.fleet,
    activeVehicleId: null,
    feeders: fresh.feeders,
    stands: fresh.stands,
    trophyCounts: {},
    heldKills: {},
    collectedSkulls: 0,
    dog: { hungerHours: 0, alive: true },
    hunting: {
      ...p.adventure.hunting,
      removedAnimalIds: [],
      carcasses: [],
      looseSkulls: [],
      cornHours: 0,
    },
    inventory: {
      ...p.adventure.inventory,
      feeder: 0,
      "stand-tree": 0,
      "stand-ground": 0,
    },
  };
  adventure.fleet["starter-atv"].parked = true;
  adventure.fleet["starter-atv"].position = {
    x: LANDMARKS.garage.x - 19,
    y: 0,
    z: LANDMARKS.garage.z - 1,
  };
  return {
    ...p,
    trophies: 0,
    hunger: 0,
    currentVehicle: "atv",
    ownedVehicles: [...new Set(Object.values(fresh.fleet).map((v) => v.type))],
    adventure,
  };
}
