import { describe, expect, it } from "vitest";
import {
  DISNEY_VIDEOS,
  YOUTUBE_CHANNELS,
  MEDIA_VIDEOS,
  createMediaLibrary,
  findMedia,
  reduceMedia,
} from "../lib/mediaCatalog";
import {
  ANIMAL_MAP_COLORS,
  BONE_POINTS,
  wildlifeMapPaths,
} from "../lib/mapData";
import { buildWildlife } from "../lib/hunting";

describe("local pretend media", () => {
  it("preserves the complete ten-title and ten-channel catalogs with all MrBeast episodes", () => {
    expect(DISNEY_VIDEOS.map((v) => v.title)).toEqual([
      "The Lion King",
      "Cars",
      "Frozen",
      "Moana",
      "Spider-Man",
      "Toy Story",
      "The Avengers",
      "Finding Nemo",
      "Encanto",
      "Star Wars",
    ]);
    expect(YOUTUBE_CHANNELS).toHaveLength(10);
    expect(
      YOUTUBE_CHANNELS.find((c) => c.id === "mrbeast")?.videos,
    ).toHaveLength(10);
    expect(
      YOUTUBE_CHANNELS.find((c) => c.id === "crunchlabs")?.videos[0].title,
    ).toBe("Build Box: Coolest Gadget Yet! 🔧");
    expect(new Set(MEDIA_VIDEOS.map((v) => v.id)).size).toBe(29);
  });
  it("plays, pauses and seeks while keeping a bounded progress clock", () => {
    let s = reduceMedia(createMediaLibrary(), {
      type: "select",
      id: "disney-cars",
    });
    s = reduceMedia(s, { type: "tick", seconds: 0.4 });
    expect(s.progress["disney-cars"]).toBe(0.4);
    s = reduceMedia(s, { type: "pause" });
    expect(reduceMedia(s, { type: "tick", seconds: 1 })).toBe(s);
    s = reduceMedia(s, { type: "seek", seconds: 20 });
    expect(s.progress["disney-cars"]).toBe(20);
    expect(s.playing).toBe(false);
    expect(
      reduceMedia(s, { type: "seek", seconds: -20 }).progress["disney-cars"],
    ).toBe(0);
    expect(reduceMedia(s, { type: "seek", seconds: NaN })).toBe(s);
  });
  it("finishes once, clamps overshooting seeks and replays from zero", () => {
    let s = reduceMedia(createMediaLibrary(), {
      type: "select",
      id: "mrbeast-1",
    });
    s = reduceMedia(s, { type: "seek", seconds: 59.8 });
    s = reduceMedia(s, { type: "tick", seconds: 0.8 });
    expect(s.playing).toBe(false);
    expect(s.progress["mrbeast-1"]).toBe(60);
    s = reduceMedia(s, { type: "play" });
    expect(s.playing).toBe(true);
    expect(s.progress["mrbeast-1"]).toBe(0);
    expect(
      reduceMedia(s, { type: "seek", seconds: 1e9 }).progress["mrbeast-1"],
    ).toBe(60);
  });
  it("resumes each episode independently when switching channels", () => {
    let s = reduceMedia(createMediaLibrary(), {
      type: "select",
      id: "disney-moana",
    });
    s = reduceMedia(s, { type: "seek", seconds: 13 });
    s = reduceMedia(s, { type: "select", id: "mrbeast-3" });
    s = reduceMedia(s, { type: "seek", seconds: 25 });
    s = reduceMedia(s, { type: "select", id: "disney-moana" });
    expect(s.progress["disney-moana"]).toBe(13);
    expect(s.progress["mrbeast-3"]).toBe(25);
    expect(reduceMedia(s, { type: "select", id: "missing" })).toBe(s);
    expect(findMedia("missing")).toBeUndefined();
  });
  it("likes individual videos and subscribes at channel level without duplicates", () => {
    let s = reduceMedia(createMediaLibrary(), {
      type: "select",
      id: "mrbeast-1",
    });
    s = reduceMedia(s, { type: "like" });
    s = reduceMedia(s, { type: "subscribe" });
    s = reduceMedia(s, { type: "select", id: "mrbeast-2" });
    expect(s.liked).toEqual(["mrbeast-1"]);
    expect(s.subscribed).toEqual(["mrbeast"]);
    s = reduceMedia(s, { type: "subscribe" });
    expect(s.subscribed).toEqual([]);
    s = reduceMedia(s, { type: "like" });
    expect(s.liked).toHaveLength(2);
  });
});
describe("efficient live map layers", () => {
  it("shares all56 stable collectible locations without duplicate IDs", () => {
    expect(BONE_POINTS).toHaveLength(56);
    expect(new Set(BONE_POINTS.map((b) => b.id)).size).toBe(56);
    expect(
      BONE_POINTS.every(
        (b) =>
          Number.isFinite(b.x) &&
          Number.isFinite(b.z) &&
          Math.hypot(b.x, b.z) < 2000,
      ),
    ).toBe(true);
  });
  it("batches the full population into at most eight species paths", () => {
    const animals = buildWildlife(),
      paths = wildlifeMapPaths(animals, { x: 0, z: 0, span: 4200 }, 10);
    expect(Object.keys(paths).length).toBeLessThanOrEqual(8);
    expect(Object.keys(paths).every((type) => type in ANIMAL_MAP_COLORS)).toBe(
      true,
    );
    expect(Object.values(paths).join("").match(/M/g)?.length).toBe(1876);
  });
  it("samples current animal positions and removes dead and offscreen markers", () => {
    const animals = buildWildlife().slice(0, 3);
    animals[0].position = { x: 10, y: 0, z: 20 };
    animals[1].position = { x: 1000, y: 0, z: 1000 };
    animals[2].position = { x: 0, y: 0, z: 0 };
    animals[2].alive = false;
    const before = wildlifeMapPaths(animals, { x: 0, z: 0, span: 100 }, 2);
    expect(Object.values(before).join("")).toBe("M9.0 19.0h2v2h-2Z");
    animals[0].position.x = -20;
    expect(
      Object.values(
        wildlifeMapPaths(animals, { x: 0, z: 0, span: 100 }, 2),
      ).join(""),
    ).toContain("M-21.0 19.0");
  });
});
