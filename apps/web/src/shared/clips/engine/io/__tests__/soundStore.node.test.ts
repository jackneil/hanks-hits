// @vitest-environment node
/**
 * The game sound of tiers M and V in the io worker (soundParse.ts,
 * soundStore.ts), on real sound runs that ffmpeg makes the way an
 * audio-only MediaRecorder does (segmentFixtures.ts): Opus in a live WebM
 * and AAC in a fragmented MP4, cut into chunks at any byte.
 *
 * - The WebM reader gives the same packets as mediabunny's own reader, and
 *   gives each block as soon as its bytes are in: a Cluster that runs for
 *   many seconds does not hold the newest sound back.
 * - The MP4 reader (mediabunny from a stream) gives each fragment's packets.
 * - The store puts the packets on the capture timeline, cuts an older run at
 *   a newer run's start, gives one config per span, keeps the ring length,
 *   and waits for the sound that a clip needs.
 */
import { BufferSource, EncodedPacketSink, Input, MATROSKA, MP4, WEBM } from "mediabunny";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createSoundParser, opusPacketUs, type SoundHeader, type StreamPacket } from "../soundParse";
import { SoundStore, pickSound, type SoundPacket } from "../soundStore";
import { FFMPEG_SKIP_REASON, cleanupSegmentFixtures, makeSoundRun, toLiveWebm } from "./segmentFixtures";

const SKIP = FFMPEG_SKIP_REASON !== "";
if (SKIP) console.warn(`[clips] soundStore.node.test: SKIPPED (${FFMPEG_SKIP_REASON})`);

afterAll(() => cleanupSegmentFixtures());

/** mediabunny's own reading of a whole file: [time us, bytes] per packet. */
async function reference(bytes: Uint8Array, container: "webm" | "mp4"): Promise<Array<[number, number]>> {
  const input = new Input({ formats: container === "webm" ? [WEBM, MATROSKA] : [MP4], source: new BufferSource(bytes) });
  const track = await input.getPrimaryAudioTrack();
  const out: Array<[number, number]> = [];
  for await (const p of new EncodedPacketSink(track!).packets()) out.push([Math.round(p.timestamp * 1e6), p.data.length]);
  input.dispose();
  return out;
}

/** Feeds `bytes` in chunks of the sizes `sizes` gives, and collects what the reader gives. */
function feed(container: "webm" | "mp4", bytes: Uint8Array, sizes: () => number) {
  const packets: StreamPacket[] = [];
  const errors: string[] = [];
  let header: SoundHeader | null = null;
  const parser = createSoundParser(container, {
    onHeader: (h) => {
      header = h;
    },
    onPacket: (p) => packets.push(p),
    onError: (m) => errors.push(m),
  });
  return {
    packets,
    errors,
    header: () => header,
    parser,
    push(until = bytes.length, from = 0) {
      for (let at = from; at < until; ) {
        const n = Math.min(until - at, Math.max(1, sizes()));
        parser.push(bytes.slice(at, at + n));
        at += n;
      }
    },
  };
}

function randomSizes(seed: number, most: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return 1 + Math.floor((x / 2 ** 31) * most);
  };
}

