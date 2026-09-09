import type { FishType } from "./constants";

export type StoreId =
  | "dealership"
  | "boatDealer"
  | "anyStore"
  | "huntStore"
  | "flyStore"
  | "standStore"
  | "saddleShop"
  | "bucketShop"
  | "bikeStore";
export type OfferKind =
  | "vehicle"
  | "trailer"
  | "gear"
  | "feeder"
  | "stand"
  | "bait"
  | "aircraft-package"
  | "train"
  | "rocket"
  | "plow"
  | "corn"
  | "bucket"
  | "saddle";
export type StoreOffer = {
  id: string;
  storeId: StoreId;
  key: string;
  label: string;
  price: number;
  kind: OfferKind;
  color?: string;
  capacity?: number;
  /** Original bike shop label, before the game's 8x speed multiplier. */
  mph?: number;
};

export const STORE_LABELS: Record<StoreId, string> = {
  dealership: "Car Dealership",
  boatDealer: "Boat & Trailer",
  anyStore: "Anything Store",
  huntStore: "Hunting Store",
  flyStore: "Flying Stuff",
  standStore: "Stands & Blinds",
  saddleShop: "Saddle Shop",
  bucketShop: "Buckets",
  bikeStore: "Bike Shop",
};
const offer = (
  storeId: StoreId,
  key: string,
  label: string,
  price: number,
  kind: OfferKind,
  extra: Partial<Pick<StoreOffer, "color" | "capacity" | "mph">> = {},
): StoreOffer => ({
  id: `${storeId}:${key}`,
  storeId,
  key,
  label,
  price,
  kind,
  ...extra,
});

/** The source has intentionally different prices for the same type at different shops. */
const cars: [string, string, number][] = [
  ["atv", "Four-Wheeler", 20000],
  ["utv", "Side-by-Side", 20000],
  ["truck", "F250 Truck", 20000],
  ["moto", "Motorcycle", 20000],
  ["lambo", "Ferrari", 50000],
  ["semi", "18-Wheeler", 20000],
  ["firetruck", "Fire Truck", 150000],
  ["monster", "Monster Truck", 40000],
  ["racecar", "Race Car", 80000],
  ["muscle", "Muscle Car", 45000],
  ["tractor", "Tractor", 25000],
  ["rv", "Camper RV", 45000],
];
const boats: [string, string, number][] = [
  ["boat", "Speedboat", 5000],
  ["pontoon", "Pontoon", 5000],
  ["jetski", "Jet Ski", 5000],
  ["canoe", "Canoe", 3000],
  ["sailboat", "Sailboat", 12000],
  ["tugboat", "Tugboat", 30000],
  ["minifishingboat", "Mini Fishing Boat", 5000],
  ["fishingboat", "Fishing Boat", 5000],
];
const aircraft: [string, string, number][] = [
  ["plane", "Plane", 60000],
  ["biplane", "Biplane", 40000],
  ["jet", "Jet", 200000],
  ["heli", "Helicopter", 80000],
  ["chopper", "Chopper", 120000],
  ["rocket", "Rocket Ship", 500000],
];
const hunting: [string, string][] = [
  ["bow", "Bow & Arrow"],
  ["decoy", "Decoy"],
  ["camo", "Camo Suit"],
  ["scent", "Deer Scent"],
  ["bino", "Binoculars"],
  ["call", "Grunt Call"],
  ["ammo", "Extra Ammo"],
  ["target", "Targets"],
  ["warm", "Hand Warmers"],
  ["rod", "Fishing Rod"],
];
export const BUCKET_COLORS = [
  ["Red", "#e0241f"],
  ["Blue", "#3a6ee0"],
  ["Green", "#3aa84a"],
  ["Yellow", "#ffd23f"],
  ["Pink", "#e84fae"],
  ["White", "#f4f4f4"],
  ["Orange", "#ff7a1a"],
  ["Purple", "#8a4fd0"],
] as const;
export const SADDLES = [
  "Western",
  "Racing",
  "Brown",
  "Black",
  "Pink",
  "Show",
] as const;
export const BIKES = [
  ["kids", "Kids' Bike", 18, 480, "#e84fae"],
  ["bmx", "BMX Bike", 30, 1400, "#e0481a"],
  ["cruiser", "Cruiser Bike", 28, 1200, "#2aa86a"],
  ["mtb", "Mountain Bike", 44, 3400, "#3a6ee0"],
  ["road", "Road Bike", 60, 6000, "#ffd23f"],
  ["ebike", "Electric City Bike", 40, 7200, "#10b0a0"],
  ["emtb", "Electric Mtn Bike", 56, 14000, "#5a3ad0"],
  ["supere", "Super E-Bike", 90, 18000, "#2a2d33"],
] as const;
export const FISH_VALUES: Record<FishType, number> = {
  little: 1000,
  middle: 10000,
  big: 15000,
  huge: 30000,
  rainbow: 1000000,
};
export const BAITS = {
  cheap: {
    label: "Cheap Bait",
    price: 100,
    chances: [0.9, 0.3, 0.15, 0.08, 0.03],
  },
  bad: { label: "Bad Bait", price: 400, chances: [0.85, 0, 0, 0, 0] },
  good: {
    label: "Good Bait",
    price: 1000,
    chances: [0.72, 0.62, 0.42, 0.22, 0.05],
  },
  mediocre: {
    label: "Mediocre Bait",
    price: 4000,
    chances: [0.5, 0.72, 0.64, 0.34, 0.06],
  },
  pro: {
    label: "Pro Bait",
    price: 10000,
    chances: [0.72, 0.74, 0.68, 0.54, 0.1],
  },
  ace: {
    label: "Ace Bait",
    price: 20000,
    chances: [0.46, 0.46, 0.46, 0.46, 0.16],
  },
  rainbow: {
    label: "Rainbow Bait",
    price: 100000,
    chances: [0.98, 0.98, 0.98, 0.98, 0.98],
  },
} as const;

