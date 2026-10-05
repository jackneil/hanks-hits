import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { useRetroArcadeStore } from "@/games/retro-arcade/lib/store";
import { ProgressSyncSession } from "../progressSyncSession";
import {
  cloneProgress, newProgressJournal, parseProgressJournal,
  type ProgressJournal, type ProgressSnapshot,
} from "../progressJournal";

const revision = (n: number) => n.toString(16).padStart(64, "0");
const snapshot = (data: AppProgressData | null, n = 1): ProgressSnapshot<AppProgressData> => ({ data, revision: data ? revision(n) : null });
let drawing: AppProgressData, retro: AppProgressData;
beforeAll(() => {
  drawing = cloneProgress(useDrawingStore.getState().getProgress());
  retro = cloneProgress(useRetroArcadeStore.getState().getProgress());
});
const setting = (data: AppProgressData, change: object) => ({ ...cloneProgress(data), settings: { ...(data.settings as object), ...change } });

function harness(appId: ValidAppId = "drawing-app", data = drawing, live = data, related = true, raw?: string) {
  let current = raw ?? JSON.stringify(newProgressJournal(appId, "owner", "writer", snapshot(data), live, related));
  const archives: string[] = [];
  let allowed = true, writable = true, nextId = 0;
  const persist = vi.fn((next: string, originals: readonly string[]) => {
    if (!writable) return false;
    archives.push(...originals);
    current = next;
    return true;
  });
  const session = new ProgressSyncSession<AppProgressData>(current, appId, "owner", {
    maySave: () => allowed, persist, requestId: () => `request-${++nextId}`,
  });
  return { session, persist, archives, raw: () => current,
    allow: (value: boolean) => { allowed = value; }, writable: (value: boolean) => { writable = value; } };
}
const state = (session: ProgressSyncSession<AppProgressData>) => session.snapshot()!;

