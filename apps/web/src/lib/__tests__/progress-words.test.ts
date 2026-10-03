import { describe, expect, it } from "vitest";
import { extractProgressWords, stripProgressWords } from "../progress-words";

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