/** Exact physical catalogs from the original index.html lines 784-918. */
export const STORE_CATALOGS: Record<StoreId, readonly StoreOffer[]> = {
  dealership: [
    ...cars.map(([k, l, p]) => offer("dealership", k, l, p, "vehicle")),
    offer("dealership", "feeder", "Corn Feeder", 500, "feeder"),
  ],
  boatDealer: [
    ...boats.map(([k, l, p]) => offer("boatDealer", k, l, p, "vehicle")),
    offer("boatDealer", "trailer", "Long Trailer", 5000, "trailer", {
      capacity: 4,
    }),
    offer("boatDealer", "boattrailer", "Boat Trailer", 5000, "trailer", {
      capacity: 1,
    }),
    offer("boatDealer", "megatrailer", "Mega Trailer", 5000, "trailer", {
      capacity: 12,
    }),
    offer("boatDealer", "mower", "Pull-Behind Mower", 8000, "trailer"),
    offer("boatDealer", "camper", "Camper", 35000, "trailer"),
  ],
  anyStore: [
    ...cars
      .slice(0, 6)
      .map(([k, l, p]) => offer("anyStore", k, l, p, "vehicle")),
    offer("anyStore", "boat", "Speedboat", 5000, "vehicle"),
    offer("anyStore", "jetski", "Jet Ski", 5000, "vehicle"),
    offer("anyStore", "pontoon", "Pontoon", 5000, "vehicle"),
    offer("anyStore", "minifishingboat", "Mini Fishing Boat", 15000, "vehicle"),
    offer("anyStore", "fishingboat", "Big Fishing Boat", 50000, "vehicle"),
    offer("anyStore", "yacht", "Mega Yacht", 10000000, "vehicle"),
    offer("anyStore", "rod", "Fishing Rod", 100, "gear"),
    ...Object.entries(BAITS).map(([k, b]) =>
      offer("anyStore", k, b.label, b.price, "bait"),
    ),
    offer(
      "anyStore",
      "aircraft",
      "Aircraft Package",
      200000,
      "aircraft-package",
    ),
    offer("anyStore", "train", "Train", 110000, "train"),
    offer("anyStore", "plow", "Snow Plow", 4000, "plow"),
    offer("anyStore", "corn", "Bag of Corn", 200, "corn"),
    offer("anyStore", "trailer", "Long Trailer", 5000, "trailer", {
      capacity: 4,
    }),
    offer("anyStore", "megatrailer", "Mega Trailer", 10000, "trailer", {
      capacity: 12,
    }),
    offer("anyStore", "boattrailer", "Boat Trailer", 5000, "trailer", {
      capacity: 1,
    }),
    offer("anyStore", "feeder", "Corn Feeder", 500, "feeder"),
    offer("anyStore", "tree", "Tree Stand", 1000, "stand"),
    offer("anyStore", "ground", "Ground Blind", 400, "stand"),
  ],
  huntStore: hunting.map(([k, l]) => offer("huntStore", k, l, 100, "gear")),
  flyStore: aircraft.map(([k, l, p]) =>
    offer("flyStore", k, l, p, k === "rocket" ? "rocket" : "vehicle"),
  ),
  standStore: [
    offer("standStore", "tree", "Tree Stand", 1000, "stand"),
    offer("standStore", "ground", "Ground Blind", 400, "stand"),
  ],
  saddleShop: SADDLES.map((l) =>
    offer(
      "saddleShop",
      `saddle-${l.toLowerCase()}`,
      `${l} Saddle`,
      100,
      "saddle",
    ),
  ),
  bucketShop: BUCKET_COLORS.map(([l, color]) =>
    offer(
      "bucketShop",
      `bucket-${l.toLowerCase()}`,
      `${l} Bucket`,
      200,
      "bucket",
      { color },
    ),
  ),
  bikeStore: BIKES.map(([k, l, mph, p, color]) =>
    offer("bikeStore", k, l, p, "vehicle", { mph, color }),
  ),
};
export const OFFERS: readonly StoreOffer[] =
  Object.values(STORE_CATALOGS).flat();
