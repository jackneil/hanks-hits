// @vitest-environment node
/**
 * The Record journal (plan 8.4 crash recovery): its frame format, its reader
 * (which must stop at a torn or damaged frame), and PartJournal on the shared
 * OPFS double. ioService.test.ts runs it end to end through the io handler.
 */
import { describe, expect, it } from "vitest";

import { createOpfsMock } from "../../../../../__tests__/opfs-mock";
import type { StorageLike } from "../../../library/fsTypes";
import type { ClipMeta, ClipPackets } from "../../../protocol";
import { FakeLockManager } from "../../../service/__tests__/fakeLocks";
import {
  JOURNAL_DIR,
  PartJournal,
  RECORD_LOCK_PREFIX,
  chunkFrame,
  decodeFrames,
  encodeFrame,
  holdRecordingLock,
  readJournal,
  recoverJournals,
  type JournalMeta,
} from "../recordJournal";
import { epochInfo, makeClipPackets } from "./fixtures";

function meta(id: string): ClipMeta {
  return {
    id,
    ownerKey: "guest",
    gameId: "snake",
    kind: "record",
    createdAt: Date.UTC(2026, 8, 28, 12),
    durationMs: 0,
    width: 64,
    height: 64,
    fps: 30,
    hasAudio: false,
    mime: "video/mp4",
    kept: false,
    watched: false,
    moments: [],
  };
}

function journalMeta(id: string, recordingId = id): JournalMeta {
  return { t: "meta", v: 1, recordingId, meta: meta(id) };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The chunks of one ClipPackets, one per GOP (the way the Record tee posts them). */
function chunksOf(whole: ClipPackets): ClipPackets[] {
  const gops: ClipPackets["video"][] = [];
  for (const p of whole.video) {
    if (p.type === "key") gops.push([]);
    gops[gops.length - 1].push(p);
  }
  let a = 0;
  return gops.map((video, i) => {
    const endUs = video[video.length - 1].tsUs + video[video.length - 1].durUs;
    const audio: ClipPackets["audio"] = [];
    while (a < whole.audio.length && (i === gops.length - 1 || whole.audio[a].tsUs < endUs)) audio.push(whole.audio[a++]);
    return { ...whole, video, audio, startUs: video[0].tsUs, endUs, coveredSec: (endUs - video[0].tsUs) / 1e6 };
  });
}

function bytesOf(buffer: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buffer));
}

describe("journal frames", () => {
  it("round-trips headers and bodies", () => {
    const a = encodeFrame({ t: "x", n: 1 }, [new Uint8Array([1, 2]), new Uint8Array([3])]);
    const b = encodeFrame({ t: "y" }, []);
    const { frames, torn } = decodeFrames(concat([a, b]));
    expect(torn).toBe(false);
    expect(frames.map((f) => f.header)).toEqual([{ t: "x", n: 1 }, { t: "y" }]);
    expect(Array.from(frames[0].body)).toEqual([1, 2, 3]);
    expect(frames[1].body.length).toBe(0);
  });

  it("stops at a torn tail, a changed byte, a foreign file and zeros, and keeps every frame before", () => {
    const a = encodeFrame({ t: "a" }, [new Uint8Array(10).fill(7)]);
    const b = encodeFrame({ t: "b" }, [new Uint8Array(10).fill(9)]);
    const whole = concat([a, b]);
    // A write that stopped in the middle of the second frame.
    expect(decodeFrames(whole.subarray(0, whole.length - 3))).toMatchObject({ torn: true, frames: [{ header: { t: "a" } }] });
    // A flipped body byte fails the checksum.
    const flipped = whole.slice();
    flipped[a.length + 20] ^= 0xff;
    expect(decodeFrames(flipped).frames.map((f) => f.header)).toEqual([{ t: "a" }]);
    // A file system that extended the file with zeros after a crash.
    expect(decodeFrames(concat([a, new Uint8Array(64)])).frames.map((f) => f.header)).toEqual([{ t: "a" }]);
    // Not a journal at all.
    expect(decodeFrames(new TextEncoder().encode("hello, this is not a journal"))).toEqual({ frames: [], torn: true });
  });
});

