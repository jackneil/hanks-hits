// @vitest-environment node
/**
 * A clip's poster on a real-shaped clip (Wave C ui25): the tile and the viewer
 * cover show the moment the kid clipped, never the dim first frame.
 *
 * The fixture is made here with ffmpeg: 30 s of H.264 at 30 fps, a keyframe
 * at every whole second, no B-frames, and a picture whose brightness says
 * its time (luma = 8 x seconds). It is demuxed into ClipPackets in the encode
 * worker's form and stored by the real io handler (real mux, real library on
 * the OPFS double). The poster step gets a spy that keeps the keyframe it was
 * given; ffmpeg then decodes exactly that keyframe, and its brightness says
 * which second of the clip the poster shows. The same rule holds for a stored
 * file that the library finds without a row (posterPacketOf).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createOpfsMock } from "../../../../../__tests__/opfs-mock";
import type { StorageLike } from "../../../library/fsTypes";
import { ClipLibrary } from "../../../library/opfsStore";
import type { ClipMeta, ClipPackets, IoCmd, IoEvent, MomentMark, PacketDTO } from "../../../protocol";
import { FFMPEG_REASON, run } from "../../__tests__/avTools";
import { createIoHandler } from "../ioHandler";
import { PLACEHOLDER_POSTER, posterPacketOf } from "../poster";

const SECONDS = 30;
const SIZE = 64;
/** Luma per second of the fixture (geq lum = 8 x T). */
const LUMA_PER_SEC = 8;

/** Annex B bytes of one AVCC sample, with the SPS and PPS of its avcC first, for ffmpeg's raw h264 reader. */
function annexB(sample: Uint8Array, avcc: Uint8Array): Uint8Array {
  const start = [0, 0, 0, 1];
  const out: number[] = [];
  const lengthSize = (avcc[4] & 3) + 1;
  let at = 5;
  const sets = (count: number) => {
    for (let i = 0; i < count; i++) {
      const length = (avcc[at] << 8) | avcc[at + 1];
      at += 2;
      out.push(...start, ...avcc.subarray(at, at + length));
      at += length;
    }
  };
  sets(avcc[at++] & 0x1f);
  sets(avcc[at++]);
  for (let p = 0; p + lengthSize <= sample.length; ) {
    let length = 0;
    for (let k = 0; k < lengthSize; k++) length = length * 256 + sample[p + k];
    p += lengthSize;
    out.push(...start, ...sample.subarray(p, p + length));
    p += length;
  }
  return Uint8Array.from(out);
}