export function findOffer(id: string): StoreOffer | undefined {
  return OFFERS.find((o) => o.id === id);
}

export const WATER_VEHICLES = [
  "boat",
  "pontoon",
  "jetski",
  "canoe",
  "sailboat",
  "tugboat",
  "minifishingboat",
  "fishingboat",
  "yacht",
] as const;
export const AIR_VEHICLES = [
  "plane",
  "heli",
  "biplane",
  "chopper",
  "jet",
] as const;
export const TRAILER_TYPES = [
  "trailer",
  "boattrailer",
  "megatrailer",
  "mower",
  "camper",
  "plow",
] as const;
export function isWaterVehicle(type: string): boolean {
  return (WATER_VEHICLES as readonly string[]).includes(type);
}
export function isAirVehicle(type: string): boolean {
  return (AIR_VEHICLES as readonly string[]).includes(type);
}
export function isTrailer(type: string): boolean {
  return (TRAILER_TYPES as readonly string[]).includes(type);
}
export function isLandVehicle(type: string): boolean {
  return [...cars.map((c) => c[0]), ...BIKES.map((b) => b[0]), "bike"].includes(
    type,
  );
}

/** Original buyPrice uses boat-dealer prices before Anything Store prices. */
export function resalePrice(type: string): number {
  if (type === "plow") return 0;
  if (isTrailer(type)) return type === "mower" ? 8000 : 5000;
  const bike = BIKES.find((b) => b[0] === type);
  if (bike) return bike[3];
  return (
    cars.find((c) => c[0] === type)?.[2] ??
    boats.find((b) => b[0] === type)?.[2] ??
    aircraft.find((a) => a[0] === type)?.[2] ??
    (type === "yacht" ? 10000000 : 0)
  );
}

/** Phone navigation is local pretend content, matching the original twelve apps. */
export const PHONE_APPS = [
  { id: "amazon", label: "Amazon", icon: "📦" },
  { id: "hunting", label: "Hunting Sim", icon: "🌽" },
  { id: "calculator", label: "Calculator", icon: "🧮" },
  { id: "gps", label: "GPS", icon: "🧭" },
  { id: "maps", label: "Maps", icon: "🗺️" },
  { id: "disney", label: "Disney+", icon: "✨" },
  { id: "youtube", label: "YouTube", icon: "📺" },
  { id: "games", label: "Games", icon: "🎮" },
  { id: "music", label: "Music", icon: "🎵" },
  { id: "weather", label: "Weather", icon: "☀️" },
  { id: "firetruck", label: "Fire Truck", icon: "🚒" },
  { id: "photos", label: "Photos", icon: "📷" },
] as const;
export const AMAZON_STORES: readonly StoreId[] = [
  "anyStore",
  "dealership",
  "boatDealer",
  "huntStore",
  "saddleShop",
  "flyStore",
  "bucketShop",
  "bikeStore",
];
export const PAINT_COLORS = [
  "#e0241f",
  "#ff8a2e",
  "#ffd23f",
  "#5fc25f",
  "#1f9bd8",
  "#3a3fae",
  "#a78bfa",
  "#ff5fa2",
  "#1a1a1a",
  "#f4f4f4",
  "#8a5a2a",
  "#00c2a0",
] as const;
export const LAND_PRICE = 6000;
export const LAND_UPGRADE_PRICES = [8000, 15000, 25000, 40000] as const;
export const LAND_SIZE_MULTIPLIERS = [1, 1.35, 1.8, 2.3, 2.8] as const;
export const BUILD_PRICES = {
  garage: 3000,
  trophy: 3000,
  "house-small": 4000,
  "house-medium": 10000,
  "house-huge": 25000,
} as const;
