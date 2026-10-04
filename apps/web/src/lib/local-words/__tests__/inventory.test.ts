import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROGRESS_WORD_FIELDS } from "../../progress-words";
import { extractLegacyWordSource, legacyWordSources } from "../inventory";

type Envelope = { state: Record<string, unknown>; version: number };
const raw = (state: Record<string, unknown>) => JSON.stringify({ state, version: 0 });

describe("legacy local-word inventory", () => {
  it("covers exactly the seven reviewed apps and their captured real storage keys", () => {
    const fixture = JSON.parse(readFileSync(join(__dirname, "../../../__tests__/fixtures/legacy-saves.json"), "utf8")) as {
      saves: Record<string, { key: string; [scenario: string]: string | Envelope }>;
    };
    expect(Object.keys(legacyWordSources).sort()).toEqual(Object.keys(PROGRESS_WORD_FIELDS).sort());
    for (const [appId, key] of Object.entries(legacyWordSources)) {
      expect(key, appId).toBe(fixture.saves[appId].key);
      // Actual captured saves include untouched, played and preference-only
      // shapes, with the historical persist version and migration markers.
      for (const [scenario, envelope] of Object.entries(fixture.saves[appId])) {
        if (typeof envelope === "string") continue;
        const captured = JSON.stringify(envelope);
        const result = extractLegacyWordSource(appId, captured);
        expect(result, `${appId}/${scenario}`).not.toBeNull();
        expect(result!.progress).toEqual(envelope.state.progress ?? envelope.state);
        expect(JSON.stringify(envelope)).toBe(captured);
      }
    }
  });

  it("preserves Oregon setup-phase names as unmatched candidates, without stamping play", () => {
    const state = { gamePhase: "setup_party", gameStarted: false, leaderName: "River",
      party: [{ name: "Cedar", health: 100 }], occupation: "banker", lastModified: 0 };
    const result = extractLegacyWordSource("oregon-trail", raw(state));
    expect(result).toEqual({ progress: state, fields: [
      { path: "leaderName", value: "River", identity: {} },
      { path: "party[0].name", value: "Cedar", identity: { index: 0 } },
    ] });
  });

  it("retains an existing journey identity without deriving one from its settings", () => {
    const result = extractLegacyWordSource("oregon-trail", raw({ journeyId: "journey-7", leaderName: "River",
      party: [{ id: "traveler-2", name: "Cedar" }], lastModified: 123 }));
    expect(result!.fields.map(field => field.identity)).toEqual([
      { journeyId: "journey-7" }, { journeyId: "journey-7", index: 0, id: "traveler-2" },
    ]);
  });

  it("retains complete weather location values from its flat save", () => {
    const town = { name: "Home town", latitude: 12, longitude: 34 };
    const result = extractLegacyWordSource("weather", raw({ savedLocations: [town], lastLocation: town, units: "celsius" }));
    expect(result!.fields).toEqual([
      { path: "savedLocations", value: [town], identity: {} },
      { path: "lastLocation", value: town, identity: {} },
    ]);
  });

  it("keeps wishlist notes with their existing toy identity", () => {
    const result = extractLegacyWordSource("toy-finder", raw({ wishlistItems: [{ toyId: "truck-1", notes: "Birthday idea" }] }));
    expect(result!.fields).toEqual([
      { path: "wishlistItems[0].notes", value: "Birthday idea", identity: { index: 0, toyId: "truck-1" } },
    ]);
  });

  it("preserves complete artwork records, including names and image content", () => {
    const artwork = { id: "art-1", name: "My picture", dataUrl: "data:image/png;base64,AAAA", createdAt: 123 };
    const result = extractLegacyWordSource("drawing-app", raw({ savedArtworks: [artwork], stats: { drawingsCreated: 1 } }));
    expect(result!.fields).toEqual([{ path: "savedArtworks", value: [artwork], identity: {} }]);
  });

  it("extracts beat names from nested progress, preserving beat IDs and unnamed candidates", () => {
    const result = extractLegacyWordSource("drum-machine", raw({ progress: {
      savedBeats: [{ id: "beat-1", name: "Morning rhythm" }, { name: "Old rhythm" }], lastModified: 234,
    } }));
    expect(result!.fields).toEqual([
      { path: "savedBeats[0].name", value: "Morning rhythm", identity: { index: 0, id: "beat-1" } },
      { path: "savedBeats[1].name", value: "Old rhythm", identity: { index: 1 } },
    ]);
  });

  it("retains both pet-name fields and existing species/birth identity", () => {
    const identity = { speciesId: "blobby", bornAt: "2026-09-01T12:00:00.000Z" };
    const result = extractLegacyWordSource("virtual-pet", raw({ progress: {
      pet: { ...identity, name: "Puddle", hunger: 80 }, settings: { petName: "Puddles" },
    } }));
    expect(result!.fields).toEqual([
      { path: "pet.name", value: "Puddle", identity },
      { path: "settings.petName", value: "Puddles", identity },
    ]);
    expect(extractLegacyWordSource("virtual-pet", raw({ progress: { pet: { name: "Legacy pet" } } }))!.fields[0].identity).toEqual({});
  });

  it("extracts singleton outfit text and each feeder label from 3D progress", () => {
    const result = extractLegacyWordSource("four-wheeler-3d", raw({ progress: { adventure: {
      outfit: { text: "Trail team", color: "red" }, feeders: [{ id: "feed-1", label: "By the oak" }],
    }, coins: 42 } }));
    expect(result!.fields).toEqual([
      { path: "adventure.outfit.text", value: "Trail team", identity: {} },
      { path: "adventure.feeders[0].label", value: "By the oak", identity: { index: 0, id: "feed-1" } },
    ]);
  });

  it("returns detached fields without mutating progress or treating empty words as edits", () => {
    const result = extractLegacyWordSource("drawing-app", raw({ savedArtworks: [{ id: "a", name: "Kept" }], lastModified: 12 }))!;
    (result.fields[0].value as Array<{ name: string }>)[0].name = "Changed copy";
    expect(result.progress).toEqual({ savedArtworks: [{ id: "a", name: "Kept" }], lastModified: 12 });
    expect(extractLegacyWordSource("weather", raw({ savedLocations: [], lastLocation: null }))!.fields).toEqual([]);
  });

  it("quarantines unrecognized or malformed envelopes without logging their contents", () => {
    const warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error"), log = vi.spyOn(console, "log");
    try {
      for (const value of ["private broken text", "null", "[]", "{}", '{"state":null}', '{"state":[]}', '{"state":"private text"}']) {
        expect(extractLegacyWordSource("oregon-trail", value)).toBeNull();
      }
      expect(extractLegacyWordSource("drum-machine", raw({ savedBeats: [] }))).toBeNull();
      expect(extractLegacyWordSource("unknown", raw({ leaderName: "Private" }))).toBeNull();
      expect(extractLegacyWordSource("__proto__", raw({ leaderName: "Private" }))).toBeNull();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); error.mockRestore(); log.mockRestore(); }
  });
});