describe.skipIf(SKIP)("the WebM sound reader", () => {
  it("gives the same packets as mediabunny, with chunks cut at any byte, from a live file (unknown sizes)", async () => {
    const bytes = toLiveWebm(makeSoundRun({ container: "webm", seconds: 6 }));
    const r = feed("webm", bytes, randomSizes(3, 700));
    r.push();
    r.parser.end();
    await r.parser.done;
    expect(r.errors).toEqual([]);
    expect(r.header()).toMatchObject({ codec: "opus", config: { codec: "opus", sampleRate: 48_000, numberOfChannels: 1 } });
    expect((r.header()!.config.description as Uint8Array).length).toBe(19);
    const ref = await reference(bytes, "webm");
    expect(r.packets.map((p) => [p.tsUs, p.data.length])).toEqual(ref);
    // Opus frames are 20 ms (the TOC says so).
    expect(r.packets.slice(1, -1).every((p) => p.durUs === 20_000)).toBe(true);
    expect(r.packets.every((p) => p.key)).toBe(true);
  });

  it("gives the newest sound at once: a Cluster that runs for 10 s does not hold it back", async () => {
    const bytes = toLiveWebm(makeSoundRun({ container: "webm", seconds: 12, clusterMs: 10_000 }));
    const r = feed("webm", bytes, () => 4096);
    // About half of the file's bytes: the reader is at about half of its time, inside the first Cluster.
    r.push(Math.floor(bytes.length / 2));
    const last = r.packets.at(-1)!;
    expect(last.tsUs).toBeGreaterThan(5_000_000);
    expect(last.tsUs).toBeLessThan(10_000_000);
    r.parser.cancel();
  });

  it("refuses a stream that is not WebM, and keeps what it read before a fault", async () => {
    const bad = feed("webm", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), () => 3);
    bad.push();
    await bad.parser.done;
    expect(bad.errors).toHaveLength(1);
    const bytes = makeSoundRun({ container: "webm", seconds: 2 });
    const good = feed("webm", bytes, () => 1000);
    good.push();
    good.parser.push(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    await good.parser.done;
    expect(good.errors).toHaveLength(1);
    expect(good.packets.length).toBeGreaterThan(90);
  });
});

describe("the WebM sound reader: laced blocks (Xiph, EBML, fixed)", () => {
  /** An EBML element: id bytes, an 8-byte size, the body. */
  const el = (id: number[], body: Uint8Array | number[]): number[] => {
    const b = Array.from(body);
    const size = b.length;
    return [...id, 0x01, 0, 0, 0, (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...b];
  };
  const opusHead = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0];
  const header = [
    ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Array.from(new TextEncoder().encode("webm")))),
  ];
  const tracks = el(
    [0x16, 0x54, 0xae, 0x6b],
    el([0xae], [
      ...el([0xd7], [1]),
      ...el([0x83], [2]),
      ...el([0x86], Array.from(new TextEncoder().encode("A_OPUS"))),
      ...el([0x63, 0xa2], opusHead),
      ...el([0xe1], [...el([0x9f], [2]), ...el([0xb5], [0x47, 0x3b, 0x80, 0x00])]),
    ]),
  );
  /** Opus frames: TOC 0x78 (config 15: hybrid 20 ms, one frame), then n bytes. */
  const frame = (n: number, fill: number) => [0x78, ...new Array(n - 1).fill(fill)];

  function stream(blocks: number[][]): Uint8Array {
    const cluster = el([0x1f, 0x43, 0xb6, 0x75], [...el([0xe7], [0]), ...blocks.flat()]);
    return new Uint8Array([...header, ...el([0x18, 0x53, 0x80, 0x67], [...tracks, ...cluster])]);
  }

  function parse(bytes: Uint8Array) {
    const packets: StreamPacket[] = [];
    const errors: string[] = [];
    const parser = createSoundParser("webm", { onHeader: () => undefined, onPacket: (p) => packets.push(p), onError: (m) => errors.push(m) });
    parser.push(bytes);
    parser.end();
    return { packets, errors };
  }

  it("reads Xiph lacing: sizes as runs of 255", () => {
    const a = frame(300, 1);
    const b = frame(40, 2);
    const c = frame(70, 3);
    // SimpleBlock: track 1, time 0, flags key + Xiph lacing (0x82), 3 frames.
    const body = [0x81, 0, 0, 0x82, 2, 255, 45, 40, ...a, ...b, ...c];
    const { packets, errors } = parse(stream([el([0xa3], body)]));
    expect(errors).toEqual([]);
    expect(packets.map((p) => [p.tsUs, p.data.length, p.data[1]])).toEqual([
      [0, 300, 1],
      [20_000, 40, 2],
      [40_000, 70, 3],
    ]);
  });

  it("reads EBML lacing: the first size, then signed differences", () => {
    const a = frame(100, 1);
    const b = frame(90, 2);
    const c = frame(50, 3);
    // 100 as a 1-byte vint (0x80 | 100 = 0xE4), then -10 as a 1-byte signed vint (bias 63: 53 -> 0xB5).
    const body = [0x81, 0, 0, 0x86, 2, 0xe4, 0xb5, ...a, ...b, ...c];
    const { packets, errors } = parse(stream([el([0xa3], body)]));
    expect(errors).toEqual([]);
    expect(packets.map((p) => p.data.length)).toEqual([100, 90, 50]);
  });

  it("reads fixed lacing, a BlockGroup with its BlockDuration, and skips another track", () => {
    const fixed = [0x81, 0, 10, 0x84, 1, ...frame(20, 1), ...frame(20, 2)];
    const group = el([0xa0], [...el([0xa1], [0x81, 0, 30, 0x00, ...frame(10, 3)]), ...el([0x9b], [25])]);
    const other = el([0xa3], [0x82, 0, 0, 0x80, 9, 9, 9]);
    const { packets, errors } = parse(stream([el([0xa3], fixed), group, other]));
    expect(errors).toEqual([]);
    expect(packets.map((p) => [p.tsUs, p.durUs, p.data.length])).toEqual([
      [10_000, 20_000, 20],
      [30_000, 20_000, 20],
      [30_000, 25_000, 10],
    ]);
  });

  it("reads each Opus packet's length from its TOC byte", () => {
    expect(opusPacketUs(new Uint8Array([0x78]))).toBe(20_000);
    // CELT 10 ms, code 1 (two frames).
    expect(opusPacketUs(new Uint8Array([(18 << 3) | 1]))).toBe(20_000);
    // SILK 60 ms, code 3 with 2 frames.
    expect(opusPacketUs(new Uint8Array([(3 << 3) | 3, 2]))).toBe(120_000);
    expect(opusPacketUs(new Uint8Array([]))).toBeNull();
  });
});

