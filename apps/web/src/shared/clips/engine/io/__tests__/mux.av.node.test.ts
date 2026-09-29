// @vitest-environment node
/**
 * Real-media checks for mux + roll-group patch (plan 6.4 and 15.1, "Node" tier).
 *
 * The fixture is made here with ffmpeg: H.264 + AAC with a keyframe at every whole
 * second, and a white flash and a 1 kHz beep at every half second (0.5 s, 1.5 s, ...).
 * So every clip, also one cut at a keyframe, starts with silence, and every beep has
 * silence before it: the start of the clip (where priming and pre-roll mistakes show)
 * is measured like the rest. mediabunny demuxes the fixture into ClipPackets in the
 * encode worker's form (audio timestamps with the priming shift already applied,
 * protocol PacketDTO.tsUs), then the clip goes through muxClip and addAacRollGroups.
 * The checks:
 *   (a) ffmpeg decodes the clip with no errors;
 *   (b) the sgpd/sbgp boxes and their place in the audio stbl match ffmpeg's own
 *       "-c copy" output;
 *   (c) AVFoundation (the decoder of iPhone Photos and Messages) reads the beeps
 *       within 5 ms of the flashes. This needs macOS and swiftc, else it is skipped
 *       with the reason. Without the patch the same clip reads about -44 ms, which
 *       proves that the fixture shows the real problem (plan 3a);
 *   (d) ffmpeg reads the beeps within 5 ms of the flashes;
 *   (e) a player that ignores edit lists plays the sound at most 45 ms late (plan 6.4);
 *   (f) a control: the same clip with the priming applied a second time reads early
 *       in ffmpeg (-21 ms for ffmpeg AAC, -44 ms for Apple AAC), so (d) can see that
 *       defect.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClipPackets, PacketDTO } from "../../../protocol";
import { AVSYNC, FFMPEG_REASON, HAS_AAC_AT, TOOL_TIMEOUT_MS, avsyncOffsets, buildAvsync, ffmpegSync, run } from "../../__tests__/avTools";
import { type ContainerNode, type LeafNode, containerAt, readBoxes, readTree, writeTree } from "../boxes";
import { addAacRollGroups } from "../moovPatch";
import { muxClip } from "../mux";
import { hexBytes, toHex } from "./fixtures";

const TOLERANCE_MS = 5;
const IGNORE_EDITLIST_MAX_LATE_MS = 45;
const FIXTURE_SECONDS = 4;

function audioStbl(bytes: Uint8Array): ContainerNode {
  const moov = readTree(bytes, readBoxes(bytes).find((box) => box.type === "moov")!) as ContainerNode;
  for (const trak of moov.children) {
    if (trak.type !== "trak") continue;
    const mdia = containerAt(trak as ContainerNode, ["mdia"])!;
    const hdlr = mdia.children.find((child) => child.type === "hdlr") as LeafNode;
    if (String.fromCharCode(...hdlr.payload.subarray(8, 12)) === "soun") {
      return containerAt(trak as ContainerNode, ["mdia", "minf", "stbl"])!;
    }
  }
  throw new Error("no audio track");
}

/** Raw esds body the way WebKit's AudioEncoder returns it (bug 302253). */
const WEBKIT_RAW_ESDS = hexBytes("03808080220000000480808014401500000000000000000000000580808002119006808080010200");

interface Scenario {
  name: string;
  encoder: "aac" | "aac_at";
  /** Start the clip at the keyframe at this second (a cut from the middle of the ring). */
  cutSec: number;
  /** Replace the ASC with WebKit's raw esds bytes. */
  webkitDescription?: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "ffmpeg AAC, clip from the stream start", encoder: "aac", cutSec: 0 },
  { name: "ffmpeg AAC, clip cut at 1 s", encoder: "aac", cutSec: 1 },
  ...(HAS_AAC_AT
    ? ([
        { name: "Apple AAC (aac_at), clip from the stream start", encoder: "aac_at", cutSec: 0 },
        { name: "Apple AAC (aac_at), clip cut at 2 s, WebKit esds bug", encoder: "aac_at", cutSec: 2, webkitDescription: true },
      ] satisfies Scenario[])
    : []),
];

