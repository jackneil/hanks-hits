// @vitest-environment node
import { BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";
import { describe, expect, it } from "vitest";
import type { PacketDTO } from "../../../protocol";
import { type ContainerNode, type LeafNode, containerAt, readBoxes, readTree, readU32 } from "../boxes";
import { describeBoxes } from "../moovPatch";
import { MuxError, muxClip, planAudio, planVideo, sameVideoConfig, videoEpochFor } from "../mux";
import { AVCC_64_OTHER_HEX, epochInfo, hexBytes, makeClipPackets, toHex } from "./fixtures";

async function demux(bytes: Uint8Array) {
  const input = new Input({ formats: [MP4], source: new BufferSource(bytes) });
  const video = (await input.getPrimaryVideoTrack())!;
  const audio = await input.getPrimaryAudioTrack();
  const videoPackets = [];
  for await (const packet of new EncodedPacketSink(video).packets()) videoPackets.push(packet);
  const audioPackets = [];
  if (audio) for await (const packet of new EncodedPacketSink(audio).packets()) audioPackets.push(packet);
  return {
    input,
    videoConfig: (await video.getDecoderConfig())!,
    audioConfig: audio ? await audio.getDecoderConfig() : null,
    videoPackets,
    audioPackets,
    videoDuration: await video.computeDuration(),
  };
}

/** The elst entries (segment duration, media time) of the track with this handler. */
function editList(bytes: Uint8Array, handler: string): Array<[number, number]> | null {
  const moovInfo = readBoxes(bytes).find((box) => box.type === "moov")!;
  const moov = readTree(bytes, moovInfo) as ContainerNode;
  for (const trak of moov.children) {
    if (trak.type !== "trak") continue;
    const hdlr = (containerAt(trak as ContainerNode, ["mdia"])!.children.find((c) => c.type === "hdlr") as LeafNode).payload;
    if (String.fromCharCode(...hdlr.subarray(8, 12)) !== handler) continue;
    const edts = containerAt(trak as ContainerNode, ["edts"]);
    if (!edts) return null;
    const elst = (edts.children[0] as LeafNode).payload;
    const version = elst[0];
    const count = readU32(elst, 4);
    const entries: Array<[number, number]> = [];
    let offset = 8;
    for (let i = 0; i < count; i++) {
      if (version === 1) throw new Error("64-bit elst not expected here");
      entries.push([readU32(elst, offset), readU32(elst, offset + 4) | 0]);
      offset += 12;
    }
    return entries;
  }
  throw new Error(`no ${handler} track`);
}

describe("videoEpochFor", () => {
  it("uses the epoch of the first video packet", () => {
    const clip = makeClipPackets({ epoch: epochInfo(3) });
    expect(videoEpochFor(clip).epoch).toBe(3);
  });

  it("accepts packets from another epoch with byte-identical avcC and size", () => {
    const clip = makeClipPackets();
    clip.videoEpochs.push({ ...epochInfo(1), description: epochInfo(0).description.slice(0) });
    clip.video.slice(30).forEach((packet) => (packet.epoch = 1));
    expect(videoEpochFor(clip).epoch).toBe(0);
  });

  it("refuses packets from an epoch with a different avcC (one track never spans two configs)", () => {
    const clip = makeClipPackets();
    clip.videoEpochs.push(epochInfo(1, AVCC_64_OTHER_HEX));
    clip.video.slice(30).forEach((packet) => (packet.epoch = 1));
    expect(() => videoEpochFor(clip)).toThrow(expect.objectContaining({ code: "mixed-epochs" }));
  });

  it("refuses a different coded size even with the same avcC", () => {
    const a = epochInfo(0);
    expect(sameVideoConfig(a, { ...a, codedWidth: 128 })).toBe(false);
    expect(sameVideoConfig(a, { ...a, codec: "avc1.42001f" })).toBe(false);
    expect(sameVideoConfig(a, { ...a, epoch: 9 })).toBe(true);
  });

  it("refuses a clip with no video, a delta first packet, or an unknown epoch", () => {
    const empty = makeClipPackets();
    empty.video = [];
    expect(() => videoEpochFor(empty)).toThrow(expect.objectContaining({ code: "no-video" }));
    const delta = makeClipPackets();
    delta.video.shift();
    expect(() => videoEpochFor(delta)).toThrow(expect.objectContaining({ code: "first-not-key" }));
    const unknown = makeClipPackets();
    unknown.video[0].epoch = 7;
    expect(() => videoEpochFor(unknown)).toThrow(expect.objectContaining({ code: "unknown-epoch" }));
    const unknownLater = makeClipPackets();
    unknownLater.video[5].epoch = 8;
    expect(() => videoEpochFor(unknownLater)).toThrow(expect.objectContaining({ code: "unknown-epoch" }));
  });
});

describe("planVideo", () => {
  it("rebases the first packet to 0 and keeps decode order", () => {
    const clip = makeClipPackets({ seconds: 1, baseUs: 12_345_678 });
    const plan = planVideo(clip.video);
    expect(plan.packets[0].timestamp).toBe(0);
    expect(plan.packets[1].timestamp).toBeCloseTo(1 / 30, 6);
    expect(plan.endSec).toBeCloseTo(1, 6);
  });

  it("uses the latest packet end, not the last packet in decode order", () => {
    const video: PacketDTO[] = [
      { kind: "video", type: "key", tsUs: 0, durUs: 10_000, data: new ArrayBuffer(4), epoch: 0 },
      { kind: "video", type: "delta", tsUs: 30_000, durUs: 10_000, data: new ArrayBuffer(4), epoch: 0 },
      { kind: "video", type: "delta", tsUs: 10_000, durUs: 10_000, data: new ArrayBuffer(4), epoch: 0 },
    ];
    expect(planVideo(video).endSec).toBeCloseTo(0.04, 9);
  });

  it("refuses bad timestamps and empty packets", () => {
    const base = makeClipPackets({ seconds: 1 }).video;
    expect(() => planVideo([{ ...base[0], durUs: -1 }])).toThrow(MuxError);
    expect(() => planVideo([{ ...base[0], tsUs: Number.NaN }])).toThrow(MuxError);
    expect(() => planVideo([{ ...base[0], data: new ArrayBuffer(0) }])).toThrow(expect.objectContaining({ code: "bad-packet" }));
  });
});

describe("planAudio", () => {
  const frameUs = (n: number) => Math.round((n * 1024 * 1e6) / 48000);
  const audioAt = (starts: number[]): PacketDTO[] =>
    starts.map((tsUs, i) => ({
      kind: "audio",
      type: "key",
      tsUs,
      durUs: 21333,
      data: new Uint8Array([i + 1]).buffer,
      epoch: 0,
    }));

  it("uses the timestamps as they are (the encode worker applied the priming) and keeps one pre-roll packet", () => {
    // The encode worker's form with 2112 samples of priming: packet n starts at
    // n * 1024 - 2112 samples, that is packet start - 44 ms.
    const audio = audioAt([0, 1, 2, 3, 4, 5].map((n) => frameUs(n) - 44000));
    const plan = planAudio(audio, 0, 48000, 10);
    // Packet 2 ends at +20 ms (the first played packet). Packet 1 is the pre-roll.
    expect(plan.map((p) => p.packet.tsUs)).toEqual([1, 2, 3, 4, 5].map((n) => frameUs(n) - 44000));
    expect(plan[0].timestamp).toBeCloseTo((frameUs(1) - 44000) / 1e6, 9);
  });

  it("never moves a packet by the priming a second time", () => {
    // A packet at the video start plays at 0, whatever the stream's priming was.
    const plan = planAudio(audioAt([0, 21333]), 0, 48000, 10);
    expect(plan.map((p) => p.timestamp)).toEqual([0, 0.021333]);
  });

  it("keeps the first packet as pre-roll when it ends exactly at 0 (priming 1024)", () => {
    const audio = audioAt([0, 1, 2].map((n) => frameUs(n) - frameUs(1)));
    const plan = planAudio(audio, 0, 48000, 10);
    expect(plan.map((p) => p.packet.tsUs)).toEqual([0, 1, 2].map((n) => frameUs(n) - frameUs(1)));
  });

  it("drops packets that start at or after the video end", () => {
    const audio = audioAt([0, 1, 2, 3, 4].map(frameUs));
    const plan = planAudio(audio, 0, 48000, frameUs(3) / 1e6);
    expect(plan.map((p) => p.packet.tsUs)).toEqual([0, 1, 2].map(frameUs));
  });

  it("sorts packets by time and drops exact repeats", () => {
    const audio = audioAt([frameUs(2), frameUs(0), frameUs(1), frameUs(1)]);
    const plan = planAudio(audio, 0, 48000, 10);
    expect(plan.map((p) => p.packet.tsUs)).toEqual([0, 1, 2].map(frameUs));
  });

  it("returns no packets when none reaches the picture", () => {
    expect(planAudio(audioAt([-500_000, -400_000]), 0, 48000, 10)).toEqual([]);
  });

  it("measures time from the first video packet", () => {
    const plan = planAudio(audioAt([5_000_000, 5_021_333]), 5_000_000, 48000, 10);
    expect(plan[0].timestamp).toBe(0);
  });
});

describe("muxClip", () => {
  it("writes a fast-start MP4 with video at 0 and an audio edit list for the priming", async () => {
    const clip = makeClipPackets({ seconds: 2, primingSamples: 2114, audioLeadUs: 0 });
    const result = await muxClip(clip);
    expect(readBoxes(result.bytes).map((box) => box.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(result.hasAudio).toBe(true);
    expect(result.videoDurationSec).toBeCloseTo(2, 6);

    const file = await demux(result.bytes);
    expect(file.videoPackets.length).toBe(60);
    expect(file.videoPackets[0].timestamp).toBe(0);
    expect(file.videoPackets[0].type).toBe("key");
    expect(file.videoPackets[30].type).toBe("key");
    expect(file.videoPackets[1].type).toBe("delta");
    expect(file.videoDuration).toBeCloseTo(2, 3);
    // Same packet bytes as the input.
    expect(toHex(file.videoPackets[7].data)).toBe(toHex(new Uint8Array(clip.video[7].data)));

    // No video edit list. The audio edit list hides the priming and pre-roll:
    // the first kept packet is 1024 samples after the stream start (2114 - 2048 = 66
    // samples into packet 2 is time 0), so media_time = 2114 - 1024 = 1090 samples.
    expect(editList(result.bytes, "vide")).toBeNull();
    const audioEdit = editList(result.bytes, "soun")!;
    expect(audioEdit.length).toBe(1);
    expect(audioEdit[0][1]).toBe(1090);
    expect(file.audioPackets[0].timestamp).toBeCloseTo(-1090 / 48000, 4);
    file.input.dispose();
  });

  it("gives the same file for any primingSamples value: the timestamps alone set the edit list", async () => {
    const clip = makeClipPackets({ seconds: 1, primingSamples: 2114, audioLeadUs: 0 });
    const same = await muxClip(clip);
    const other = await muxClip({ ...clip, primingSamples: 1024 });
    expect(toHex(other.bytes)).toBe(toHex(same.bytes));
    expect(editList(same.bytes, "soun")![0][1]).toBe(1090);
  });

  it("uses the decoder config of the first epoch and the valid ASC", async () => {
    const result = await muxClip(makeClipPackets());
    const file = await demux(result.bytes);
    expect(file.videoConfig.codec).toBe("avc1.64000a");
    expect(file.videoConfig.codedWidth).toBe(64);
    expect(toHex(new Uint8Array(file.videoConfig.description as ArrayBuffer))).toBe(
      toHex(new Uint8Array(epochInfo().description)),
    );
    expect(toHex(new Uint8Array(file.audioConfig!.description as ArrayBuffer))).toBe("1190");
    expect(file.audioConfig!.sampleRate).toBe(48000);
    expect(file.audioConfig!.numberOfChannels).toBe(2);
    expect(result.audioConfigRebuilt).toBe(false);
    file.input.dispose();
  });

  it("rebuilds WebKit's broken description, so the file has sound on every player", async () => {
    const broken = hexBytes("0380808022000000048080801440150000000000000000000000058080800211900680808001020000").buffer;
    const result = await muxClip(makeClipPackets({ audioDescription: broken }));
    expect(result.audioConfigRebuilt).toBe(true);
    const file = await demux(result.bytes);
    expect(toHex(new Uint8Array(file.audioConfig!.description as ArrayBuffer))).toBe("1190");
    file.input.dispose();
  });

  it("writes no tags: no udta or meta box anywhere", async () => {
    const result = await muxClip(makeClipPackets());
    const boxes = describeBoxes(result.bytes);
    expect(boxes.some((path) => path.endsWith("/udta") || path.endsWith("/meta"))).toBe(false);
  });

  it("writes a video-only file when the clip has no audio", async () => {
    const result = await muxClip(makeClipPackets({ audio: false }));
    expect(result.hasAudio).toBe(false);
    const file = await demux(result.bytes);
    expect(file.audioConfig).toBeNull();
    file.input.dispose();
  });

  it("writes a video-only file when no audio packet reaches the picture", async () => {
    const clip = makeClipPackets({ seconds: 1 });
    clip.audio = clip.audio.filter((packet) => packet.tsUs < clip.video[0].tsUs - 200_000);
    const result = await muxClip(clip);
    expect(result.hasAudio).toBe(false);
  });

  it("does not let sound run past the end of the picture", async () => {
    const result = await muxClip(makeClipPackets({ seconds: 1, primingSamples: 0 }));
    const file = await demux(result.bytes);
    const lastAudio = file.audioPackets[file.audioPackets.length - 1];
    expect(lastAudio.timestamp).toBeLessThan(1);
    file.input.dispose();
  });

  it("returns the first keyframe and its epoch for the poster", async () => {
    const clip = makeClipPackets();
    const result = await muxClip(clip);
    expect(result.firstKey).toBe(clip.video[0]);
    expect(result.epoch).toBe(clip.videoEpochs[0]);
  });

  it("throws a typed MuxError for bad input", async () => {
    const clip = makeClipPackets();
    clip.video = [];
    await expect(muxClip(clip)).rejects.toMatchObject({ name: "MuxError", code: "no-video" });
    const badRate = makeClipPackets();
    badRate.audioConfig!.sampleRate = 0;
    await expect(muxClip(badRate)).rejects.toMatchObject({ code: "bad-audio-config" });
  });

  it("wraps a muxer failure as a MuxError", async () => {
    const clip = makeClipPackets();
    // mediabunny rejects a codec string that is not in its registry.
    clip.videoEpochs[0] = { ...clip.videoEpochs[0], codec: "nope" };
    await expect(muxClip(clip)).rejects.toMatchObject({ code: "muxer" });
  });
});
