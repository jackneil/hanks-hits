import { describe, expect, it } from "vitest";
import { fakeAvcC } from "@/__tests__/webcodecs-mock";
import type { EpochInfo, RecordTeeMsg } from "../../../protocol";
import { AAC_FRAME, frameToUs, type AudioPacket } from "../audio/aac";
import { RecordTee, TEE_AUDIO_WAIT_MS, assembleClip, nearestAudioIndex, selectAudio, type AudioSource, type ClipSources } from "../clipAssembler";
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
    const audio = audioUpTo(9.5 * 48000); // audio lags video by 0.5 s
    const { packets, transfer } = assembleClip({ requestId: "r1", seconds: 5 }, sources(ring, [epoch(0)], audio));
    const end = frameToUs(audio[audio.length - 1].tsFrames + AAC_FRAME);
    expect(packets.endUs).toBe(end);
    expect(packets.startUs).toBe(120 * F); // 4.0 s: the last key at or before 4.49 s
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

  it("returns an empty clip when there is no video, or when audio has not started", () => {
    const empty = assembleClip({ requestId: "e", seconds: 5 }, sources(ringWith([]), [], audioUpTo(48000)));
    expect(empty.packets).toMatchObject({ requestId: "e", video: [], audio: [], coveredSec: 0 });
    const noAudioYet = assembleClip({ requestId: "n", seconds: 5 }, sources(ringWith(range(0, 60)), [epoch(0)], []));
    expect(noAudioYet.packets.coveredSec).toBe(0);
    expect(noAudioYet.packets.video).toEqual([]);
    expect(noAudioYet.transfer).toHaveLength(1); // the audio description
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
  function harness(opts: { seed?: VideoPacket[] | null; audio?: AudioPacket[] | null } = {}) {
    const posted: Array<{ msg: RecordTeeMsg; transfer: Transferable[] }> = [];
    let clock = 0;
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
    return { tee, posted, addAudioUpTo, advance: (ms: number) => (clock += ms) };
  }

  const chunks = (posted: Array<{ msg: RecordTeeMsg }>) => posted.flatMap((p) => (p.msg.t === "chunk" ? [p.msg.packets] : []));

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
    h.tee.stop(40 * F, false);
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

  it("on stop posts the partial GOP at once, then the last audio, then end", () => {
    const h = harness({ seed: range(0, 10) });
    h.addAudioUpTo(8000);
    h.tee.stop(10 * F);
    expect(chunks(h.posted)).toHaveLength(1);
    expect(h.tee.finished).toBe(false);
    h.tee.onVideo(vpkt(10)); // ignored after stop
    h.addAudioUpTo(30_000); // the watermark passes the stop point
    expect(h.tee.tick()).toBe(true);
    const cs = chunks(h.posted);
    expect(cs).toHaveLength(2);
    expect(cs[0].video).toHaveLength(10);
    expect(cs[1].video).toEqual([]);
    expect(cs[1].audio.every((a) => a.tsUs < 10 * F)).toBe(true);
    expect(h.posted[h.posted.length - 1].msg).toEqual({ t: "end", recordingId: "rec-1", endUs: 10 * F });
  });

  it("ends after a timeout when the audio never catches up", () => {
    const h = harness({ seed: range(0, 10) });
    h.tee.stop(10 * F);
    h.advance(TEE_AUDIO_WAIT_MS - 1);
    expect(h.tee.tick()).toBe(false);
    h.advance(1);
    expect(h.tee.tick()).toBe(true);
    expect(h.posted[h.posted.length - 1].msg.t).toBe("end");
  });

  it("ends at once without audio, or when asked not to wait", () => {
    const a = harness({ seed: range(0, 10), audio: null });
    a.tee.stop(10 * F);
    expect(a.tee.finished).toBe(true);
    expect(chunks(a.posted)[0].audioConfig).toBeNull();
    const b = harness({ seed: range(0, 10) });
    b.tee.stop(10 * F, false);
    expect(b.tee.finished).toBe(true);
    const c = harness();
    c.tee.stop(0);
    expect(c.posted.map((p) => p.msg.t)).toEqual(["end"]);
  });
});