async function toClipPackets(source: Uint8Array, scenario: Scenario): Promise<ClipPackets> {
  const input = new Input({ formats: [MP4], source: new BufferSource(source) });
  try {
    const videoTrack = (await input.getPrimaryVideoTrack())!;
    const audioTrack = (await input.getPrimaryAudioTrack())!;
    const videoConfig = (await videoTrack.getDecoderConfig())!;
    const audioConfig = (await audioTrack.getDecoderConfig())!;
    const baseUs = 7_000_000; // The encode worker's timeline does not start at 0.
    const video: PacketDTO[] = [];
    let started = false;
    for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
      if (!started && (packet.type !== "key" || packet.timestamp < scenario.cutSec - 1e-6)) continue;
      started = true;
      video.push({
        kind: "video",
        type: packet.type,
        tsUs: baseUs + Math.round(packet.timestamp * 1e6),
        durUs: Math.round(packet.duration * 1e6),
        data: packet.data.slice().buffer,
        epoch: 4,
      });
    }
    const audioPackets = [];
    for await (const packet of new EncodedPacketSink(audioTrack).packets()) audioPackets.push(packet);
    // The demuxer applied the source's edit list, so the first packet is at -priming.
    const primingSamples = Math.round(-audioPackets[0].timestamp * 48000);
    // The encode worker's form (encode/clipAssembler.ts audioDto): the frame index of
    // the packet's first decoded sample, with the -P shift already in it, turned into
    // microseconds with frameToUs. The demuxed timestamps are exactly that.
    const frameToUs = (frame: number) => Math.round((frame * 1e6) / 48000);
    const audio: PacketDTO[] = audioPackets.map((packet) => ({
      kind: "audio",
      type: "key",
      tsUs: baseUs + frameToUs(Math.round(packet.timestamp * 48000)),
      durUs: frameToUs(1024),
      data: packet.data.slice().buffer,
      epoch: 0,
    }));
    const description = scenario.webkitDescription
      ? WEBKIT_RAW_ESDS.slice().buffer
      : new Uint8Array(audioConfig.description as ArrayBuffer).slice().buffer;
    return {
      requestId: scenario.name,
      video,
      audio,
      videoEpochs: [
        {
          epoch: 4,
          codec: videoConfig.codec,
          codedWidth: videoConfig.codedWidth!,
          codedHeight: videoConfig.codedHeight!,
          description: new Uint8Array(videoConfig.description as ArrayBuffer).slice().buffer,
        },
      ],
      audioConfig: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, description },
      primingSamples,
      startUs: video[0].tsUs,
      endUs: baseUs + FIXTURE_SECONDS * 1e6,
      cutToNewestEpoch: false,
      coveredSec: FIXTURE_SECONDS - scenario.cutSec,
    };
  } finally {
    input.dispose();
  }
}

