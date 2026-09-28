import { describe, expect, it } from "vitest";
import { fakeAvcC } from "@/__tests__/webcodecs-mock";
import type { EpochInfo, RecordTeeMsg } from "../../../protocol";
import { AAC_FRAME, AAC_FRAME_US, frameToUs, type AudioPacket } from "../audio/aac";
import {
  AUDIO_END_TOLERANCE_US,
  RecordTee,
  TEE_TAIL_WAIT_MS,
  assembleClip,
  nearestAudioIndex,
  selectAudio,
  type AudioSource,
  type ClipSources,
} from "../clipAssembler";
import { GopRing } from "../gopRing";
import type { VideoPacket } from "../videoSession";

const F = 33_333;
const D = 3138; // priming 2114 plus the 1024 pre-pad

function vpkt(i: number, epoch = 0, gop = 30): VideoPacket {
  const data = new Uint8Array([i & 0xff, (i >> 8) & 0xff, epoch]).buffer;
  return { type: i % gop === 0 ? "key" : "delta", tsUs: i * F, durUs: F, data, epoch };
}

function epoch(n: number, variant = 0, size = 720): EpochInfo {
  return { epoch: n, codec: "avc1.64001f", codedWidth: size, codedHeight: 1280, description: fakeAvcC(size, 1280, variant).slice().buffer };
}

/** AAC packets from the first stream, contiguous from -D up to (not including) endFrame. */
function audioUpTo(endFrame: number, stream = 1): AudioPacket[] {
  const out: AudioPacket[] = [];
  for (let ts = -D; ts + AAC_FRAME <= endFrame; ts += AAC_FRAME) out.push({ tsFrames: ts, data: new Uint8Array([ts & 0xff]).buffer, stream });
  return out;
}

function source(packets: AudioPacket[]): AudioSource {
  return { packets, endFrame: packets.length ? packets[packets.length - 1].tsFrames + AAC_FRAME : -Infinity };
}

function sources(ring: GopRing, epochs: EpochInfo[], audio: AudioPacket[] | null): ClipSources {
  const map = new Map(epochs.map((e) => [e.epoch, e]));
  return { ring, epochInfo: (e) => map.get(e), audio: audio ? source(audio) : null, primingSamples: 2114 };
}

function ringWith(packets: VideoPacket[]): GopRing {
  const r = new GopRing({ ringSeconds: 60, byteBudget: 1e9 });
  for (const p of packets) r.push(p);
  return r;
}

const range = (from: number, to: number, epochOf: (i: number) => number = () => 0) =>
  Array.from({ length: to - from }, (_, k) => vpkt(from + k, epochOf(from + k)));

