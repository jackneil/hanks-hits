import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BAITS,
  findOffer,
  OFFERS,
  PHONE_APPS,
  resalePrice,
  STORE_CATALOGS,
} from "../lib/catalog";

const source = readFileSync(
  join(__dirname, "../../../../public/games/four-wheeler-adventure/index.html"),
  "utf8",
);
const sourceArray = (name: string) =>
  source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`))![1];

describe("original game catalogs", () => {
  it("keeps every car and boat dealer type from the original", () => {
    for (const [constant, store] of [
      ["FOR_SALE", "dealership"],
      ["FOR_SALE_BOATS", "boatDealer"],
    ] as const) {
      const keys = [...sourceArray(constant).matchAll(/key:'([^']+)'/g)].map(
        (m) => m[1],
      );
      const actual = STORE_CATALOGS[store]
        .filter((o) => o.key !== "feeder")
        .map((o) => o.key);
      expect(actual).toEqual(keys);
    }
  });
  it("ports all thirty Anything Store offers and their original prices", () => {
    const entries = [
      ...sourceArray("FOR_SALE_ANY").matchAll(
        /\['[^']+','([^']+)','([^']+)',(\d+)\]/g,
      ),
    ];
    expect(entries).toHaveLength(30);
    expect(STORE_CATALOGS.anyStore).toHaveLength(entries.length);
    for (const [, , originalKey, rawPrice] of entries) {
      const key =
        originalKey === "long"
          ? "trailer"
          : originalKey === "mega"
            ? "megatrailer"
            : originalKey;
      expect(findOffer(`anyStore:${key}`)?.price).toBe(Number(rawPrice));
    }
  });
  it("keeps offer-specific prices and the original separate resale rule", () => {
    expect(findOffer("boatDealer:fishingboat")?.price).toBe(5000);
    expect(findOffer("anyStore:fishingboat")?.price).toBe(50000);
    expect(findOffer("boatDealer:megatrailer")?.price).toBe(5000);
    expect(findOffer("anyStore:megatrailer")?.price).toBe(10000);
    expect(resalePrice("fishingboat")).toBe(5000);
    expect(resalePrice("mower")).toBe(8000);
    expect(resalePrice("yacht")).toBe(10000000);
    expect(resalePrice("unknown")).toBe(0);
    expect(resalePrice("plow")).toBe(0);
  });
  it("has all original specialist shops and twelve phone destinations", () => {
    expect(STORE_CATALOGS.huntStore).toHaveLength(10);
    expect(STORE_CATALOGS.flyStore).toHaveLength(6);
    expect(STORE_CATALOGS.standStore).toHaveLength(2);
    expect(STORE_CATALOGS.saddleShop).toHaveLength(6);
    expect(STORE_CATALOGS.bucketShop).toHaveLength(8);
    expect(STORE_CATALOGS.bikeStore).toHaveLength(8);
    expect(PHONE_APPS.map((a) => a.label)).toEqual([
      "Amazon",
      "Hunting Sim",
      "Calculator",
      "GPS",
      "Maps",
      "Disney+",
      "YouTube",
      "Games",
      "Music",
      "Weather",
      "Fire Truck",
      "Photos",
    ]);
    expect(new Set(OFFERS.map((o) => o.id)).size).toBe(OFFERS.length);
    expect(OFFERS.every((o) => Number.isFinite(o.price) && o.price > 0)).toBe(
      true,
    );
  });
  it("retains the bait odds, including bad bait only catching little fish", () => {
    expect(BAITS.bad.chances).toEqual([0.85, 0, 0, 0, 0]);
    expect(BAITS.rainbow.price).toBe(100000);
    expect(BAITS.rainbow.chances).toEqual([0.98, 0.98, 0.98, 0.98, 0.98]);
  });
});
