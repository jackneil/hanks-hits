import { describe, expect, it } from "vitest";
import { useCookieClickerStore } from "../lib/store";
import { BakerySyncSession, isBakerySnapshot, bakeryJournalKey, parseBakeryJournal, type BakeryJournal, type BakerySnapshot } from "../lib/sync-session";
import { isClearedOnSignOut } from "@/lib/storage-keys";

const revision = (n: number) => n.toString(16).padStart(64, "0");
const bakery = (cookies = 1000) => ({ ...useCookieClickerStore.getState().getProgress(), cookies,
  totalCookiesBaked: 5000, lastModified: 100, lastTick: 100 });
const cloud = (cookies = 1000, n = 1): BakerySnapshot => ({ data: bakery(cookies), revision: revision(n) });

function setup(writerId = "writer-a", restored?: BakeryJournal) {
  const disk = new Map<string, string>();
  const owner = { valid: true, blockedStorage: false };
  let sequence = 0;
  const session = new BakerySyncSession(restored ?? {
    version: 1, ownerId: "owner-a", writerId, acknowledged: cloud(), sent: null,
    live: bakery(), conflict: null, resolving: false, choiceBackup: null,
  }, {
    maySave: () => owner.valid,
    requestId: () => `${writerId}-${++sequence}`,
    persist: (key, value) => {
      if (owner.blockedStorage) throw new Error("storage blocked");
      disk.set(key, value);
    },
  });
  return { session, disk, owner };
}