describe("durable revision sessions", () => {
  it.each([false, true])("does not replay a lost-ACK initial creation after deletion (cold recovery=%s)", cold => {
    const row = newProgressJournal("drawing-app", "owner", "writer", { data: null, revision: null }, drawing, true);
    const h = harness("drawing-app", drawing, drawing, true, JSON.stringify(row));
    const request = h.session.prepare(drawing)!;
    expect(request.base).toEqual({ data: null, revision: null });
    // The first create committed, its response was lost, and another device
    // deleted the row. Absence now equals the old base, but is not the old state.
    h.session.uncertain(request.id);
    const sessions = cold ? [0, 1].map(index => harness("drawing-app", drawing, drawing, true,
      JSON.stringify({ ...JSON.parse(h.raw()), writerId: `recovery-${index}` })).session) : [h.session];
    for (const session of sessions) {
      expect(session.observe({ data: null, revision: null })).toBe("conflict");
      expect(state(session).conflict?.reason).toBe("ambiguous-delivery");
      expect(session.prepare(drawing)).toBeNull();
      expect(state(session).sent).toEqual(request);
      expect(session.choose({ data: null, revision: null }, "local")).toBe(true);
      expect(session.prepare(drawing)?.base).toEqual({ data: null, revision: null });
    }
  });

  it("keeps a changed deletion revision as a conflict through response and cold recovery", () => {
    const row = newProgressJournal("drawing-app", "owner", "writer", { data: null, revision: null }, drawing, true);
    const h = harness("drawing-app", drawing, drawing, true, JSON.stringify(row));
    const sent = h.session.prepare(drawing)!;
    const fence = { data: null, revision: revision(2) };
    expect(h.session.receive(sent.id, fence, "rejected", drawing)).toBe("conflict");
    const cold = harness("drawing-app", drawing, drawing, true, h.raw()).session;
    expect(cold.snapshot()!.conflict!.remote).toEqual(fence);
    expect(cold.prepare(drawing)).toBeNull();
    expect(cold.choose(fence, { empty: drawing })).toBe(true);
    const restart = cold.prepare(drawing)!;
    expect(restart.base).toEqual(fence);
    expect(cold.receive(restart.id, { data: null, revision: revision(3) }, "rejected", drawing)).toBe("conflict");
  });

  it("persists the exact request before dispatch and never creates overlapping requests", () => {
    const h = harness(), live = setting(drawing, { showGrid: true });
    const request = h.session.prepare(live)!;
    expect(request.base).toEqual(snapshot(drawing));
    expect(JSON.parse(h.raw()).sent).toEqual(request);
    expect(h.session.prepare(setting(live, { soundEnabled: false }))).toBeNull();
    expect(state(h.session).sent).toEqual(request);
    expect(state(h.session).live.settings).toMatchObject({ soundEnabled: false });
    request.data.settings = {};
    expect(state(h.session).sent!.data.settings).toMatchObject({ showGrid: true });
  });
  it("merges a proven 409 without losing the other device's independent setting", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    const remote = setting(drawing, { soundEnabled: false });
    const request = h.session.prepare(local)!;
    expect(h.session.receive(request.id, snapshot(remote, 2), "rejected", local)).toBe("pending");
    const retry = h.session.prepare(state(h.session).live)!;
    expect(retry.base).toEqual(snapshot(remote, 2));
    expect(retry.data.settings).toMatchObject({ showGrid: true, soundEnabled: false });
    expect(h.session.receive(retry.id, snapshot(retry.data, 3), "accepted", retry.data)).toBe("saved");
    expect(state(h.session).sent).toBeNull();
  });
  it("keeps edits made during a successful request pending on the acknowledged revision", () => {
    const h = harness(), first = setting(drawing, { showGrid: true });
    const request = h.session.prepare(first)!;
    const later = setting(first, { soundEnabled: false });
    expect(h.session.receive(request.id, snapshot(first, 2), "accepted", later)).toBe("pending");
    expect(state(h.session).live).toEqual(later);
    expect(h.session.prepare(later)!.base.revision).toBe(revision(2));
  });
  it("archives the exact original bytes before ACK removes sent data", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    const request = h.session.prepare(local)!;
    const original = h.raw();
    h.session.receive(request.id, snapshot(local, 2), "accepted", local);
    expect(h.archives).toContain(original);
    expect(JSON.parse(original).sent.data).toEqual(local);
  });
  it("does not claim saved if archiving or journal persistence fails after the ACK", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    const request = h.session.prepare(local)!;
    const original = h.raw();
    h.writable(false);
    expect(h.session.receive(request.id, snapshot(local, 2), "accepted", local)).toBe("blocked");
    expect(h.raw()).toBe(original);
    expect(state(h.session).sent).toEqual(request);
    h.writable(true);
    expect(h.session.observe(snapshot(local, 2))).toBe("saved");
  });
  it.each([false, "throw"])("does not dispatch on storage failure (%s), while retaining later edits in memory", failure => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    h.persist.mockImplementation(() => { if (failure === "throw") throw new Error("quota"); return false; });
    expect(h.session.prepare(local)).toBeNull();
    expect(h.session.storageAvailable).toBe(false);
    expect(state(h.session).live).toEqual(local);
    expect(JSON.parse(h.raw()).live).toEqual(drawing);
  });
  it("retries an uncertain request only after a GET proves its base revision unchanged", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    const request = h.session.prepare(local)!;
    h.session.uncertain(request.id);
    expect(h.session.prepare(local)).toBeNull();
    expect(h.session.observe(snapshot(drawing))).toBe("pending");
    expect(h.session.prepare(local)).toEqual(request);
  });
  it("cold-recovers an exact committed request without sending it again", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    h.session.prepare(local);
    const cold = harness("drawing-app", drawing, drawing, true, h.raw());
    expect(cold.session.observe(snapshot(local, 2))).toBe("saved");
    expect(cold.session.prepare(local)).toBeNull();
  });
  it("never resurrects an addition accepted without ACK and then deleted, even in two recovery tabs", () => {
    const base = { ...retro, favorites: [] }, local = { ...base, favorites: ["X"] };
    const h = harness("retro-arcade", base);
    h.session.prepare(local); // Server accepts X at rev 2, then B removes X at rev 3.
    for (let tab = 0; tab < 2; tab++) {
      const cold = harness("retro-arcade", base, base, true, h.raw());
      expect(cold.session.observe(snapshot(base, 3))).toBe("conflict");
      expect(state(cold.session).conflict!.reason).toBe("ambiguous-delivery");
      expect(cold.session.prepare(local)).toBeNull();
      expect(state(cold.session).sent!.data.favorites).toEqual(["X"]);
    }
  });
  it("treats a subsequent 409 after uncertain delivery as ambiguous, not as proof of first-attempt rejection", () => {
    const base = { ...retro, favorites: [] }, local = { ...base, favorites: ["X"] };
    const h = harness("retro-arcade", base), request = h.session.prepare(local)!;
    h.session.uncertain(request.id);
    expect(h.session.receive(request.id, snapshot(base, 3), "rejected", local)).toBe("conflict");
    expect(state(h.session).conflict!.reason).toBe("ambiguous-delivery");
  });
  it("can merge durably pending but never dispatched edits against a newer cloud row", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    h.session.capture(local);
    const cold = harness("drawing-app", drawing, drawing, true, h.raw());
    expect(cold.session.observe(snapshot(setting(drawing, { soundEnabled: false }), 2))).toBe("pending");
    expect(state(cold.session).live.settings).toMatchObject({ showGrid: true, soundEnabled: false });
  });
  it("does not invent a common ancestor for unrelated imported progress", () => {
    const local = setting(drawing, { showGrid: true });
    const h = harness("drawing-app", drawing, local, false);
    expect(h.session.prepare(local)).toBeNull();
    expect(h.session.observe(snapshot(drawing, 2))).toBe("conflict");
    expect(state(h.session).conflict!.reason).toBe("unknown-lineage");
  });
  it("requires a choice for overlapping settings and preserves both original copies", () => {
    const base = setting(drawing, { defaultSize: 5 });
    const h = harness("drawing-app", base), local = setting(base, { defaultSize: 10 });
    const remote = snapshot(setting(base, { defaultSize: 20 }), 2);
    const request = h.session.prepare(local)!;
    expect(h.session.receive(request.id, remote, "rejected", local)).toBe("conflict");
    const conflicted = h.raw();
    expect(h.session.choose(snapshot(remote.data, 3), "local")).toBe(false);
    expect(h.session.choose(remote, "server")).toBe(true);
    expect(h.archives).toContain(conflicted);
    const chosen = h.session.prepare(remote.data!)!;
    expect(chosen.data).toEqual(remote.data);
    expect(chosen.base).toEqual(remote);
    // Even choosing the unchanged server copy sends a CAS, fencing an old request.
    expect(state(h.session).forceWrite).toBe(true);
  });
  it("does not retire an explicit choice just because GET content already equals it", () => {
    const local = setting(drawing, { showGrid: true });
    const h = harness("drawing-app", drawing, local, false);
    h.session.choose(snapshot(drawing), "server");
    h.session.prepare(drawing);
    const cold = harness("drawing-app", drawing, drawing, true, h.raw());
    expect(cold.session.observe(snapshot(drawing))).toBe("pending");
    expect(cold.session.prepare(drawing)).not.toBeNull();
  });
  it("ignores a stale response once a choice has replaced its request", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    const request = h.session.prepare(local)!;
    h.session.uncertain(request.id);
    const remote = snapshot(setting(drawing, { soundEnabled: false }), 2);
    h.session.observe(remote);
    h.session.choose(remote, "local");
    const next = h.session.prepare(local)!;
    expect(h.session.receive(request.id, snapshot(local, 3), "accepted", local)).toBe("ignored");
    expect(state(h.session).sent!.id).toBe(next.id);
  });
  it("keeps a retry ambiguous when its delayed predecessor commits and is deleted after recovery GET", () => {
    const base = { ...retro, favorites: [] }, local = { ...base, favorites: ["X"] };
    const h = harness("retro-arcade", base), original = h.session.prepare(local)!;
    h.session.uncertain(original.id);
    expect(h.session.observe(snapshot(base))).toBe("pending");
    const replay = h.session.prepare(local)!;
    // The old request now commits X, B deletes X, and only then replay gets 409.
    expect(h.session.receive(replay.id, snapshot(base, 3), "rejected", local)).toBe("conflict");
    expect(state(h.session).conflict!.reason).toBe("ambiguous-delivery");
    expect(h.session.prepare(local)).toBeNull();
  });
  it("preserves a pending drawing source before a later capture replaces it", () => {
    const art = { id: "X", name: "X", thumbnail: "thumb", dataUrl: "drawing", createdAt: "2026-01-01T00:00:00Z", editedAt: "2026-01-01T00:00:00Z" };
    const h = harness(), local = { ...drawing, savedArtworks: [art] };
    h.session.capture(local);
    const original = h.raw();
    h.session.capture(drawing);
    expect(h.archives).toContain(original);
  });
  it("preserves a newer memory-only edit before choosing the server after quota recovery", () => {
    const h = harness("drawing-app", drawing, setting(drawing, { showGrid: true }), false);
    h.writable(false);
    const newer = setting(drawing, { showGrid: true, defaultColor: "#123456" });
    expect(h.session.capture(newer)).toBe(false);
    h.writable(true);
    expect(h.session.choose(snapshot(drawing), "server")).toBe(true);
    expect(h.archives.some(raw => JSON.stringify(JSON.parse(raw).live) === JSON.stringify(newer))).toBe(true);
  });
  it("can explicitly start fresh after cloud deletion and fences delayed recreation", () => {
    const local = setting(drawing, { showGrid: true });
    const h = harness("drawing-app", local);
    expect(h.session.observe(snapshot(null))).toBe("conflict");
    const original = h.raw();
    expect(h.session.choose(snapshot(null), { empty: drawing })).toBe(true);
    expect(h.archives).toContain(original);
    const request = h.session.prepare(drawing)!;
    expect(request.base).toEqual(snapshot(null));
    expect(request.data).toEqual(drawing);
    // If an old request recreates the row first, clearing still needs a choice.
    expect(h.session.receive(request.id, snapshot(local, 3), "rejected", drawing)).toBe("conflict");
  });
  it("preserves all memory-only sources across repeated quota failures before a choice", () => {
    const h = harness("drawing-app", drawing, setting(drawing, { showGrid: true }), false);
    h.writable(false);
    const first = setting(drawing, { defaultColor: "#123456" });
    const second = setting(drawing, { defaultColor: "#654321" });
    h.session.capture(first);
    h.session.capture(second);
    h.writable(true);
    expect(h.session.choose(snapshot(drawing), "server")).toBe(true);
    const archived = h.archives.map(raw => JSON.parse(raw).live);
    expect(archived).toContainEqual(first);
    expect(archived).toContainEqual(second);
    const serials = h.archives.map(raw => JSON.parse(raw).serial);
    expect(new Set(serials).size).toBe(serials.length);
  });
  it("preserves the original serialized bytes without normalizing their formatting", () => {
    const row = newProgressJournal("drawing-app", "owner", "writer", snapshot(drawing), drawing, true);
    const raw = JSON.stringify(row, null, 2);
    const h = harness("drawing-app", drawing, drawing, true, raw);
    h.session.capture(setting(drawing, { showGrid: true }));
    expect(h.archives).toContain(raw);
  });
  it("does not reuse replay permission after a delayed ACK retires the uncertain request", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    const first = h.session.prepare(local)!;
    h.session.uncertain(first.id);
    h.session.observe(snapshot(drawing));
    expect(h.session.receive(first.id, snapshot(local, 2), "accepted", local)).toBe("saved");
    const later = setting(local, { soundEnabled: false });
    expect(h.session.prepare(later)).not.toBeNull();
    expect(h.session.prepare(later)).toBeNull();
  });
  it("retries the exact failed capture bytes so an asynchronous durable receipt can satisfy it", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    h.writable(false);
    expect(h.session.capture(local)).toBe(false);
    const first = h.persist.mock.calls.at(-1)!;
    h.writable(true);
    expect(h.session.capture(local)).toBe(true);
    expect(h.persist.mock.calls.at(-1)).toEqual(first);
  });
  it("keeps a failed prepared request's identity stable until exact persistence succeeds", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    h.session.capture(local);
    h.writable(false);
    expect(h.session.prepare(local)).toBeNull();
    const first = h.persist.mock.calls.at(-1)!;
    h.writable(true);
    const sent = h.session.prepare(local)!;
    expect(JSON.parse(first[0]).sent).toEqual(sent);
    expect(h.persist.mock.calls.at(-1)).toEqual(first);
  });
  it("keeps later live edits separate from a prepared request whose persistence was delayed", () => {
    const h = harness(), first = setting(drawing, { showGrid: true });
    h.session.capture(first);
    h.writable(false);
    expect(h.session.prepare(first)).toBeNull();
    const proposed = JSON.parse(h.persist.mock.calls.at(-1)![0]).sent;
    const later = setting(first, { soundEnabled: false });
    h.session.capture(later);
    h.writable(true);
    const sent = h.session.prepare(later)!;
    expect(sent).toEqual(proposed);
    expect(h.session.receive(sent.id, snapshot(first, 2), "accepted", later)).toBe("pending");
    const next = h.session.prepare(state(h.session).live)!;
    expect(next.data).toEqual(later);
    expect(next.base).toEqual(snapshot(first, 2));
  });
  it("blocks reads, dispatch, choices and responses after mounted owner revocation", () => {
    const h = harness(), local = setting(drawing, { showGrid: true });
    const request = h.session.prepare(local)!;
    h.persist.mockClear(); h.allow(false);
    expect(h.session.snapshot()).toBeNull();
    expect(h.session.capture(local)).toBe(false);
    expect(h.session.prepare(local)).toBeNull();
    expect(h.session.receive(request.id, snapshot(local, 2), "accepted", local)).toBe("ignored");
    expect(h.session.observe(snapshot(local, 2))).toBe("ignored");
    expect(h.session.choose(snapshot(local, 2), "local")).toBe(false);
    expect(h.persist).not.toHaveBeenCalled();
  });
  it("rechecks ownership after persistence before returning a dispatchable request", () => {
    const local = setting(drawing, { showGrid: true });
    const h = harness("drawing-app", drawing, local);
    h.persist.mockImplementation(() => { h.allow(false); return true; });
    expect(h.session.prepare(local)).toBeNull();
  });
});

