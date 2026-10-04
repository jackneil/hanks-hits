import { mergeProgress } from "../progress-merge";
import { describe, expect, it } from "vitest";
import { createWordProjection, extractProgressWords, stripProgressWords } from "../progress-words";

describe("progress word preservation inventory", () => {
  it.each([
    ["oregon-trail", { leaderName: "Alice", party: [{ name: "Bob", health: 90 }] }, { leaderName: "", party: [{ name: "", health: 90 }] }, 2],
    ["weather", { savedLocations: [{ name: "Town", latitude: 3 }], lastLocation: { name: "Place" } }, { savedLocations: [], lastLocation: null }, 2],
    ["toy-finder", { wishlistItems: [{ toyId: "truck", notes: "My note", priority: "high" }] }, { wishlistItems: [{ toyId: "truck", priority: "high" }] }, 1],
    ["drawing-app", { savedArtworks: [{ id: "art", name: "Picture", dataUrl: "data:image/png;base64,abc" }] }, {}, 1],
    ["drum-machine", { savedBeats: [{ id: "beat", name: "Jam", bpm: 90 }] }, { savedBeats: [{ id: "beat", name: "", bpm: 90 }] }, 1],
    ["virtual-pet", { pet: { name: "Fluffy", speciesId: "cat", bornAt: "2026-01-01" }, settings: { petName: "Fluffy" } }, { pet: { name: "", speciesId: "cat", bornAt: "2026-01-01" }, settings: { petName: "" } }, 2],
    ["four-wheeler-3d", { adventure: { outfit: { text: "Racer", color: "blue" }, feeders: [{ id: "f", label: "Back yard", food: 30 }] } }, { adventure: { outfit: { text: "", color: "blue" }, feeders: [{ id: "f", label: "", food: 30 }] } }, 2],
  ])("preserves %s fields without changing gameplay or the source", (app, words, blank, count) => {
    const source = { ...words as object, lastModified: 1234, coins: 87 };
    const before = structuredClone(source);
    const extracted = extractProgressWords(app as string, source);
    expect(extracted.fields).toHaveLength(count as number);
    expect(stripProgressWords(app as string, source)).toEqual({ ...blank as object, lastModified: 1234, coins: 87 });
    expect(source).toEqual(before);
    expect(extractProgressWords(app as string, stripProgressWords(app as string, source)).fields).toEqual([]);
  });

  it("retains exact identities while leaving unidentified legacy journeys unmatched", () => {
    const journey = { leaderName: "Alice", party: [{ name: "Bob" }], occupation: "banker", gameStarted: true };
    expect(extractProgressWords("oregon-trail", journey).fields[0].identity).toEqual({});
    expect(extractProgressWords("oregon-trail", { ...journey, journeyId: "journey-1" }).fields[1].identity).toEqual({ journeyId: "journey-1", index: 0 });
    expect(extractProgressWords("toy-finder", { wishlistItems: [{ toyId: "t", notes: "Note" }] }).fields[0].identity).toEqual({ index: 0, toyId: "t" });
    expect(extractProgressWords("virtual-pet", { pet: { name: "F", speciesId: "cat", bornAt: "date" } }).fields[0].identity).toEqual({ speciesId: "cat", bornAt: "date" });
  });

  it("leaves unrelated and malformed shapes intact without inventing recoverable values", () => {
    expect(stripProgressWords("snake", { highScore: 8 })).toEqual({ highScore: 8 });
    expect(stripProgressWords("oregon-trail", null)).toBeNull();
    expect(extractProgressWords("oregon-trail", { party: null }).fields).toEqual([]);
  });
});


describe("memoized local/cloud word projection", () => {
  it("compares every flat field while reusing unchanged nested gameplay references", () => {
    const project = createWordProjection<Record<string, unknown>>("oregon-trail");
    const supplies = { food: 500 };
    const party = [{ id: "m0", name: "Private", health: 90 }];
    const input = { journeyId: "j1", leaderName: "Secret", party, supplies, milesTraveled: 10, lastModified: 100 };
    const first = project(input);
    expect(project({ ...input })).toBe(first);
    expect(first.supplies).toBe(supplies);
    expect(first.party).not.toBe(party);
    expect(project({ ...input, leaderName: "Changed private name" })).toBe(first);
    const progressed = project({ ...input, milesTraveled: 11 });
    expect(progressed).not.toBe(first);
    expect(progressed.milesTraveled).toBe(11);
    expect(progressed.party).toBe(first.party);
    expect(progressed.lastModified).toBe(100);
    expect(input.leaderName).toBe("Secret");
  });

  it.each(Object.keys({ "oregon-trail": 1, weather: 1, "toy-finder": 1, "drawing-app": 1, "drum-machine": 1, "virtual-pet": 1, "four-wheeler-3d": 1 }))("matches the reviewed full projection for %s after personal and gameplay edits", appId => {
    const project = createWordProjection(appId);
    const initial = { leaderName: "Alice", party: [{ id: "m0", name: "Bob" }], savedLocations: [{ name: "Town" }], lastLocation: { name: "Town" }, wishlistItems: [{ toyId: "t", notes: "private" }], savedArtworks: [{ id: "a", name: "Art", dataUrl: "secret" }], savedBeats: [{ id: "b", name: "Song", bpm: 90 }], pet: { name: "Fluffy" }, settings: { petName: "Fluffy" }, adventure: { outfit: { text: "Driver" }, feeders: [{ id: "f", label: "Home" }] }, lastModified: 100 };
    expect(project(initial)).toEqual(stripProgressWords(appId, initial));
    const changed = JSON.parse(JSON.stringify(initial).replaceAll("Fluffy", "New pet").replaceAll("private", "New note").replaceAll("Driver", "New outfit").replaceAll("Bob", "New member"));
    expect(project(changed)).toEqual(stripProgressWords(appId, changed));
    expect(extractProgressWords(appId, project(changed)).fields).toEqual([]);
    expect(project({ ...changed })).toBe(project(changed));
  });
});


it("carries Oregon identity with the unchanged whole-journey winner", () => {
  const earlier = { journeyId: "old", milesTraveled: 800, lastModified: 100 };
  const newer = { journeyId: "new", milesTraveled: 20, lastModified: 200 };
  expect(mergeProgress(earlier, newer, 100, 200, "oregon-trail").data).toEqual(newer);
  expect(mergeProgress(newer, earlier, 200, 100, "oregon-trail").data).toEqual(newer);
  const legacy = { milesTraveled: 30, lastModified: 300 };
  expect(mergeProgress(newer, legacy, 200, 300, "oregon-trail").data).toEqual(legacy);
});
