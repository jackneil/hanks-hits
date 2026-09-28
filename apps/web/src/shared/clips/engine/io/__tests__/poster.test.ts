// @vitest-environment node
/**
 * Poster tests. VideoDecoder, EncodedVideoChunk and OffscreenCanvas do not exist in
 * Node, so the poster step gets small fakes through its deps option. The fakes act
 * like the real APIs where the poster code depends on them: isConfigSupported is
 * async, output comes asynchronously (some hardware decoders hold the frame until
 * flush), a delta first chunk is a decode error, frames must be closed, and
 * convertToBlob can return a PNG when JPEG is not supported.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLACEHOLDER_POSTER,
  POSTER_MAX_WIDTH,
  type PosterDeps,
  bytesToBase64,
  makePoster,
  makePosterFromMp4,
  posterSize,
  stripJpegMetadata,
} from "../poster";
import { AVCC_64_HEX, epochInfo, makeClipPackets, makeMp4, toHex } from "./fixtures";

const PLACEHOLDER_BYTES = new Uint8Array(Buffer.from(PLACEHOLDER_POSTER.split(",")[1], "base64"));
/** A JPEG that is not the placeholder: one quantization value (in the DQT at 20) is changed. */
const IMAGE_BYTES = PLACEHOLDER_BYTES.slice();
IMAGE_BYTES[25] ^= 0x01;

function segment(marker: number, body: number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...body];
}

/** IMAGE_BYTES with EXIF (APP1), an ICC profile (APP2) and a comment added. */
function jpegWithMetadata(): Uint8Array {
  const exif = segment(0xe1, [...Buffer.from("Exif\0\0"), 0x4d, 0x4d, 0, 0x2a, 1, 2, 3, 4]);
  const icc = segment(0xe2, [...Buffer.from("ICC_PROFILE\0"), 1, 1, 9, 9]);
  const comment = segment(0xfe, [...Buffer.from("Hank's phone")]);
  const body = Array.from(IMAGE_BYTES.subarray(2));
  // SOI, APP0 (from the placeholder) stays first; metadata after it.
  const app0Length = (body[2] << 8) | body[3];
  const app0 = body.slice(0, 2 + app0Length);
  const rest = body.slice(2 + app0Length);
  return new Uint8Array([0xff, 0xd8, ...app0, ...exif, ...icc, ...comment, ...rest]);
}

describe("posterSize", () => {
  it("scales a tall 720x1280 frame to 320 wide", () => {
    expect(posterSize(720, 1280)).toEqual({ width: 320, height: 569 });
  });

  it("scales a wide 1280x720 frame to 320x180", () => {
    expect(posterSize(1280, 720)).toEqual({ width: 320, height: 180 });
  });

  it("never makes a poster larger than the frame", () => {
    expect(posterSize(200, 100)).toEqual({ width: 200, height: 100 });
  });

  it("uses a 16:9 size when the frame size is unknown", () => {
    expect(posterSize(0, 0)).toEqual({ width: POSTER_MAX_WIDTH, height: 180 });
  });

  it("keeps at least 1 px on each side", () => {
    expect(posterSize(10000, 1)).toEqual({ width: 320, height: 1 });
  });
});