describe("journal validation", () => {
  it.each([
    { ownerId: "other" }, { appId: "snake" }, { version: 2 }, { writerId: "../other" },
    { serial: -1 }, { serial: 1.5 }, { forceWrite: "true" }, { sent: {} },
    { acknowledged: { data: null, revision: "invalid" } },
    { conflict: { remote: snapshot(null), reason: "invented", paths: [] } },
  ])("refuses malformed or foreign records %j", patch => {
    const row = newProgressJournal("drawing-app", "owner", "writer", snapshot(drawing), drawing, true);
    expect(parseProgressJournal(JSON.stringify({ ...row, ...patch }), "drawing-app", "owner")).toBeNull();
  });
  it("retains unknown schema fields by refusing to use, rather than rewriting, their original bytes", () => {
    const row = newProgressJournal("drawing-app", "owner", "writer", snapshot(drawing), drawing, true);
    const raw = JSON.stringify({ ...row, live: { ...drawing, futureContent: "retain this" } });
    expect(parseProgressJournal(raw, "drawing-app", "owner")).toBeNull();
  });
  it("requires the in-flight base to match the acknowledged row", () => {
    const row: ProgressJournal<AppProgressData> = newProgressJournal("drawing-app", "owner", "writer", snapshot(drawing), drawing, true);
    row.sent = { id: "r", base: snapshot(drawing, 2), data: drawing };
    expect(parseProgressJournal(JSON.stringify(row), "drawing-app", "owner")).toBeNull();
  });
});