describe("assembleClip", () => {
  it("starts at the last keyframe at or before end - seconds and ends at the AAC watermark", () => {
    const ring = ringWith(range(0, 300)); // 10 s
    const audio = audioUpTo(9.7 * 48000); // audio lags video by 0.3 s (mixer latency and encoder lookahead)
    const { packets, transfer } = assembleClip({ requestId: "r1", seconds: 5 }, sources(ring, [epoch(0)], audio));
    const end = frameToUs(audio[audio.length - 1].tsFrames + AAC_FRAME);
    expect(packets.endUs).toBe(end);
    expect(packets.startUs).toBe(120 * F); // 4.0 s: the last key at or before 4.69 s
    expect(packets.video[0]).toMatchObject({ kind: "video", type: "key", tsUs: 120 * F, epoch: 0 });
    expect(packets.video.every((p) => p.tsUs < end)).toBe(true);
    expect(packets.video[packets.video.length - 1].tsUs + F).toBeGreaterThanOrEqual(end);
    expect(packets.coveredSec).toBeCloseTo((end - 120 * F) / 1e6, 9);
    expect(packets.cutToNewestEpoch).toBe(false);
    expect(packets.requestId).toBe("r1");
    expect(packets.primingSamples).toBe(2114);
    expect(Array.from(new Uint8Array(packets.audioConfig!.description))).toEqual([0x11, 0x90]);
    // Audio: the packet nearest the keyframe instant, plus one pre-roll packet.
    const nearest = nearestAudioIndex(audio, 120 * F);
    expect(packets.audio[0].tsUs).toBe(frameToUs(audio[nearest - 1].tsFrames));
    expect(packets.audio[1].tsUs).toBe(frameToUs(audio[nearest].tsFrames));
    expect(packets.audio.every((p) => p.kind === "audio" && p.type === "key" && p.durUs === 21_333)).toBe(true);
    // Every buffer is a fresh copy, and all of them are listed for transfer.
    expect(packets.video[0].data).not.toBe(ring.gops[4].packets[0].data);
    expect(new Uint8Array(packets.video[0].data)).toEqual(new Uint8Array(ring.gops[4].packets[0].data));
    expect(transfer).toHaveLength(packets.video.length + packets.audio.length + packets.videoEpochs.length + 1);
    expect(new Set(transfer).size).toBe(transfer.length);
    expect(packets.videoEpochs).toHaveLength(1);
    expect(packets.videoEpochs[0].description).not.toBe(epoch(0).description);
  });

  it("honors endAtUs", () => {
    const ring = ringWith(range(0, 300));
    const { packets } = assembleClip({ requestId: "r", seconds: 2, endAtUs: 5_000_000 }, sources(ring, [epoch(0)], audioUpTo(10 * 48000)));
    expect(packets.endUs).toBe(5_000_000);
    expect(packets.startUs).toBe(90 * F);
  });

  it("covers what the ring has when asked for more, and says the real length", () => {
    const ring = ringWith(range(0, 300));
    const { packets } = assembleClip({ requestId: "r", seconds: 30 }, sources(ring, [epoch(0)], null));
    expect(packets.startUs).toBe(0);
    expect(packets.endUs).toBe(300 * F);
    expect(packets.coveredSec).toBeCloseTo(10, 3);
    expect(packets.audio).toEqual([]);
    expect(packets.audioConfig).toBeNull();
  });

  it("splices identical epochs by packet copy", () => {
    const ring = ringWith(range(0, 300, (i) => (i < 150 ? 0 : 1)));
    const { packets } = assembleClip({ requestId: "r", seconds: 8 }, sources(ring, [epoch(0), epoch(1)], null));
    expect(packets.cutToNewestEpoch).toBe(false);
    // end - 8 s = 1,999,900 us; the keyframe at frame 60 is 1,999,980 us, just after it.
    expect(packets.startUs).toBe(30 * F);
    expect(packets.videoEpochs.map((e) => e.epoch)).toEqual([0, 1]);
  });

  it("cuts to the newest epoch when an older one has a different avcC, and reports the real length", () => {
    const ring = ringWith(range(0, 300, (i) => (i < 150 ? 0 : 1)));
    const { packets } = assembleClip({ requestId: "r", seconds: 8 }, sources(ring, [epoch(0, 0), epoch(1, 9)], null));
    expect(packets.cutToNewestEpoch).toBe(true);
    expect(packets.startUs).toBe(150 * F);
    expect(packets.coveredSec).toBeCloseTo((150 * F) / 1e6, 9);
    expect(packets.videoEpochs.map((e) => e.epoch)).toEqual([1]);
  });

  it("treats a coded-size change as a different epoch too", () => {
    const ring = ringWith(range(0, 300, (i) => (i < 150 ? 0 : 1)));
    const { packets } = assembleClip({ requestId: "r", seconds: 8 }, sources(ring, [epoch(0, 0, 720), epoch(1, 0, 640)], null));
    expect(packets.cutToNewestEpoch).toBe(true);
  });

  it("stops at the first different epoch even when an older one matches again", () => {
    const ring = ringWith(range(0, 270, (i) => (i < 90 ? 0 : i < 180 ? 1 : 2)));
    const { packets } = assembleClip({ requestId: "r", seconds: 9 }, sources(ring, [epoch(0, 0), epoch(1, 5), epoch(2, 0)], null));
    expect(packets.cutToNewestEpoch).toBe(true);
    expect(packets.startUs).toBe(180 * F);
  });

  it("cuts when an epoch's config is unknown", () => {
    const ring = ringWith(range(0, 120, (i) => (i < 60 ? 0 : 1)));
    const { packets } = assembleClip({ requestId: "r", seconds: 4 }, sources(ring, [epoch(1)], null));
    expect(packets.cutToNewestEpoch).toBe(true);
    expect(packets.startUs).toBe(60 * F);
  });

  it("stops in decode order at the first packet at or after the end (reordered output)", () => {
    const ring = ringWith([
      { ...vpkt(0), type: "key" },
      { ...vpkt(2), type: "delta" },
      { ...vpkt(1), type: "delta" },
      { ...vpkt(4), type: "delta" },
      { ...vpkt(3), type: "delta" },
    ]);
    const { packets } = assembleClip({ requestId: "r", seconds: 1, endAtUs: 3 * F + 1 }, sources(ring, [epoch(0)], null));
    expect(packets.video.map((p) => p.tsUs)).toEqual([0, 2 * F, 1 * F]);
  });

  it("returns an empty clip when there is no video", () => {
    const empty = assembleClip({ requestId: "e", seconds: 5 }, sources(ringWith([]), [], audioUpTo(48000)));
    expect(empty.packets).toMatchObject({ requestId: "e", video: [], audio: [], coveredSec: 0, audioConfig: null });
    expect(empty.transfer).toEqual([]);
  });

  it("keeps the video when the AAC encoder has no packets yet (still loading): no game sounds, said with a null config", () => {
    const ring = ringWith(range(0, 60)); // 2 s
    const { packets, transfer } = assembleClip({ requestId: "n", seconds: 5 }, sources(ring, [epoch(0)], []));
    expect(packets.endUs).toBe(60 * F);
    expect(packets.startUs).toBe(0);
    expect(packets.video).toHaveLength(60);
    expect(packets.audio).toEqual([]);
    expect(packets.audioConfig).toBeNull();
    expect(packets.coveredSec).toBeCloseTo(2, 3);
    expect(transfer).toHaveLength(60 + 1);
  });

  it("ends at the video end, with the audio it has, when the AAC watermark is far behind (a stall)", () => {
    const ring = ringWith(range(0, 300)); // 10 s
    const audio = audioUpTo(7 * 48000); // the AAC encoder stopped 3 s ago
    const { packets } = assembleClip({ requestId: "s", seconds: 5 }, sources(ring, [epoch(0)], audio));
    // The kid's moment (the last 3 s) is kept. Its sound is missing, not its picture.
    expect(packets.endUs).toBe(300 * F);
    expect(packets.startUs).toBe(120 * F);
    expect(packets.audioConfig).not.toBeNull();
    expect(packets.audio.length).toBeGreaterThan(90);
    expect(packets.audio[packets.audio.length - 1].tsUs + AAC_FRAME_US).toBeLessThanOrEqual(7e6 + 1);
    // Within the tolerance, the clip still ends at the watermark (plan 6.4).
    const near = audioUpTo(10 * 48000 - (AUDIO_END_TOLERANCE_US / 1e6) * 48000 + AAC_FRAME);
    const trimmed = assembleClip({ requestId: "t", seconds: 5 }, sources(ring, [epoch(0)], near)).packets;
    expect(trimmed.endUs).toBe(frameToUs(near[near.length - 1].tsFrames + AAC_FRAME));
    expect(trimmed.endUs).toBeLessThan(300 * F);
  });

  it("takes no audio when every AAC packet ends before the clip starts", () => {
    const ring = ringWith(range(0, 300));
    const { packets } = assembleClip({ requestId: "o", seconds: 2 }, sources(ring, [epoch(0)], audioUpTo(3 * 48000)));
    expect(packets.startUs).toBe(210 * F);
    expect(packets.audio).toEqual([]);
    expect(packets.audioConfig).toBeNull();
  });

  it("cuts to the newest epoch when two epochs differ only in the encoder's color space", () => {
    const ring = ringWith(range(0, 300, (i) => (i < 150 ? 0 : 1)));
    const bt709: VideoColorSpaceInit = { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false };
    const e0 = { ...epoch(0), colorSpace: bt709 };
    const e1 = { ...epoch(1), colorSpace: { ...bt709, matrix: "smpte170m" as const } };
    const { packets } = assembleClip({ requestId: "c", seconds: 8 }, sources(ring, [e0, e1], null));
    expect(packets.cutToNewestEpoch).toBe(true);
    expect(packets.videoEpochs).toEqual([expect.objectContaining({ epoch: 1, colorSpace: e1.colorSpace })]);
    expect(packets.videoEpochs[0].colorSpace).not.toBe(e1.colorSpace);
  });

  it("returns an empty clip when every GOP starts after the end", () => {
    const ring = ringWith(range(30, 90));
    const { packets } = assembleClip({ requestId: "r", seconds: 5, endAtUs: 10 * F }, sources(ring, [epoch(0)], null));
    expect(packets.video).toEqual([]);
    expect(packets.coveredSec).toBe(0);
  });
});