describe("readJournal", () => {
  it("gives back the part: its row and every chunk's packets, epochs and AAC config", () => {
    const whole = makeClipPackets({ seconds: 3, baseUs: 2_000_000, epoch: epochInfo(4) });
    const chunks = chunksOf(whole);
    const file = concat([encodeFrame(journalMeta("rec-a"), []), ...chunks.map(chunkFrame)]);
    const part = readJournal(file, "rec-a")!;
    expect(part.torn).toBe(false);
    expect(part.meta).toEqual(journalMeta("rec-a"));
    const packets = part.packets!;
    expect(packets.video.map((p) => [p.type, p.tsUs, p.durUs, p.epoch])).toEqual(whole.video.map((p) => [p.type, p.tsUs, p.durUs, p.epoch]));
    expect(packets.video.map((p) => bytesOf(p.data))).toEqual(whole.video.map((p) => bytesOf(p.data)));
    expect(packets.audio.map((p) => [p.tsUs, bytesOf(p.data)])).toEqual(whole.audio.map((p) => [p.tsUs, bytesOf(p.data)]));
    expect(packets.videoEpochs.map((e) => [e.epoch, e.codec, bytesOf(e.description)])).toEqual(
      whole.videoEpochs.map((e) => [e.epoch, e.codec, bytesOf(e.description)]),
    );
    expect(packets.audioConfig && bytesOf(packets.audioConfig.description)).toEqual(whole.audioConfig && bytesOf(whole.audioConfig.description));
    expect(packets).toMatchObject({ startUs: 2_000_000, endUs: 5_000_000, primingSamples: whole.primingSamples, coveredSec: 3 });
  });

  it("uses the whole chunks before a torn one", () => {
    const whole = makeClipPackets({ seconds: 3, baseUs: 0 });
    const chunks = chunksOf(whole);
    const file = concat([encodeFrame(journalMeta("rec-b"), []), ...chunks.map(chunkFrame)]);
    const part = readJournal(file.subarray(0, file.length - 50), "rec-b")!;
    expect(part.torn).toBe(true);
    expect(part.packets!.endUs).toBe(chunks[1].endUs);
    expect(part.packets!.video).toHaveLength(chunks[0].video.length + chunks[1].video.length);
  });

  it("has no packets with only the row, and is null with no valid row", () => {
    expect(readJournal(encodeFrame(journalMeta("rec-c"), []), "rec-c")).toMatchObject({ packets: null });
    expect(readJournal(encodeFrame({ t: "meta", v: 1, recordingId: "../x", meta: meta("x") }, []), "x")).toBeNull();
    expect(readJournal(new Uint8Array(0), "x")).toBeNull();
  });
});

describe("PartJournal (OPFS, a worker)", () => {
  it("writes the row, then each chunk flushed at once, and is removed when its part is done", async () => {
    const opfs = createOpfsMock();
    const journal = (await PartJournal.open({ storage: opfs.storage as unknown as StorageLike, locks: null }, journalMeta("rec-d")))!;
    expect(journal).not.toBeNull();
    const whole = makeClipPackets({ seconds: 2, baseUs: 0 });
    const flushesBefore = opfs.flushCount();
    for (const chunk of chunksOf(whole)) await journal.append(chunk);
    expect(opfs.flushCount() - flushesBefore).toBe(2);
    const bytes = opfs.readFile(`${JOURNAL_DIR}/rec-d.journal`)!;
    expect(readJournal(bytes, "rec-d")!.packets!.video).toHaveLength(whole.video.length);
    await journal.remove();
    expect(opfs.listFiles()).toEqual([]);
    expect(opfs.openSyncHandles()).toBe(0);
  });

  it("is null where there is no OPFS or no SyncAccessHandle (the part stays in memory)", async () => {
    expect(await PartJournal.open({ storage: null, locks: null }, journalMeta("rec-e"))).toBeNull();
    const windowOpfs = createOpfsMock({ context: "window" });
    expect(await PartJournal.open({ storage: windowOpfs.storage as unknown as StorageLike, locks: null }, journalMeta("rec-e"))).toBeNull();
    expect(windowOpfs.listFiles()).toEqual([]);
  });

  it("stops journaling after a failed write, and leaves a file that ends at its last whole frame", async () => {
    const opfs = createOpfsMock();
    const logs: string[] = [];
    const journal = (await PartJournal.open({ storage: opfs.storage as unknown as StorageLike, locks: null, log: (m) => logs.push(m) }, journalMeta("rec-f")))!;
    const [first, second, third] = chunksOf(makeClipPackets({ seconds: 3, baseUs: 0 }));
    await journal.append(first);
    opfs.failNext("syncWrite");
    await journal.append(second);
    await journal.append(third);
    expect(logs).toEqual([expect.stringContaining("journal stopped")]);
    const part = readJournal(opfs.readFile(`${JOURNAL_DIR}/rec-f.journal`)!, "rec-f")!;
    expect(part.torn).toBe(false);
    expect(part.packets!.endUs).toBe(first.endUs);
    await journal.remove();
  });
});

