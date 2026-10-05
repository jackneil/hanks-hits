import { beforeAll, describe, expect, it } from "vitest";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { ownerKeyFor } from "@/shared/clips/library/ownerKey";
import { cloneProgress, newProgressJournal } from "../progressJournal";
import { nextJournalEnvelope, readJournalEnvelope } from "../progressJournalEnvelope";
import { adoptJournalCopy, emptyJournalRecovery, isJournalRecovery, journalSourceId, resolvedJournalSources, type JournalCopy } from "../progressJournalRecovery";
import { ProgressSyncSession } from "../progressSyncSession";

const appId = "drawing-app" as const, ownerId = "owner";
const revision = (n: number) => n.toString(16).padStart(64, "0");
const defaults = () => cloneProgress(useDrawingStore.getState().getProgress());
const art = { id: "addition", name: "Only drawing", dataUrl: "image", thumbnail: "small", createdAt: "2026-01-01T00:00:00Z", editedAt: "2026-01-01T00:00:00Z" };
let ownerKey: string;
beforeAll(async () => { ownerKey = await ownerKeyFor(ownerId); });
function source(pending = true): JournalCopy {
  const base = defaults(), live = pending ? { ...base, savedArtworks: [art] } : base;
  const journal = newProgressJournal(appId, ownerId, "original", { data: base, revision: revision(1) }, live, true);
  const raw = JSON.stringify(journal, null, 2);
  return { writerId: "original", sourceId: journalSourceId(ownerKey, appId, "original", raw),
    envelope: nextJournalEnvelope(null, raw, [], { appId, ownerId, writerId: "original" }) };
}
const adopt = (copy: JournalCopy, writerId = "recovered") => adoptJournalCopy(copy, { appId, ownerId, ownerKey, writerId });
function session(copy: JournalCopy, writerId: string) {
  const adopted = adopt(copy, writerId);
  let raw = JSON.stringify(adopted.journal);
  const state = new ProgressSyncSession(raw, appId, ownerId,
    { maySave: () => true, persist: next => { raw = next; return true; }, requestId: () => `fresh-${writerId}` });
  return { state, adopted, raw: () => raw };
}