describe("audio selection", () => {
  const packets = audioUpTo(48000);

  it("finds the nearest packet on either side", () => {
    expect(nearestAudioIndex([], 0)).toBe(-1);
    expect(nearestAudioIndex(packets, -1e9)).toBe(0);
    expect(nearestAudioIndex(packets, 1e12)).toBe(packets.length - 1);
    const at = packets[10].tsFrames;
    expect(nearestAudioIndex(packets, frameToUs(at) + 1000)).toBe(10);
    expect(nearestAudioIndex(packets, frameToUs(at + 1000))).toBe(11);
  });

  it("adds one pre-roll packet and stops before the end", () => {
    const sel = selectAudio(packets, frameToUs(packets[10].tsFrames), frameToUs(packets[20].tsFrames));
    expect(sel.map((p) => p.tsFrames)).toEqual(packets.slice(9, 20).map((p) => p.tsFrames));
    expect(selectAudio(packets, -1e9, 1e12)).toHaveLength(packets.length);
    expect(selectAudio([], 0, 1)).toEqual([]);
  });
});

describe("RecordTee", () => {
  function harness(opts: { seed?: VideoPacket[] | null; audio?: AudioPacket[] | null; live?: boolean } = {}) {
    const posted: Array<{ msg: RecordTeeMsg; transfer: Transferable[] }> = [];
    let clock = 0;
    let live = opts.live ?? true;
    const audioList = opts.audio === undefined ? audioUpTo(0) : opts.audio;
    const audio = audioList ? { list: audioList, get packets() { return this.list; }, get endFrame() { return this.list.length ? this.list[this.list.length - 1].tsFrames + AAC_FRAME : -Infinity; } } : null;
    const tee = new RecordTee({
      recordingId: "rec-1",
      port: { postMessage: (msg, transfer) => posted.push({ msg, transfer }) },
      epochInfo: (e) => epoch(e),
      primingSamples: () => 2114,
      audio,
      seed: opts.seed ?? null,
      now: () => clock,
      live: () => live,
    });
    const addAudioUpTo = (endFrame: number) => {
      if (!audio) return;
      let ts = audio.list.length ? audio.list[audio.list.length - 1].tsFrames + AAC_FRAME : -D;
      for (; ts + AAC_FRAME <= endFrame; ts += AAC_FRAME) {
        const p = { tsFrames: ts, data: new ArrayBuffer(4), stream: 1 };
        audio.list.push(p);
        tee.onAudio(p);
      }
    };
    return { tee, posted, addAudioUpTo, advance: (ms: number) => (clock += ms), setLive: (v: boolean) => (live = v) };
  }

  const chunks = (posted: Array<{ msg: RecordTeeMsg }>) => posted.flatMap((p) => (p.msg.t === "chunk" ? [p.msg.packets] : []));
  /** The audio frame that ends at capture time us. */
  const frameAt = (us: number) => Math.ceil((us * 48000) / 1e6);

  it("starts at the open GOP's keyframe and posts one chunk per closed GOP", () => {
    const h = harness({ seed: range(60, 75) });
    for (let i = 75; i < 150; i++) {
      h.tee.onVideo(vpkt(i));
      h.addAudioUpTo(((i + 1) * F * 48000) / 1e6 - 4000);
    }
    const cs = chunks(h.posted);
    expect(cs.map((c) => c.startUs)).toEqual([60 * F, 90 * F]);
    expect(cs.every((c) => c.video[0].type === "key" && c.video.length === 30)).toBe(true);
    expect(cs[0].requestId).toBe("rec-1");
    expect(cs[0].videoEpochs.map((e) => e.epoch)).toEqual([0]);
    expect(cs[0].audioConfig).not.toBeNull();
    // Audio rides along. The ring did not reach the keyframe when the recording began, so the tee
    // waited: the first chunk starts one packet before the one nearest the keyframe.
    const firstAudio = cs[0].audio[0].tsUs;
    expect(firstAudio).toBeLessThanOrEqual(60 * F);
    expect(60 * F - firstAudio).toBeLessThan(21_334 + 21_334 / 2);
    expect(cs[0].audio[1].tsUs).toBeGreaterThanOrEqual(60 * F - 21_334 / 2);
    // No audio packet is sent twice, and none is skipped.
    const all = cs.flatMap((c) => c.audio.map((a) => a.tsUs));
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeGreaterThanOrEqual(21_333);
    expect(h.posted[0].transfer.length).toBeGreaterThan(30);
  });

  it("takes the start audio from the ring when the ring already covers the keyframe", () => {
    const h = harness({ seed: range(30, 40), audio: audioUpTo(2 * 48000) });
    h.tee.stop(40 * F, { wait: false });
    const a = chunks(h.posted)[0].audio;
    expect(a[0].tsUs).toBeLessThan(30 * F);
    expect(a[1].tsUs).toBeGreaterThanOrEqual(30 * F - 21_334 / 2);
    expect(a[1].tsUs).toBeLessThan(30 * F + 21_334 / 2);
  });

  it("waits for the first keyframe when the ring has none", () => {
    const h = harness();
    h.tee.onVideo(vpkt(5));
    h.tee.onVideo(vpkt(30));
    h.tee.onVideo(vpkt(31));
    h.tee.onVideo(vpkt(60));
    const cs = chunks(h.posted);
    expect(cs).toHaveLength(1);
    expect(cs[0].video.map((p) => p.tsUs)).toEqual([30 * F, 31 * F]);
  });

  it("on stop keeps taking the video tail and the audio up to the stop point, then posts one last chunk with both, then end", () => {
    const h = harness({ seed: range(0, 10) });
    h.addAudioUpTo(8000);
    // Frames 10 and 11 were given to the encoder before Stop; they are still inside it.
    let tailOut = false;
    h.tee.stop(12 * F, { videoTailDone: () => tailOut });
    expect(chunks(h.posted)).toHaveLength(0);
    expect(h.tee.finished).toBe(false);
    h.tee.onVideo(vpkt(10));
    h.tee.onVideo(vpkt(11));
    h.tee.onVideo(vpkt(12)); // after the stop point: not taken
    h.addAudioUpTo(frameAt(12 * F) + AAC_FRAME);
    expect(h.tee.tick()).toBe(false); // the audio is there, the video tail is not confirmed yet
    tailOut = true;
    expect(h.tee.tick()).toBe(true);
    const cs = chunks(h.posted);
    // One chunk: never an audio-only chunk (the io mux rejects a clip with no video).
    expect(cs).toHaveLength(1);
    expect(cs[0].video.map((p) => p.tsUs)).toEqual(range(0, 12).map((p) => p.tsUs));
    expect(cs[0].audio.length).toBeGreaterThan(0);
    expect(cs[0].audio.every((a) => a.tsUs < 12 * F)).toBe(true);
    expect(cs[0].audio[cs[0].audio.length - 1].tsUs + AAC_FRAME_US).toBeGreaterThanOrEqual(12 * F);
    expect(h.posted[h.posted.length - 1].msg).toEqual({ t: "end", recordingId: "rec-1", endUs: 12 * F });
  });

  it("does not wait for the audio the encoder keeps while paused (Stop from the pause menu)", () => {
    const h = harness({ seed: range(0, 10), live: false });
    // Paused: the mixer rendered up to its last whole block, and the encoder keeps its lookahead.
    h.addAudioUpTo(frameAt(10 * F) - 2114 - 1500);
    h.tee.stop(10 * F);
    expect(h.tee.finished).toBe(true);
    expect(chunks(h.posted)[0].video).toHaveLength(10);
    // The same short audio while live means the audio is late: wait for it.
    const g = harness({ seed: range(0, 10), live: true });
    g.addAudioUpTo(frameAt(10 * F) - 2114 - 1500);
    g.tee.stop(10 * F);
    expect(g.tee.finished).toBe(false);
    g.setLive(false);
    expect(g.tee.tick()).toBe(true);
  });

  it("ends after a timeout when the audio never catches up, and still posts the video", () => {
    const h = harness({ seed: range(0, 10) });
    h.tee.stop(10 * F);
    h.advance(TEE_TAIL_WAIT_MS - 1);
    expect(h.tee.tick()).toBe(false);
    h.advance(1);
    expect(h.tee.tick()).toBe(true);
    expect(chunks(h.posted)[0].video).toHaveLength(10);
    expect(h.posted[h.posted.length - 1].msg.t).toBe("end");
  });

  it("ends at once without audio, or when asked not to wait, and posts no chunk for a recording with no video", () => {
    const a = harness({ seed: range(0, 10), audio: null });
    a.tee.stop(10 * F);
    expect(a.tee.finished).toBe(true);
    expect(chunks(a.posted)[0].audioConfig).toBeNull();
    const b = harness({ seed: range(0, 10) });
    b.tee.stop(10 * F, { wait: false });
    expect(b.tee.finished).toBe(true);
    const c = harness();
    c.addAudioUpTo(48000);
    c.tee.stop(0);
    expect(c.posted.map((p) => p.msg.t)).toEqual(["end"]);
  });
});
