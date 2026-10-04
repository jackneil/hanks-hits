import { describe, expect, it, vi } from "vitest";
import { PROGRESS_OWNER_KEY } from "../../storage-keys";
import { LegacyWordMigration, type MigrationDatabase, type SourceLocks } from "../migration";
import type { SourceRecord } from "../database";

const key = "oregon-trail-storage";
const raw = JSON.stringify({ state: { leaderName: "Traveler", party: [{ name: "Friend", health: 100 }], coins: 7, lastModified: 50 }, version: 0 });
const locks: SourceLocks = { request: async (_name, work) => work() };

function fixture(owner: string | null = "account-a") {
  const map = new Map<string, string>([[key, raw]]);
  if (owner !== null) map.set(PROGRESS_OWNER_KEY, owner);
  const sources: SourceRecord[] = [];
  const storage = {
    getItem: (name: string) => map.get(name) ?? null,
    setItem: (name: string, value: string) => { map.set(name, value); },
    removeItem: (name: string) => { map.delete(name); },
  };
  const database: MigrationDatabase = {
    ownerEpoch: async () => 0,
    capture: vi.fn(async (source) => { sources.push(source); }),
  };
  return { map, sources, storage, database };
}

describe("legacy word capture coordinator", () => {
  it("writes the first replacement under the source lock without inventing a legacy source", async () => {
    const f = fixture();
    f.map.delete(key);
    let locked = false;
    const firstWriteLocks: SourceLocks = { request: async (_name, work) => {
      locked = true;
      try { return await work(); } finally { locked = false; }
    } };
    const write = f.storage.setItem;
    f.storage.setItem = (name, value) => { expect(locked).toBe(true); write(name, value); };
    expect(await new LegacyWordMigration(f.storage, f.database, firstWriteLocks).replace("oregon-trail", raw)).toBe("preserved");
    expect(f.map.get(key)).toBe(raw);
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("leaves an absent source absent during capture or removal", async () => {
    const f = fixture();
    f.map.delete(key);
    const coordinator = new LegacyWordMigration(f.storage, f.database, locks);
    expect(await coordinator.capture("oregon-trail")).toBe("empty");
    expect(await coordinator.replace("oregon-trail", null)).toBe("empty");
    expect(f.map.has(key)).toBe(false);
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("captures original bytes and owner before allowing removal", async () => {
    const f = fixture();
    const capture = f.database.capture;
    f.database.capture = async (source, epoch) => {
      expect(f.map.get(key)).toBe(raw);
      await capture(source, epoch);
    };
    expect(await new LegacyWordMigration(f.storage, f.database, locks).replace("oregon-trail", null)).toBe("preserved");
    expect(f.map.has(key)).toBe(false);
    expect(f.sources[0]).toMatchObject({ raw, appId: "oregon-trail", sourceKey: key, sourceVersion: 1 });
    expect(f.sources[0].ownerKey).toMatch(/^u_[0-9a-f]{20}$/);
    expect(f.sources[0].fields.map((field) => field.value)).toContain("Traveler");
  });

  it("treats a missing original marker as guest and never claims it for a login", async () => {
    const f = fixture(null);
    const coordinator = new LegacyWordMigration(f.storage, f.database, locks);
    expect(await coordinator.capture("oregon-trail")).toBe("preserved");
    expect(f.sources[0].ownerKey).toBe("guest");
    f.map.set(PROGRESS_OWNER_KEY, "account-b");
    expect(await coordinator.replace("oregon-trail", null)).toBe("changed");
    expect(f.map.get(key)).toBe(raw);
  });

  it("keeps the last durable source when the capture transaction fails", async () => {
    const f = fixture();
    f.database.capture = async () => { throw new DOMException("Unavailable", "QuotaExceededError"); };
    expect(await new LegacyWordMigration(f.storage, f.database, locks).replace("oregon-trail", null)).toBe("unavailable");
    expect(f.map.get(key)).toBe(raw);
    expect(f.map.get(PROGRESS_OWNER_KEY)).toBe("account-a");
  });

  it("does not remove an intervening writer's changed bytes", async () => {
    const f = fixture();
    const changed = raw.replace("Traveler", "New name");
    f.database.capture = async (source) => { f.sources.push(source); f.map.set(key, changed); };
    expect(await new LegacyWordMigration(f.storage, f.database, locks).replace("oregon-trail", null)).toBe("changed");
    expect(f.map.get(key)).toBe(changed);
    expect(f.sources[0].raw).toBe(raw);
  });

  it("keeps bytes when the owner changes during capture", async () => {
    const f = fixture();
    f.database.capture = async () => { f.map.set(PROGRESS_OWNER_KEY, "account-b"); };
    expect(await new LegacyWordMigration(f.storage, f.database, locks).replace("oregon-trail", null)).toBe("changed");
    expect(f.map.get(key)).toBe(raw);
  });

  it("captures without Web Locks but never destructively migrates without them", async () => {
    const f = fixture();
    const coordinator = new LegacyWordMigration(f.storage, f.database, undefined);
    expect(await coordinator.capture("oregon-trail")).toBe("preserved");
    expect(await coordinator.replace("oregon-trail", null)).toBe("unavailable");
    expect(f.map.get(key)).toBe(raw);
  });

  it("preserves malformed or unknown envelopes", async () => {
    const f = fixture();
    f.map.set(key, "not JSON");
    expect(await new LegacyWordMigration(f.storage, f.database, locks).replace("oregon-trail", null)).toBe("unavailable");
    expect(f.map.get(key)).toBe("not JSON");
  });

  it("does not confuse unreadable ownership with guest ownership", async () => {
    const f = fixture();
    f.storage.getItem = () => { throw new Error("Storage denied"); };
    expect(await new LegacyWordMigration(f.storage, f.database, locks).capture("oregon-trail")).toBe("unavailable");
    expect(f.database.capture).not.toHaveBeenCalled();
  });

  it("captures all sources without needing to open any game", async () => {
    const f = fixture();
    f.map.set("weather-app-progress", JSON.stringify({ state: { savedLocations: [{ name: "Town" }], lastLocation: null }, version: 0 }));
    const result = await new LegacyWordMigration(f.storage, f.database, locks).captureAll();
    expect(result["oregon-trail"]).toBe("preserved");
    expect(result.weather).toBe("preserved");
    expect(f.sources.map((source) => source.appId)).toEqual(expect.arrayContaining(["oregon-trail", "weather"]));
    expect(f.map.get(key)).toBe(raw);
  });
});
