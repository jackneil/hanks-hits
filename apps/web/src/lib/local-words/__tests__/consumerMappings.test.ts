import { describe, expect, it, vi } from "vitest";
import type { SourceRecord } from "../database";
import type { WordField } from "@/lib/progress-words";
import { mapLocalWordCandidate as oregon, previewUnmatchedCandidate, createJourneyId } from "@/games/oregon-trail/lib/localWords";
import { mapLocalWordCandidate as weather } from "@/apps/weather/lib/localWords";
import { mapLocalWordCandidate as drawing } from "@/apps/drawing-app/lib/localWords";
import { mapLocalWordCandidate as pet } from "@/apps/virtual-pet/lib/localWords";
import { mapLocalWordCandidate as toy } from "@/apps/toy-finder/lib/localWords";
import { mapLocalWordCandidate as drums } from "@/apps/drum-machine/lib/localWords";
import { mapLocalWordCandidate as atv } from "@/games/four-wheeler-3d/lib/localWords";
import { wordRecoveryActions } from "@/shared/lib/localWordRecovery";
const source = (appId: string, fields: WordField[]): SourceRecord => ({ id: "candidate", ownerKey: "guest", appId, sourceKey: "old", sourceVersion: 1, digest: "digest", raw: "exact bytes", fields });

describe("typed legacy word identity mapping", () => {
  it("never guesses a journey from repeating m0 IDs; explicit preview is distinct from an automatic mapping", () => {
    const legacy = source("oregon-trail", [{ path: "party[0].name", value: "Name", identity: { id: "m0" } }]);
    expect(oregon(legacy)).toBeNull();
    expect(previewUnmatchedCandidate(legacy)).toHaveLength(1);
    const mapped = oregon(source("oregon-trail", [{ ...legacy.fields[0], identity: { id: "m0", journeyId: 'journey","other' } }]));
    expect(JSON.parse(mapped![0].entityKey)).toEqual(["journey", 'journey","other', "member", "m0"]);
  });

  it("preserves conflicting pet aliases as separate explicit choices", () => {
    const identity = { speciesId: "blobby", bornAt: "2026-10-04T00:00:00Z" };
    const legacy = source("virtual-pet", [
      { path: "pet.name", value: "Pet name", identity },
      { path: "settings.petName", value: "Other name", identity },
    ]);
    expect(pet(legacy)).toBeNull();
    const choices = wordRecoveryActions("virtual-pet")!.candidateChoices!(legacy);
    expect(choices.map(choice => choice.edits[0].value)).toEqual(["Pet name", "Other name"]);
    expect(pet(source("virtual-pet", [{ path: "pet.name", value: "Name", identity: {} }]))).toBeNull();
  });

  it("accepts full locations and images only with validated typed shapes", () => {
    expect(weather(source("weather", [{ path: "savedLocations", value: [{ name: "Home", latitude: "bad", longitude: 4 }], identity: {} }]))).toBeNull();
    expect(weather(source("weather", [{ path: "lastLocation", value: { name: "Place", latitude: 1, longitude: 2, country: "US", admin1: "State" }, identity: {} }]))?.[0].field).toBe("lastLocation");
    expect(drawing(source("drawing-app", [{ path: "savedArtworks", value: [{ id: "a", name: "Art" }], identity: {} }]))).toBeNull();
    const art = { id: "art", name: "Name", dataUrl: "data:image/png;base64,full", thumbnail: "data:image/png;base64,thumb", createdAt: "a", editedAt: "b" };
    expect(drawing(source("drawing-app", [{ path: "savedArtworks", value: [art], identity: {} }]))?.[0].value).toEqual(art);
  });

  it("maps only known fields with stable per-entity IDs", () => {
    expect(toy(source("toy-finder", [{ path: "wishlistItems[0].notes", value: "note", identity: { toyId: "toy" } }]))?.[0].entityKey).toBe(JSON.stringify(["toy", "toy"]));
    expect(drums(source("drum-machine", [{ path: "savedBeats[0].name", value: "beat", identity: {} }]))).toBeNull();
    expect(atv(source("four-wheeler-3d", [{ path: "adventure.feeders[0].label", value: "label", identity: { id: "feeder" } }]))?.[0].entityKey).toBe(JSON.stringify(["feeder", "feeder"]));
  });

  it("creates unique cryptographic journey IDs without randomUUID", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const first = createJourneyId(), second = createJourneyId();
      expect(first).toMatch(/^[0-9a-f]{32}$/);
      expect(second).not.toBe(first);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
      vi.restoreAllMocks();
    }
  });
});