describe("stripJpegMetadata", () => {
  it("removes APP1 (EXIF), APP2 and COM and keeps APP0 and the image", () => {
    const clean = stripJpegMetadata(jpegWithMetadata());
    expect(clean).not.toBeNull();
    expect(toHex(clean!)).toBe(toHex(IMAGE_BYTES));
  });

  it("keeps a JPEG with no metadata as it is", () => {
    expect(toHex(stripJpegMetadata(PLACEHOLDER_BYTES)!)).toBe(toHex(PLACEHOLDER_BYTES));
  });

  it("the placeholder is a complete JPEG with no metadata segments", () => {
    expect(Array.from(PLACEHOLDER_BYTES.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(Array.from(PLACEHOLDER_BYTES.subarray(-2))).toEqual([0xff, 0xd9]);
  });

  it("reads fill bytes and standalone markers before a segment", () => {
    const input = new Uint8Array([0xff, 0xd8, 0xff, 0xff, ...segment(0xe1, [1, 2]), 0xff, 0x01, ...segment(0xdb, [5]), 0xff, 0xd9]);
    const out = stripJpegMetadata(input)!;
    expect(Array.from(out)).toEqual([0xff, 0xd8, 0xff, 0x01, ...segment(0xdb, [5]), 0xff, 0xd9]);
  });

  it("returns null for bytes that are not a JPEG it understands", () => {
    expect(stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 1]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("bytesToBase64", () => {
  it("matches Node's base64 for small and large inputs", () => {
    const small = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect(bytesToBase64(small)).toBe(Buffer.from(small).toString("base64"));
    const large = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xff);
    expect(bytesToBase64(large)).toBe(Buffer.from(large).toString("base64"));
  });
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type DecoderMode = "output-on-decode" | "output-on-flush" | "never-output" | "error";

interface FakeState {
  mode: DecoderMode;
  supported: boolean;
  configs: VideoDecoderConfig[];
  chunks: Array<{ type: string; data: Uint8Array }>;
  framesMade: number;
  framesClosed: number;
  decodersClosed: number;
  draws: Array<{ width: number; height: number }>;
  blobType: string;
  blobBytes: Uint8Array;
  canvasSizes: Array<[number, number]>;
}

function makeFakes(overrides: Partial<FakeState> = {}): { deps: PosterDeps; state: FakeState } {
  const state: FakeState = {
    mode: "output-on-flush",
    supported: true,
    configs: [],
    chunks: [],
    framesMade: 0,
    framesClosed: 0,
    decodersClosed: 0,
    draws: [],
    blobType: "image/jpeg",
    blobBytes: jpegWithMetadata(),
    canvasSizes: [],
    ...overrides,
  };

  class FakeFrame {
    displayWidth: number;
    displayHeight: number;
    closed = false;
    constructor(width: number, height: number) {
      this.displayWidth = width;
      this.displayHeight = height;
      state.framesMade++;
    }
    close() {
      if (!this.closed) state.framesClosed++;
      this.closed = true;
    }
  }

  class FakeChunk {
    type: string;
    data: Uint8Array;
    constructor(init: { type: string; timestamp: number; data: Uint8Array }) {
      this.type = init.type;
      this.data = new Uint8Array(init.data).slice();
    }
  }

  class FakeDecoder {
    state: "unconfigured" | "configured" | "closed" = "unconfigured";
    private config: VideoDecoderConfig | null = null;
    private pending = 0;
    constructor(private readonly init: { output: (frame: FakeFrame) => void; error: (e: DOMException) => void }) {}
    static async isConfigSupported(config: VideoDecoderConfig) {
      return { supported: state.supported && config.codec.startsWith("avc1.") && !!config.description, config };
    }
    configure(config: VideoDecoderConfig) {
      if (this.state === "closed") throw new DOMException("closed", "InvalidStateError");
      this.state = "configured";
      this.config = config;
      state.configs.push(config);
    }
    decode(chunk: FakeChunk) {
      if (this.state !== "configured") throw new DOMException("not configured", "InvalidStateError");
      state.chunks.push({ type: chunk.type, data: chunk.data });
      if (state.mode === "error" || chunk.type !== "key") {
        queueMicrotask(() => this.init.error(new DOMException("bad data", "EncodingError")));
        return;
      }
      if (state.mode === "output-on-decode") {
        queueMicrotask(() => this.emit());
      } else if (state.mode === "output-on-flush") {
        this.pending++;
      }
    }
    async flush() {
      if (state.mode === "never-output") return new Promise<void>(() => undefined);
      if (state.mode === "error") throw new DOMException("flush failed", "EncodingError");
      while (this.pending > 0) {
        this.pending--;
        this.emit();
      }
    }
    close() {
      if (this.state !== "closed") state.decodersClosed++;
      this.state = "closed";
    }
    private emit() {
      if (this.state === "closed") return;
      this.init.output(new FakeFrame(this.config!.codedWidth!, this.config!.codedHeight!));
    }
  }

  class FakeCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      state.canvasSizes.push([width, height]);
    }
    getContext(kind: string) {
      if (kind !== "2d") return null;
      return {
        drawImage: (frame: FakeFrame, _x: number, _y: number, width: number, height: number) => {
          if (frame.closed) throw new DOMException("frame is closed", "InvalidStateError");
          state.draws.push({ width, height });
        },
      };
    }
    async convertToBlob(options: { type: string; quality: number }) {
      expect(options.type).toBe("image/jpeg");
      return new Blob([new Uint8Array(state.blobBytes)], { type: state.blobType });
    }
  }

  return {
    state,
    deps: {
      VideoDecoder: FakeDecoder as unknown as typeof VideoDecoder,
      EncodedVideoChunk: FakeChunk as unknown as typeof EncodedVideoChunk,
      OffscreenCanvas: FakeCanvas as unknown as typeof OffscreenCanvas,
    },
  };
}

const KEY = new Uint8Array([0, 0, 0, 4, 0x65, 0x88, 0x84, 0]);
const CONFIG = { codec: "avc1.64001f", codedWidth: 720, codedHeight: 1280, description: epochInfo().description };

describe("makePoster", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["output-on-flush", "output-on-decode"] as const)("decodes the keyframe and returns a clean JPEG (%s)", async (mode) => {
    const { deps, state } = makeFakes({ mode });
    const url = await makePoster(KEY, CONFIG, { deps });
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    const jpeg = new Uint8Array(Buffer.from(url.split(",")[1], "base64"));
    // The EXIF, ICC and comment segments are gone.
    expect(toHex(jpeg)).toBe(toHex(IMAGE_BYTES));
    expect(state.canvasSizes).toEqual([[320, 569]]);
    expect(state.draws).toEqual([{ width: 320, height: 569 }]);
    expect(state.chunks).toEqual([{ type: "key", data: KEY }]);
    expect(state.configs[0]).toMatchObject({ codec: "avc1.64001f", codedWidth: 720, codedHeight: 1280, optimizeForLatency: true });
    expect(toHex(new Uint8Array(state.configs[0].description as ArrayBuffer))).toBe(AVCC_64_HEX);
    expect(state.framesMade).toBe(1);
    expect(state.framesClosed).toBe(1);
    expect(state.decodersClosed).toBe(1);
  });

  it("returns the placeholder when VideoDecoder is missing", async () => {
    const { deps } = makeFakes();
    const withoutDecoder = { ...deps, VideoDecoder: undefined };
    // Node has no VideoDecoder global either, so the fallback to globalThis finds nothing.
    expect(globalThis.VideoDecoder).toBeUndefined();
    expect(await makePoster(KEY, CONFIG, { deps: withoutDecoder })).toBe(PLACEHOLDER_POSTER);
    expect(await makePoster(KEY, CONFIG)).toBe(PLACEHOLDER_POSTER);
  });

  it("returns the placeholder when OffscreenCanvas is missing", async () => {
    const { deps } = makeFakes();
    expect(await makePoster(KEY, CONFIG, { deps: { ...deps, OffscreenCanvas: undefined } })).toBe(PLACEHOLDER_POSTER);
  });

  it("returns the placeholder when the config is not supported", async () => {
    const { deps, state } = makeFakes({ supported: false });
    expect(await makePoster(KEY, CONFIG, { deps })).toBe(PLACEHOLDER_POSTER);
    expect(state.chunks).toEqual([]);
  });

  it("returns the placeholder and closes the decoder on a decode error", async () => {
    const { deps, state } = makeFakes({ mode: "error" });
    expect(await makePoster(KEY, CONFIG, { deps })).toBe(PLACEHOLDER_POSTER);
    expect(state.decodersClosed).toBe(1);
  });

  it("returns the placeholder when the decoder never gives a frame (timeout)", async () => {
    vi.useFakeTimers();
    const { deps, state } = makeFakes({ mode: "never-output" });
    const pending = makePoster(KEY, CONFIG, { deps, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(499);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toBe(PLACEHOLDER_POSTER);
    expect(state.decodersClosed).toBe(1);
  });

  it("returns the placeholder when the canvas can only make PNG", async () => {
    const { deps, state } = makeFakes({ blobType: "image/png", blobBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    expect(await makePoster(KEY, CONFIG, { deps })).toBe(PLACEHOLDER_POSTER);
    expect(state.framesClosed).toBe(state.framesMade);
  });

  it("returns the placeholder when the JPEG cannot be read", async () => {
    const { deps } = makeFakes({ blobBytes: new Uint8Array([0xff, 0xd8, 0x00]) });
    expect(await makePoster(KEY, CONFIG, { deps })).toBe(PLACEHOLDER_POSTER);
  });

  it("never throws, even when a fake throws synchronously", async () => {
    const { deps } = makeFakes();
    const Throwing = function () {
      throw new Error("boom");
    } as unknown as typeof VideoDecoder;
    (Throwing as unknown as { isConfigSupported: unknown }).isConfigSupported = async () => ({ supported: true });
    await expect(makePoster(KEY, CONFIG, { deps: { ...deps, VideoDecoder: Throwing } })).resolves.toBe(PLACEHOLDER_POSTER);
  });
});

describe("makePosterFromMp4", () => {
  it("finds the first keyframe and the decoder config in the file", async () => {
    const { bytes } = await makeMp4({ seconds: 1 });
    const { deps, state } = makeFakes();
    const url = await makePosterFromMp4(new Blob([new Uint8Array(bytes)]), { deps });
    expect(url).toBe(`data:image/jpeg;base64,${Buffer.from(IMAGE_BYTES).toString("base64")}`);
    expect(state.configs[0]).toMatchObject({ codec: "avc1.64000a", codedWidth: 64, codedHeight: 64 });
    expect(toHex(new Uint8Array(state.configs[0].description as ArrayBuffer))).toBe(AVCC_64_HEX);
    expect(toHex(state.chunks[0].data)).toBe(toHex(new Uint8Array(makeClipPackets({ seconds: 1 }).video[0].data)));
    expect(state.canvasSizes).toEqual([[64, 64]]);
  });

  it("returns the placeholder for a file that does not parse", async () => {
    const { deps } = makeFakes();
    expect(await makePosterFromMp4(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]), { deps })).toBe(PLACEHOLDER_POSTER);
  });
});