describe.skipIf(!!FFMPEG_REASON)(`mux + roll-group patch on real media${FFMPEG_REASON ? ` (skipped: ${FFMPEG_REASON})` : ""}`, () => {
  let dir = "";
  const fixtures = new Map<string, string>();
  let avsyncBinary: string | null = null;
  let avsyncBuildError = "";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "hh-clips-io-"));
    // Keyframes stay at whole seconds (-g 30); the flash and the beep are at x.5 s.
    const flash = "color=c=black:s=320x240:r=30:d=4,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(mod(n\\,30)\\,15)',format=yuv420p";
    const tone = "if(gte(mod(t\\,1)\\,0.5)*lt(mod(t\\,1)\\,0.55)\\,0.6*sin(2*PI*1000*t)\\,0)";
    for (const encoder of new Set(SCENARIOS.map((scenario) => scenario.encoder))) {
      const out = path.join(dir, `source-${encoder}.mp4`);
      const made = run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", flash,
        "-f", "lavfi", "-i", `aevalsrc=exprs='${tone}|${tone}':s=48000:d=${FIXTURE_SECONDS}`,
        "-c:v", "libx264", "-preset", "veryfast", "-g", "30", "-keyint_min", "30", "-bf", "0", "-sc_threshold", "0",
        "-profile:v", "high", "-c:a", encoder, "-b:a", "128k", "-shortest", out,
      ]);
      if (made.status !== 0) throw new Error(`ffmpeg could not make the ${encoder} fixture: ${made.stderr}`);
      fixtures.set(encoder, out);
    }
    if (AVSYNC.source) {
      const built = buildAvsync();
      avsyncBinary = built.binary;
      avsyncBuildError = built.error;
    }
  }, 300_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const avsync = (file: string): number[] => avsyncOffsets(avsyncBinary!, file);

  describe.each(SCENARIOS)("$name", (scenario) => {
    let unpatched = "";
    let patched = "";
    let patchedBytes: Uint8Array = new Uint8Array();
    let expectedFlashes = 0;

    beforeAll(async () => {
      const source = new Uint8Array(readFileSync(fixtures.get(scenario.encoder)!));
      const clip = await toClipPackets(source, scenario);
      const muxed = await muxClip(clip);
      expect(muxed.audioConfigRebuilt).toBe(!!scenario.webkitDescription);
      const result = addAacRollGroups(muxed.bytes);
      expect(result.patchedTracks).toBe(1);
      patchedBytes = result.bytes;
      const slug = `${scenario.encoder}-${scenario.cutSec}`;
      unpatched = path.join(dir, `unpatched-${slug}.mp4`);
      patched = path.join(dir, `patched-${slug}.mp4`);
      writeFileSync(unpatched, muxed.bytes);
      writeFileSync(patched, patchedBytes);
      expectedFlashes = FIXTURE_SECONDS - scenario.cutSec;
    }, 120_000);

    it("(a) ffmpeg decodes the whole clip with no errors", () => {
      const decode = run("ffmpeg", ["-v", "error", "-i", patched, "-f", "null", "-"]);
      expect(decode.status).toBe(0);
      expect(decode.stderr.trim()).toBe("");
      const probe = run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", patched]);
      expect(probe.status).toBe(0);
      expect(probe.stderr.trim()).toBe("");
      expect(probe.stdout.trim().split("\n")).toEqual(["h264", "aac"]);
    }, TOOL_TIMEOUT_MS);

    it("(b) sgpd and sbgp match ffmpeg's -c copy output, in the same place", () => {
      const remux = path.join(dir, `ffmpeg-remux-${scenario.encoder}-${scenario.cutSec}.mp4`);
      const copy = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", unpatched, "-c", "copy", "-movflags", "+faststart", remux]);
      expect(copy.status).toBe(0);
      const ours = audioStbl(patchedBytes);
      const theirs = audioStbl(new Uint8Array(readFileSync(remux)));
      const types = (stbl: ContainerNode) => stbl.children.map((child) => child.type);
      expect(types(ours)).toEqual(types(theirs));
      expect(types(ours).slice(-2)).toEqual(["sgpd", "sbgp"]);
      for (const type of ["sgpd", "sbgp"]) {
        const mine = ours.children.find((child) => child.type === type)!;
        const ffmpeg = theirs.children.find((child) => child.type === type)!;
        expect(toHex(writeTree(mine))).toBe(toHex(writeTree(ffmpeg)));
      }
    }, TOOL_TIMEOUT_MS);

    it.skipIf(!AVSYNC.source)(
      `(c) AVFoundation reads the sound within ${TOLERANCE_MS} ms of the picture${AVSYNC.reason ? ` (skipped: ${AVSYNC.reason})` : ""}`,
      (context) => {
        if (!avsyncBinary) context.skip(avsyncBuildError || "avsync did not build");
        const withPatch = avsync(patched);
        expect(withPatch.length).toBe(expectedFlashes);
        for (const offset of withPatch) expect(Math.abs(offset)).toBeLessThanOrEqual(TOLERANCE_MS);
        // Control: the same clip without the roll group reads about -44 ms in
        // AVFoundation (plan 3a). If this starts to fail, Apple changed AVFoundation:
        // measure again before the patch is removed.
        const withoutPatch = avsync(unpatched);
        expect(Math.max(...withoutPatch.map(Math.abs))).toBeGreaterThan(20);
      },
      120_000,
    );

    it(`(d) ffmpeg reads the sound within ${TOLERANCE_MS} ms of the picture`, () => {
      const sync = ffmpegSync(patched);
      expect(sync.flashes.length).toBe(expectedFlashes);
      // Every beep is measured, the first one included: none is made up.
      expect(sync.beeps.length).toBe(sync.flashes.length);
      for (const pair of sync.pairs) expect(Math.abs(pair.ms)).toBeLessThanOrEqual(TOLERANCE_MS);
    }, TOOL_TIMEOUT_MS);

    it(`(e) a player that ignores edit lists plays the sound at most ${IGNORE_EDITLIST_MAX_LATE_MS} ms late`, () => {
      const sync = ffmpegSync(patched, true);
      expect(sync.flashes.length).toBe(expectedFlashes);
      expect(sync.beeps.length).toBe(sync.flashes.length);
      for (const pair of sync.pairs) {
        expect(pair.ms).toBeGreaterThanOrEqual(-TOLERANCE_MS);
        expect(pair.ms).toBeLessThanOrEqual(IGNORE_EDITLIST_MAX_LATE_MS);
      }
    }, TOOL_TIMEOUT_MS);

    it("(f) control: shifting the audio by primingSamples a second time puts the sound early in ffmpeg", async () => {
      // The defect this module must never have again (protocol PacketDTO.tsUs): a
      // muxer that shifts the encode worker's timestamps by the priming again.
      const source = new Uint8Array(readFileSync(fixtures.get(scenario.encoder)!));
      const clip = await toClipPackets(source, scenario);
      const shiftUs = Math.round((clip.primingSamples * 1e6) / 48000);
      const twice = { ...clip, audio: clip.audio.map((packet) => ({ ...packet, tsUs: packet.tsUs - shiftUs })) };
      const wrong = path.join(dir, `twice-${scenario.encoder}-${scenario.cutSec}.mp4`);
      writeFileSync(wrong, addAacRollGroups((await muxClip(twice)).bytes).bytes);
      const sync = ffmpegSync(wrong);
      expect(sync.pairs.length).toBeGreaterThan(0);
      for (const pair of sync.pairs) expect(pair.ms).toBeLessThan(-(TOLERANCE_MS + 10));
    }, TOOL_TIMEOUT_MS);
  });
});