describe("exact-source journal recovery", () => {
  it("treats an unsent source as uncertain when its original writer could dispatch later", () => {
    const copy = source(), { state, adopted } = session(copy, "recovered");
    expect(adopted.journal.sent).not.toBeNull();
    expect(adopted.journal.sent!.data).toEqual(adopted.journal.live);
    expect(state.prepare(adopted.journal.live)).toBeNull();
    expect(state.observe(adopted.journal.acknowledged)).toBe("pending");
    expect(state.prepare(adopted.journal.live)).toEqual(adopted.journal.sent);
    expect(adopted.originals).toContainEqual({ raw: copy.envelope.current, choice: false });
    expect(adopted.recovery.adoptedSources).toEqual([copy.sourceId]);
  });

  it("does not resurrect an addition after commit, lost ACK, remote deletion, and two cold recoveries", () => {
    const copyBeforeSend = source();
    // The original writer sends AFTER the source was copied, commits, loses its
    // ACK, and another device removes the artwork on revision 3.
    for (const writer of ["recovery-a", "recovery-b"]) {
      const { state, adopted } = session(copyBeforeSend, writer);
      expect(state.observe({ data: defaults(), revision: revision(3) })).toBe("conflict");
      expect(state.snapshot()!.conflict?.reason).toBe("ambiguous-delivery");
      expect(state.prepare(adopted.journal.live)).toBeNull();
      expect(state.snapshot()!.live.savedArtworks).toEqual([art]);
    }
  });

  it("does not turn a rejected replay into a fresh operation after observing the unchanged base", () => {
    const { state, adopted } = session(source(), "recovered");
    state.observe(adopted.journal.acknowledged);
    const request = state.prepare(adopted.journal.live)!;
    expect(state.receive(request.id, { data: defaults(), revision: revision(3) }, "rejected", adopted.journal.live)).toBe("conflict");
    expect(state.snapshot()!.conflict?.reason).toBe("ambiguous-delivery");
  });

  it("preserves an existing sent operation, later edits, inherited provenance and choice pins", () => {
    const copy = source(), original = JSON.parse(copy.envelope.current);
    original.sent = { id: "original-request", base: cloneProgress(original.acknowledged), data: cloneProgress(original.live) };
    original.live.stats.totalDrawTime++;
    copy.envelope.current = JSON.stringify(original);
    copy.sourceId = journalSourceId(ownerKey, appId, copy.writerId, copy.envelope.current);
    const ancestor = source(false).sourceId;
    copy.envelope.recovery = { version: 1, adoptedSources: [ancestor], resolutions: [] };
    const pinned = JSON.stringify(newProgressJournal(appId, ownerId, "old-choice", original.acknowledged, original.live, true));
    copy.envelope.originals = [{ raw: pinned, choice: true }];
    const result = adopt(copy);
    expect(result.journal.sent).toEqual(original.sent);
    expect(result.journal.live).toEqual(original.live);
    expect(result.recovery.adoptedSources).toEqual([copy.sourceId, ancestor]);
    expect(result.originals).toContainEqual({ raw: pinned, choice: true });
    result.journal.sent!.data.savedArtworks = [];
    expect(JSON.parse(copy.envelope.current).sent.data.savedArtworks).toEqual([art]);
  });

  it("does not invent a replay for an already clean acknowledged source", () => {
    expect(adopt(source(false)).journal.sent).toBeNull();
  });

  it("keeps an unacknowledged explicit choice uncertain even when its content equals its base", () => {
    const copy = source(false), row = JSON.parse(copy.envelope.current); row.forceWrite = true;
    copy.envelope.current = JSON.stringify(row);
    copy.sourceId = journalSourceId(ownerKey, appId, copy.writerId, copy.envelope.current);
    const { state, adopted } = session(copy, "recovered");
    expect(adopted.journal.sent).not.toBeNull();
    expect(state.observe({ data: defaults(), revision: revision(2) })).toBe("conflict");
  });

  it("binds receipts to exact source bytes rather than every version of a writer", () => {
    const old = source(), newer = source();
    const row = JSON.parse(newer.envelope.current); row.serial++; row.live.stats.totalDrawTime++;
    newer.envelope.current = JSON.stringify(row);
    newer.sourceId = journalSourceId(ownerKey, appId, newer.writerId, newer.envelope.current);
    const receiptCarrier = source(false);
    receiptCarrier.envelope.recovery = { version: 1, adoptedSources: [], resolutions: [{ sourceId: old.sourceId, revision: revision(4) }] };
    const resolved = resolvedJournalSources([old, newer, receiptCarrier], appId, ownerKey)!;
    expect(resolved.has(old.sourceId)).toBe(true); expect(resolved.has(newer.sourceId)).toBe(false);
    const compacted = nextJournalEnvelope(receiptCarrier.envelope, receiptCarrier.envelope.current, [], { appId, ownerId, writerId: receiptCarrier.writerId });
    expect(compacted.recovery).toEqual(receiptCarrier.envelope.recovery);
    expect(journalSourceId(ownerKey, appId, receiptCarrier.writerId, compacted.current)).toBe(receiptCarrier.sourceId);
  });

  it("reads old envelopes without metadata and writes the new version without changing original bytes", () => {
    const copy = source();
    const legacy = cloneProgress(copy.envelope); delete legacy.recovery;
    const raw = JSON.stringify({ ...legacy, version: 1 });
    const address = { appId, ownerId, writerId: copy.writerId };
    const old = readJournalEnvelope(raw, address)!;
    expect(old.current).toBe(copy.envelope.current); expect(old.recovery).toBeUndefined();
    const next = nextJournalEnvelope(old, old.current, [], address);
    expect(next.version).toBe(2); expect(next.recovery).toEqual(emptyJournalRecovery());
    expect(readJournalEnvelope(JSON.stringify(next), address)).toEqual(next);
  });

  it.each([
    { version: 2, adoptedSources: [], resolutions: [] },
    { version: 1, adoptedSources: ["malformed"], resolutions: [] },
    { version: 1, adoptedSources: [], resolutions: [{ sourceId: "malformed", revision: revision(1) }] },
  ])("refuses malformed or future metadata without rewriting it: %j", recovery => {
    const copy = source(), raw = JSON.stringify({ ...copy.envelope, recovery });
    expect(readJournalEnvelope(raw, { appId, ownerId, writerId: copy.writerId })).toBeNull();
  });

  it("rejects foreign metadata and mismatched source identity before adoption", async () => {
    const copy = source(), foreign = await ownerKeyFor("foreign");
    copy.envelope.recovery = { version: 1, adoptedSources: [journalSourceId(foreign, appId, "other", "bytes")], resolutions: [] };
    expect(isJournalRecovery(copy.envelope.recovery, appId, ownerKey)).toBe(false);
    expect(() => adopt(copy)).toThrow("Invalid recovery source");
    expect(resolvedJournalSources([copy], appId, ownerKey)).toBeNull();
    copy.envelope.recovery = emptyJournalRecovery(); copy.sourceId = journalSourceId(foreign, appId, copy.writerId, copy.envelope.current);
    expect(() => adopt(copy)).toThrow("Invalid recovery source");
    expect(() => adoptJournalCopy(copy, { appId, ownerId, ownerKey: foreign, writerId: "next" })).toThrow("Invalid recovery source");
  });
});
