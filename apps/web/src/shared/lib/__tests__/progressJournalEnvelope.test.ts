import { describe, expect, it } from "vitest";
import { useDrawingStore } from "@/apps/drawing-app/lib/store";
import { cloneProgress, newProgressJournal } from "../progressJournal";
import { journalOriginalRetention, nextJournalEnvelope, readJournalEnvelope, type JournalEnvelope } from "../progressJournalEnvelope";

const address = { appId: "drawing-app" as const, ownerId: "owner", writerId: "writer" };
const revision = "a".repeat(64);
const defaults = () => cloneProgress(useDrawingStore.getState().getProgress());
const art = (id: string, bytes = 0) => ({ id, name: id, dataUrl: "x".repeat(bytes) || id, thumbnail: id, createdAt: "2026-01-01T00:00:00Z", editedAt: "2026-01-01T00:00:00Z" });
const journal = (id = "old", bytes = 0) => {
  const data = { ...defaults(), savedArtworks: [art(id, bytes)] };
  return newProgressJournal(address.appId, address.ownerId, address.writerId, { data, revision }, data, true);
};

describe("atomic progress journal envelopes", () => {
  it("reads bare journals without losing their original formatting", () => {
    const raw = JSON.stringify(journal(), null, 2);
    expect(readJournalEnvelope(raw, address)).toMatchObject({ current: raw, generation: 0, originals: [] });
  });
  it("stores replacement and exact originals together and deduplicates unchanged bytes", () => {
    const old = JSON.stringify(journal(), null, 2), current = JSON.stringify(journal("new"));
    const next = nextJournalEnvelope(null, current, [old, old], address);
    expect(next.originals).toEqual([{ raw: old, choice: false }]);
    expect(readJournalEnvelope(JSON.stringify(next), address)).toEqual(next);
    expect(journalOriginalRetention(next.originals[0], current, address)).toBe("capture");
  });
  it("allows a word snapshot to remain covered in another part of the current journal", () => {
    const old = journal(), next = journal("new");
    next.sent = { id: "request", base: next.acknowledged, data: old.live };
    expect(journalOriginalRetention({ raw: JSON.stringify(old), choice: false }, JSON.stringify(next), address)).toBe("covered");
  });
  it("does not mistake matching image identity for matching original content", () => {
    const old = journal(), next = journal();
    next.live.savedArtworks[0].dataUrl = "different image";
    next.acknowledged.data = cloneProgress(next.live);
    expect(journalOriginalRetention({ raw: JSON.stringify(old), choice: false }, JSON.stringify(next), address)).toBe("capture");
  });
  it("pins the exact choice boundary, not every conflicting or chosen timer sample", () => {
    const old = journal(); old.conflict = { remote: { data: journal("remote").live, revision: "b".repeat(64) }, reason: "concurrent-edit", paths: ["savedArtworks"] };
    const chosen = cloneProgress(old); chosen.acknowledged = old.conflict.remote; chosen.conflict = null; chosen.forceWrite = true; chosen.serial++;
    const first = nextJournalEnvelope(null, JSON.stringify(chosen), [JSON.stringify(old)], address);
    expect(first.originals[0].choice).toBe(true);
    expect(journalOriginalRetention(first.originals[0], first.current, address)).toBe("pinned");
    const later = cloneProgress(chosen); later.live.stats.totalDrawTime++;
    const next = nextJournalEnvelope(first, JSON.stringify(later), [JSON.stringify(chosen)], address);
    expect(next.originals.map(item => item.choice)).toEqual([true, false]);
  });
  it("pins only the actual choice boundary when failed captures supplied several conflicting originals", () => {
    const samples = [0, 1, 2].map(serial => {
      const row = journal(); row.serial = serial; row.live.stats.totalDrawTime = serial;
      row.conflict = { remote: row.acknowledged, reason: "concurrent-edit" as const, paths: [] };
      return row;
    });
    const chosen = cloneProgress(samples[2]); chosen.serial = 3; chosen.conflict = null; chosen.forceWrite = true;
    const next = nextJournalEnvelope(null, JSON.stringify(chosen), samples.map(row => JSON.stringify(row)), address);
    expect(next.originals.map(item => item.choice)).toEqual([false, false, true]);
  });
  it("releases a choice pin after ACK even when newer edits remain pending", () => {
    const before = journal(); before.conflict = { remote: before.acknowledged, reason: "concurrent-edit", paths: [] };
    const after = journal(); after.live.stats.totalDrawTime++;
    expect(after.live).not.toEqual(after.acknowledged.data);
    expect(journalOriginalRetention({ raw: JSON.stringify(before), choice: true }, JSON.stringify(after), address)).toBe("covered");
  });
  it("bounds redundant originals during 1000 stats-only updates with an unresolved large-image conflict", () => {
    const row = journal("large", 140_492);
    row.conflict = { remote: row.acknowledged, reason: "concurrent-edit", paths: [] };
    let raw = JSON.stringify(row), envelope: JournalEnvelope | null = null;
    const baseBytes = raw.length;
    let maximumBytes = 0;
    for (let i = 0; i < 1000; i++) {
      const old = raw;
      row.live.stats.totalDrawTime = i + 1; row.serial++;
      raw = JSON.stringify(row);
      envelope = nextJournalEnvelope(envelope, raw, [old], address);
      maximumBytes = Math.max(maximumBytes, JSON.stringify(envelope).length);
      envelope.originals = envelope.originals.filter(item => journalOriginalRetention(item, raw, address) !== "covered");
      expect(envelope.originals.length).toBe(0);
    }
    expect(maximumBytes).toBeLessThan(baseBytes * 2.05);
  });
  it("retains unknown originals rather than treating no extracted words as proof of safety", () => {
    expect(journalOriginalRetention({ raw: '{"version":999}', choice: false }, JSON.stringify(journal()), address)).toBe("pinned");
  });
  it("refuses future envelopes and foreign current/original owners", () => {
    const raw = JSON.stringify(journal());
    const envelope = nextJournalEnvelope(null, raw, [], address);
    expect(readJournalEnvelope(JSON.stringify({ ...envelope, version: 2 }), address)).toBeNull();
    expect(readJournalEnvelope(JSON.stringify(envelope), { ...address, writerId: "other" })).toBeNull();
    const foreign = JSON.stringify({ ...journal(), ownerId: "other" });
    expect(readJournalEnvelope(JSON.stringify({ ...envelope, originals: [{ raw: foreign, choice: false }] }), address)).toBeNull();
  });
});