describe("Cookie save session", () => {
  it("retains a deletion fence through cold recovery and requires a choice to recreate", () => {
    const initial: BakeryJournal = { ...setup().session.snapshot(), acknowledged: { data: null, revision: null } };
    const first = setup("writer-a", initial);
    const request = first.session.prepare(bakery())!;
    const fence: BakerySnapshot = { data: null, revision: revision(2) };
    expect(isBakerySnapshot(fence)).toBe(true);
    expect(first.session.receive(request, fence, false, bakery())).toBe("conflict");
    expect(first.session.prepare(bakery())).toBeNull();
    const restored = parseBakeryJournal(first.disk.get(bakeryJournalKey("writer-a"))!, "owner-a")!;
    expect(restored.conflict).toEqual(fence);
    const cold = setup("writer-a", restored).session;
    expect(cold.prepare(bakery())).toBeNull();
    expect(cold.choose({ data: null, revision: revision(3) }, bakery())).toBe(false);
    expect(cold.choose(fence, bakery())).toBe(true);
    const restart = cold.prepare(bakery())!;
    expect(restart.base).toEqual(fence);
    expect(cold.receive(restart, { data: null, revision: revision(3) }, false, bakery())).toBe("conflict");
  });

  it.each([undefined, "bad", "", 42])("rejects malformed deletion revision %s", revision => {
    expect(isBakerySnapshot({ data: null, revision })).toBe(false);
  });

  it("persists an immutable request and preserves purchases made while it is in flight", () => {
    const { session, disk } = setup();
    const sent = session.prepare(bakery(1100))!;
    expect(parseBakeryJournal(disk.get(bakeryJournalKey("writer-a"))!, "owner-a")!.sent).toEqual(sent);
    sent.data.cookies = 7; // callers cannot mutate the journal
    const retry = session.prepare(bakery(500))!;
    expect(retry.data.cookies).toBe(1100);
    expect(session.receive(retry, cloud(1100, 2), true, bakery(500))).toBe("saved");
    expect(session.snapshot().live.cookies).toBe(500);
    expect(session.snapshot().acknowledged.data!.cookies).toBe(1100);
    expect(session.prepare(bakery(500))!.base.revision).toBe(revision(2));
  });

  it("recovers a committed request after response loss and reload without replaying later earnings", () => {
    const first = setup();
    const sent = first.session.prepare(bakery(1100))!;
    first.session.capture(bakery(1200));
    const recovered = parseBakeryJournal(first.disk.get(bakeryJournalKey("writer-a"))!, "owner-a")!;
    const second = setup("writer-a", recovered).session;
    expect(second.prepare(bakery(1200))).toEqual(sent);
    expect(second.receive(sent, cloud(1100, 2), false, bakery(1200))).toBe("saved");
    expect(second.prepare(bakery(1200))!.data.cookies).toBe(1200);
    expect(second.snapshot().live.lastModified).toBe(100);
  });

  it("rebases an unchanged canonical row without replacing the pending snapshot with later play", () => {
    const { session } = setup();
    const sent = session.prepare(bakery(1100))!;
    expect(session.receive(sent, cloud(1000, 2), false, bakery(1200))).toBe("retry");
    const next = session.prepare(bakery(1200))!;
    expect(next.data.cookies).toBe(1100);
    expect(next.base.revision).toBe(revision(2));
    expect(next.id).not.toBe(sent.id);
  });

  it("retains a real wallet conflict and sends nothing until the player chooses", () => {
    const { session } = setup();
    const sent = session.prepare(bakery(1100))!;
    expect(session.receive(sent, cloud(200, 2), false, bakery(1200))).toBe("conflict");
    expect(session.prepare(bakery(1300))).toBeNull();
    expect(session.snapshot().live.cookies).toBe(1300);
    expect(session.snapshot().conflict!.data!.cookies).toBe(200);
    expect(session.choose(cloud(200, 3), bakery(1300))).toBe(false);
    expect(session.choose(cloud(200, 2), bakery(1300))).toBe(true);
    const choice = session.prepare(bakery(1300))!;
    expect(choice.base.revision).toBe(revision(2));
    expect(session.snapshot().choiceBackup!.live.cookies).toBe(1300);
    expect(session.receive(choice, cloud(100, 3), false, bakery(1300))).toBe("conflict");
    expect(session.prepare(bakery(1400))).toBeNull();
  });

  it("requires an acknowledgement even when choosing the saved bakery unchanged", () => {
    const { session } = setup();
    const sent = session.prepare(bakery(1100))!;
    session.receive(sent, cloud(200, 2), false, bakery(1200));
    session.choose(cloud(200, 2), bakery(200));
    const choice = session.prepare(bakery(200))!;
    expect(choice).not.toBeNull();
    expect(session.snapshot().choiceBackup!.live.cookies).toBe(1200);
    session.receive(choice, cloud(200, 3), true, bakery(200));
    expect(session.snapshot().choiceBackup).toBeNull();
    expect(session.snapshot().conflict).toBeNull();
  });

  it("combines records from every recovery alternative but takes only the selected wallet", () => {
    const { session } = setup();
    const sent = session.prepare(bakery(1100))!;
    session.receive(sent, cloud(200, 2), false, bakery(1200));
    const a = bakery(50), b = bakery(9000);
    a.buildings = { ...a.buildings, cursor: 50 };
    b.buildings = { ...b.buildings, grandma: 100 };
    b.totalCookiesBaked = 10000;
    session.choose(cloud(200, 2), a, [a, b]);
    expect(session.snapshot().live).toMatchObject({ cookies: 50, totalCookiesBaked: 10000,
      buildings: { cursor: 50, grandma: 100 } });
  });

  it("ignores late acknowledgements and cannot recreate storage after an account change", () => {
    const { session, disk, owner } = setup();
    const request = session.prepare(bakery(1100))!;
    disk.clear();
    owner.valid = false;
    expect(session.receive(request, cloud(1100, 2), true, bakery(1200))).toBe("ignored");
    expect(session.prepare(bakery(1200))).toBeNull();
    session.capture(bakery(1300));
    expect(disk.size).toBe(0);
  });

  it("keeps memory when storage fails, and reports recovery when persistence succeeds again", () => {
    const { session, owner } = setup();
    owner.blockedStorage = true;
    expect(session.prepare(bakery(1100))!.data.cookies).toBe(1100);
    expect(session.storageAvailable).toBe(false);
    owner.blockedStorage = false;
    session.capture(bakery(1200));
    expect(session.storageAvailable).toBe(true);
  });

  it("isolates writers and rejects foreign or corrupt recovery records", () => {
    const a = setup("writer-a"), b = setup("writer-b");
    a.session.prepare(bakery(1100));
    b.session.prepare(bakery(1200));
    const [key, raw] = [...a.disk][0];
    expect(key).not.toBe([...b.disk.keys()][0]);
    expect(isClearedOnSignOut(key)).toBe(true);
    expect(parseBakeryJournal(raw, "owner-b")).toBeNull();
    expect(parseBakeryJournal("{", "owner-a")).toBeNull();
    expect(parseBakeryJournal(JSON.stringify({ ...a.session.snapshot(), live: { cookies: -1 } }), "owner-a")).toBeNull();
  });
});