describe("recoverJournals", () => {
  it("does nothing without Web Locks (a live tab cannot be told from a dead one)", async () => {
    const opfs = createOpfsMock();
    opfs.writeFile(`${JOURNAL_DIR}/rec-g.journal`, concat([encodeFrame(journalMeta("rec-g"), []), chunkFrame(makeClipPackets({ seconds: 1 }))]));
    const stored = await recoverJournals({ storage: opfs.storage as unknown as StorageLike, locks: null }, async () => "row");
    expect(stored).toEqual([]);
    expect(opfs.exists(`${JOURNAL_DIR}/rec-g.journal`)).toBe(true);
  });

  it("stores a dead tab's journal, skips a live one, and removes empty and broken files", async () => {
    const opfs = createOpfsMock();
    const locks = new FakeLockManager();
    const live = await holdRecordingLock(locks.client("live-tab"), "rec-live");
    const chunk = chunkFrame(makeClipPackets({ seconds: 1 }));
    opfs.writeFile(`${JOURNAL_DIR}/rec-dead.journal`, concat([encodeFrame(journalMeta("rec-dead"), []), chunk]));
    opfs.writeFile(`${JOURNAL_DIR}/rec-live.journal`, concat([encodeFrame(journalMeta("rec-live"), []), chunk]));
    opfs.writeFile(`${JOURNAL_DIR}/rec-empty.journal`, encodeFrame(journalMeta("rec-empty"), []));
    opfs.writeFile(`${JOURNAL_DIR}/junk.journal`, new Uint8Array([1, 2, 3]));
    expect(locks.holderOf(`${RECORD_LOCK_PREFIX}rec-live`)).toBe("live-tab");
    const seen: string[] = [];
    const stored = await recoverJournals({ storage: opfs.storage as unknown as StorageLike, locks: locks.client("me") }, async (part) => {
      seen.push(part.meta.id);
      return part.meta.id;
    });
    expect(stored).toEqual(["rec-dead"]);
    expect(seen).toEqual(["rec-dead"]);
    expect(opfs.listFiles()).toEqual([`${JOURNAL_DIR}/rec-live.journal`]);
    live.release();
  });

  it("two tabs that start at once after a crash store a dead journal once", async () => {
    const opfs = createOpfsMock();
    const locks = new FakeLockManager();
    opfs.writeFile(`${JOURNAL_DIR}/rec-dead.journal`, concat([encodeFrame(journalMeta("rec-dead"), []), chunkFrame(makeClipPackets({ seconds: 1 }))]));
    const stores: string[] = [];
    // A store takes a while (the mux and the OPFS write), like the real muxAndStore.
    const store = (tab: string) => async (part: { meta: ClipMeta }) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      stores.push(`${tab}:${part.meta.id}`);
      return part.meta.id;
    };
    const [a, b] = await Promise.all([
      recoverJournals({ storage: opfs.storage as unknown as StorageLike, locks: locks.client("tab-a") }, store("a")),
      recoverJournals({ storage: opfs.storage as unknown as StorageLike, locks: locks.client("tab-b") }, store("b")),
    ]);
    expect(stores).toHaveLength(1);
    expect([...a, ...b]).toEqual(["rec-dead"]);
    expect(opfs.listFiles()).toEqual([]);
    expect(locks.holderOf(`${RECORD_LOCK_PREFIX}rec-dead`)).toBeNull();
  });

  it("holds the recording lock while it stores, so a live tab that starts the same recording waits", async () => {
    const opfs = createOpfsMock();
    const locks = new FakeLockManager();
    opfs.writeFile(`${JOURNAL_DIR}/rec-x.journal`, concat([encodeFrame(journalMeta("rec-x"), []), chunkFrame(makeClipPackets({ seconds: 1 }))]));
    const holders: Array<string | null> = [];
    await recoverJournals({ storage: opfs.storage as unknown as StorageLike, locks: locks.client("me") }, async (part) => {
      holders.push(locks.holderOf(`${RECORD_LOCK_PREFIX}rec-x`));
      return part.meta.id;
    });
    expect(holders).toEqual(["me"]);
  });

  it("leaves a journal alone when the lock request fails", async () => {
    const opfs = createOpfsMock();
    opfs.writeFile(`${JOURNAL_DIR}/rec-y.journal`, concat([encodeFrame(journalMeta("rec-y"), []), chunkFrame(makeClipPackets({ seconds: 1 }))]));
    const logs: string[] = [];
    const failing = { request: async () => Promise.reject(new DOMException("no", "SecurityError")) };
    const stored = await recoverJournals(
      { storage: opfs.storage as unknown as StorageLike, locks: failing, log: (m) => logs.push(m) },
      async () => "row",
    );
    expect(stored).toEqual([]);
    expect(opfs.exists(`${JOURNAL_DIR}/rec-y.journal`)).toBe(true);
    expect(logs).toEqual([expect.stringContaining("left for later")]);
  });

  it("removes a journal whose part fails to store (reported there), so it is not tried at every startup", async () => {
    const opfs = createOpfsMock();
    const locks = new FakeLockManager();
    opfs.writeFile(`${JOURNAL_DIR}/rec-bad.journal`, concat([encodeFrame(journalMeta("rec-bad"), []), chunkFrame(makeClipPackets({ seconds: 1 }))]));
    const stored = await recoverJournals({ storage: opfs.storage as unknown as StorageLike, locks: locks.client("me") }, async () => null);
    expect(stored).toEqual([]);
    expect(opfs.listFiles()).toEqual([]);
  });
});