describe.skipIf(!!FFMPEG_REASON)(`clip posters on a real-shaped clip${FFMPEG_REASON ? ` (skipped: ${FFMPEG_REASON})` : ""}`, () => {
  let dir = "";
  let clip: ClipPackets;
  let avcc: Uint8Array;
  const libraries: ClipLibrary[] = [];

  /** The second of the clip that a keyframe shows: ffmpeg decodes it, and its mean luma says the time. */
  const secondOf = (keyframe: Uint8Array): number => {
    const input = path.join(dir, `key-${Math.random().toString(36).slice(2)}.h264`);
    const output = `${input}.yuv`;
    writeFileSync(input, annexB(keyframe, avcc));
    const decoded = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "h264", "-i", input, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "yuv420p", output]);
    if (decoded.status !== 0) throw new Error(`ffmpeg could not decode the poster keyframe: ${decoded.stderr}`);
    const luma = new Uint8Array(readFileSync(output)).subarray(0, SIZE * SIZE);
    const mean = luma.reduce((sum, v) => sum + v, 0) / luma.length;
    return mean / LUMA_PER_SEC;
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "hh-clips-poster-"));
    const source = path.join(dir, "source.mp4");
    const made = run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=black:s=${SIZE}x${SIZE}:r=30:d=${SECONDS},geq=lum='${LUMA_PER_SEC}*T':cb=128:cr=128,format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-g", "30", "-keyint_min", "30", "-bf", "0", "-sc_threshold", "0",
      "-profile:v", "high", source,
    ]);
    if (made.status !== 0) throw new Error(`ffmpeg could not make the fixture: ${made.stderr}`);
    const input = new Input({ formats: [MP4], source: new BufferSource(new Uint8Array(readFileSync(source))) });
    try {
      const track = (await input.getPrimaryVideoTrack())!;
      const config = (await track.getDecoderConfig())!;
      avcc = new Uint8Array(config.description as ArrayBuffer).slice();
      // The encode worker's timeline does not start at 0.
      const baseUs = 7_000_000;
      const video: PacketDTO[] = [];
      for await (const packet of new EncodedPacketSink(track).packets()) {
        video.push({
          kind: "video",
          type: packet.type,
          tsUs: baseUs + Math.round(packet.timestamp * 1e6),
          durUs: Math.round(packet.duration * 1e6),
          data: packet.data.slice().buffer,
          epoch: 4,
        });
      }
      clip = {
        requestId: "poster",
        video,
        audio: [],
        videoEpochs: [{ epoch: 4, codec: config.codec, codedWidth: config.codedWidth!, codedHeight: config.codedHeight!, description: avcc.slice().buffer }],
        audioConfig: null,
        primingSamples: 0,
        startUs: baseUs,
        endUs: baseUs + SECONDS * 1e6,
        cutToNewestEpoch: false,
        coveredSec: SECONDS,
      };
    } finally {
      input.dispose();
    }
    // The control: the fixture really is dim at the start and bright at the end.
    expect(secondOf(new Uint8Array(clip.video[0].data))).toBeLessThan(2);
  });

  afterEach(() => {
    libraries.splice(0).forEach((lib) => lib.close());
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** Stores the clip through the real io handler and gives the keyframe the poster step got, and the stored file. */
  const store = async (id: string, moments: MomentMark[]) => {
    const mock = createOpfsMock();
    const factory = new IDBFactory();
    const events: IoEvent[] = [];
    const given: Uint8Array[] = [];
    const handler = createIoHandler({
      post: (event) => events.push(event),
      openLibrary: async () => {
        const lib = await ClipLibrary.open({ storage: mock.storage as unknown as StorageLike, indexedDB: factory, keyRange: IDBKeyRange, locks: null, channel: null });
        libraries.push(lib);
        return lib;
      },
      poster: async (keyframe) => {
        given.push(new Uint8Array(keyframe instanceof Uint8Array ? keyframe : new Uint8Array(keyframe)).slice());
        return PLACEHOLDER_POSTER;
      },
    });
    const meta: ClipMeta = {
      id,
      ownerKey: "guest",
      gameId: "asteroids",
      kind: "clip",
      createdAt: Date.UTC(2026, 8, 29, 12),
      durationMs: SECONDS * 1000,
      width: SIZE,
      height: SIZE,
      fps: 30,
      hasAudio: false,
      mime: "video/mp4",
      kept: false,
      watched: false,
      moments,
    };
    const packets: ClipPackets = { ...clip, video: clip.video.slice() };
    await handler.handle({ t: "mux", packets, meta } as IoCmd);
    expect(events.find((e) => e.t === "error")).toBeUndefined();
    expect(given).toHaveLength(1);
    return { keyframe: given[0], file: mock.readFile(`lib/guest/${id}.mp4`)! };
  };

  it("a 30 s clip's poster shows the moment the kid clipped (the last keyframe 1 s before the end), not its first frame", async () => {
    const { keyframe } = await store("c1", []);
    expect(Math.abs(secondOf(keyframe) - (SECONDS - 1))).toBeLessThan(0.5);
  });

  it("a clip with a featured moment in it shows that moment", async () => {
    const featured: MomentMark = { kind: "new-best", label: "New best!", emoji: "🏆", priority: "featured", offsetSec: 12.4 };
    const standard: MomentMark = { kind: "custom", label: "Star", emoji: "⭐", priority: "standard", offsetSec: 25 };
    const { keyframe } = await store("c2", [featured, standard]);
    expect(Math.abs(secondOf(keyframe) - 12)).toBeLessThan(0.5);
  });

  it("a stored file found without a row gets the same poster keyframe", async () => {
    const { file } = await store("c3", []);
    const input = new Input({ formats: [MP4], source: new BufferSource(file) });
    try {
      const packet = (await posterPacketOf((await input.getPrimaryVideoTrack())!))!;
      expect(packet.type).toBe("key");
      expect(Math.abs(secondOf(packet.data) - (SECONDS - 1))).toBeLessThan(0.5);
    } finally {
      input.dispose();
    }
  });
});