describe.skipIf(SKIP)("the MP4 sound reader", () => {
  it("gives the same packets as mediabunny's own reader, with chunks cut at any byte", async () => {
    const bytes = makeSoundRun({ container: "mp4", seconds: 4 });
    const r = feed("mp4", bytes, randomSizes(9, 900));
    r.push();
    r.parser.end();
    await r.parser.done;
    expect(r.errors).toEqual([]);
    expect(r.header()).toMatchObject({ codec: "aac", config: { codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 1 } });
    expect(r.packets.map((p) => [p.tsUs, p.data.length])).toEqual(await reference(bytes, "mp4"));
  });

  it("gives a fragment's packets when its bytes are in, before the stream ends", async () => {
    const bytes = makeSoundRun({ container: "mp4", seconds: 6, fragmentMs: 250 });
    const r = feed("mp4", bytes, () => 2048);
    r.push(Math.floor(bytes.length / 2));
    await vi.waitFor(() => expect(r.packets.at(-1)?.tsUs ?? 0).toBeGreaterThan(2_000_000));
    r.parser.cancel();
    await r.parser.done;
  });
});

describe.skipIf(SKIP)("SoundStore", () => {
  async function run(store: SoundStore, runId: number, timeline: number, startUs: number, seconds: number, container: "webm" | "mp4" = "webm") {
    const bytes = makeSoundRun({ container, seconds });
    store.open(runId, timeline, container, startUs, 60);
    for (let at = 0; at < bytes.length; at += 3000) store.append(runId, bytes.slice(at, at + 3000));
    store.end(runId);
    await store.ready(timeline, Infinity, 5000);
  }

  it("puts a run's first packet at its start and keeps the packet distances", async () => {
    const store = new SoundStore();
    const bytes = makeSoundRun({ container: "webm", seconds: 3 });
    store.open(1, 7, "webm", 2_000_000, 60);
    for (let at = 0; at < bytes.length; at += 3000) store.append(1, bytes.slice(at, at + 3000));
    store.end(1);
    await store.ready(7, Infinity, 5000);
    const ref = await reference(bytes, "webm");
    const all = store.take(7, 0, Infinity)!;
    expect(all.codec).toBe("opus");
    expect(all.packets.map((p) => p.capUs)).toEqual(ref.map(([t]) => 2_000_000 + t - ref[0][0]));
    // A span gives its packets only: 100 ms of 20 ms packets.
    const span = store.take(7, 3_000_000, 3_100_000)!;
    expect(span.packets).toHaveLength(5);
    expect(span.packets.every((p) => p.capUs >= 3_000_000 && p.capUs < 3_100_000)).toBe(true);
    expect(store.take(99, 0, Infinity)).toBeNull();
  });

  it("a newer run cuts the older one at its start: two runs never give sound for the same moment", async () => {
    const store = new SoundStore();
    await run(store, 1, 1, 0, 3);
    await run(store, 2, 1, 2_000_000, 2);
    const all = store.take(1, 0, Infinity)!;
    const times = all.packets.map((p) => p.capUs);
    expect(times.filter((t) => t >= 2_000_000 && t < 2_020_000)).toEqual([2_000_000]);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("keeps the ring length back from the newest packet", async () => {
    const store = new SoundStore();
    const bytes = makeSoundRun({ container: "webm", seconds: 5 });
    store.open(1, 1, "webm", 0, 2);
    store.append(1, bytes);
    store.end(1);
    await store.ready(1, Infinity, 5000);
    const held = store.held(1);
    expect(held[0].capUs).toBeGreaterThanOrEqual(held.at(-1)!.capUs - 2_000_000);
    expect(held.at(-1)!.capUs).toBeGreaterThan(4_900_000);
  });

  it("ready() waits for the sound up to a time, and ends at a timeout when it does not come", async () => {
    let fire: (() => void) | null = null;
    const store = new SoundStore({ setTimeout: (fn) => ((fire = fn), 1), clearTimeout: () => undefined, log: () => undefined });
    const bytes = makeSoundRun({ container: "webm", seconds: 4 });
    store.open(1, 1, "webm", 0, 60);
    let done = false;
    const waiting = store.ready(1, 3_000_000, 1000).then(() => (done = true));
    store.append(1, bytes.slice(0, Math.floor(bytes.length / 3)));
    await Promise.resolve();
    expect(done).toBe(false);
    store.append(1, bytes.slice(Math.floor(bytes.length / 3)));
    await waiting;
    expect(done).toBe(true);
    // More than the run will ever have, with the run still open: the timeout ends the wait.
    let late = false;
    const tooFar = store.ready(1, 99_000_000, 1000).then(() => (late = true));
    await Promise.resolve();
    expect(late).toBe(false);
    fire!();
    await tooFar;
    expect(late).toBe(true);
    // No run of a timeline: nothing to wait for.
    await store.ready(42, 1, 1000);
  });

  it("gives every new packet to a listener, and a run of a new timeline ends the old runs", async () => {
    const store = new SoundStore();
    const heard: Array<[number, number]> = [];
    const stop = store.subscribe((timeline, p) => heard.push([timeline, p.capUs]));
    await run(store, 1, 1, 0, 1);
    expect(heard.length).toBeGreaterThan(45);
    expect(heard.every(([t]) => t === 1)).toBe(true);
    stop();
    const bytes = makeSoundRun({ container: "webm", seconds: 2 });
    store.open(2, 1, "webm", 1_000_000, 60);
    store.append(2, bytes.slice(0, 5000));
    // A new session: its first run ends the old timeline's open run (its reader finishes what came).
    store.open(3, 2, "webm", 0, 60);
    await store.ready(1, Infinity, 5000);
    expect(store.take(2, 0, Infinity)).toBeNull();
    // An unknown run's bytes are ignored.
    store.append(77, new Uint8Array(10));
    store.clear();
    expect(store.held(1)).toEqual([]);
  });

  it("pickSound keeps one config (the newest packet's) and one packet per time", () => {
    const f1 = { codec: "opus" as const, config: { codec: "opus", sampleRate: 48_000, numberOfChannels: 1 }, key: "a" };
    const f2 = { ...f1, key: "b" };
    const p = (capUs: number, format = f1): SoundPacket => ({ capUs, durUs: 20_000, data: new Uint8Array([capUs & 0xff]), key: true, format });
    const picked = pickSound([p(40_000, f2), p(0), p(20_000), p(20_000), p(60_000, f2)], 0, 100_000)!;
    expect(picked.packets.map((x) => x.capUs)).toEqual([40_000, 60_000]);
    expect(pickSound([p(0)], 10, 20)).toBeNull();
  });
});
