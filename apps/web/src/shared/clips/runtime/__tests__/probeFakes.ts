/**
 * WebCodecs and OPFS doubles for the capability probe tests (single copy).
 *
 * They behave like the real APIs where the probe depends on them:
 * - isConfigSupported answers per codec and hardwareAcceleration. iOS ignores
 *   hardwareAcceleration, so a "webkit" device supports prefer-hardware too.
 * - The first output is a key chunk with a decoderConfig and an avcC
 *   description; flush() resolves after every queued frame came out.
 * - WebKit's AudioEncoder gives the raw esds bytes as the description
 *   (WebKit 302253); Chromium gives a 2-byte AudioSpecificConfig.
 * - WebKit's AAC encoder keeps back its 2114-sample delay, and its flush
 *   does not drain it ("webkit-delay").
 * - Some iOS builds throw from AudioEncoder.isConfigSupported.
 * - A cold or busy hardware encoder never flushes its first sessions
 *   (coldHardwareSessions), and some encoders refuse sizes (refusedSizes).
 *
 * These doubles model DEVICE CAPABILITY for the probe. The encode worker's
 * WebCodecs double (src/__tests__/webcodecs-mock.ts, PR 2.2) models encoder
 * behavior during a session; it is a different double.
 */

export interface VideoDevice {
  /** Codec strings that encode, for example "avc1.64001f". */
  codecs: Set<string>;
  /** A hardware encoder exists (prefer-hardware works). */
  hardware: boolean;
  /** A software encoder exists (no-preference works when hardware does not). */
  software: boolean;
  /** Portrait coded sizes are accepted. */
  portrait: boolean;
  /** The encoder never produces output (a stuck driver). */
  stuck?: boolean;
  /** configure() reports an error through the error callback. */
  failConfigure?: boolean;
  /** The first chunk is a delta chunk (a broken encoder). */
  deltaFirst?: boolean;
  /** isConfigSupported throws. */
  throwOnSupport?: boolean;
  /**
   * The first N prefer-hardware sessions never flush (a cold or busy
   * hardware encoder, plan 5.1); later sessions work.
   */
  coldHardwareSessions?: number;
  /** Sizes ("WxH") the encoder refuses (for example a MediaCodec alignment rule). */
  refusedSizes?: Set<string>;
}

export function makeVideoEncoder(device: VideoDevice) {
  const log: VideoEncoderConfig[] = [];
  let hardwareSessions = 0;
  const supported = (c: VideoEncoderConfig) => {
    if (!device.codecs.has(c.codec)) return false;
    if (!device.portrait && c.height > c.width) return false;
    if (device.refusedSizes?.has(`${c.width}x${c.height}`)) return false;
    if (c.hardwareAcceleration === "prefer-hardware") return device.hardware;
    return device.hardware || device.software;
  };
  class FakeVideoEncoder {
    static configs = log;
    static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
      if (device.throwOnSupport) throw new TypeError("bad config");
      return { supported: supported(config), config };
    }
    state: CodecState = "unconfigured";
    private queued = 0;
    private config: VideoEncoderConfig | null = null;
    private cold = false;
    constructor(private readonly init: VideoEncoderInit) {}
    configure(config: VideoEncoderConfig) {
      log.push(config);
      this.config = config;
      this.state = "configured";
      if (config.hardwareAcceleration === "prefer-hardware") {
        hardwareSessions++;
        this.cold = hardwareSessions <= (device.coldHardwareSessions ?? 0);
      }
      if (device.failConfigure || !supported(config)) {
        queueMicrotask(() => this.init.error(new DOMException("unsupported", "NotSupportedError")));
      }
    }
    encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions) {
      if (this.state !== "configured") throw new DOMException("closed", "InvalidStateError");
      void frame;
      const index = this.queued++;
      if (device.stuck || device.failConfigure || this.cold) return;
      const key = device.deltaFirst ? false : index === 0 || Boolean(options?.keyFrame);
      const chunk = { type: key ? "key" : "delta", timestamp: index, byteLength: 10 } as unknown as EncodedVideoChunk;
      const meta: EncodedVideoChunkMetadata | undefined =
        index === 0
          ? {
              decoderConfig: {
                codec: this.config!.codec,
                codedWidth: this.config!.width,
                codedHeight: this.config!.height,
                description: new Uint8Array([1, 0x64, 0, 0x1f]),
              },
            }
          : undefined;
      queueMicrotask(() => this.init.output(chunk, meta));
    }
    flush(): Promise<void> {
      if (device.stuck || this.cold) return new Promise(() => undefined);
      return new Promise((resolve) => setTimeout(resolve, 0));
    }
    close() {
      if (this.state === "closed") throw new DOMException("closed", "InvalidStateError");
      this.state = "closed";
    }
  }
  return FakeVideoEncoder as unknown as typeof VideoEncoder & { configs: VideoEncoderConfig[] };
}

export class FakeVideoFrame {
  static open = 0;
  constructor(
    readonly data: unknown,
    readonly init: VideoFrameBufferInit,
  ) {
    const need = init.codedWidth * init.codedHeight * 1.5;
    if ((data as Uint8Array).byteLength < need) throw new TypeError("buffer too small");
    FakeVideoFrame.open++;
  }
  close() {
    FakeVideoFrame.open--;
  }
}

/**
 * "webkit-delay": WebKit's AAC encoder holds back its measured 2114-sample
 * delay and its flush does not drain it (plan 3a, 5): output starts only
 * once more than 2114 + 1024 samples went in.
 */
export type AudioFlavor = "chromium" | "webkit" | "webkit-delay" | "ios-throws" | "unsupported" | "silent" | "error";

/** WebKit's measured AAC encoder delay, in samples (plan 3a). */
export const WEBKIT_AAC_DELAY = 2114;

/** The raw esds payload WebKit returns (starts with the ES_Descriptor tag 0x03). */
export const WEBKIT_ESDS = new Uint8Array([
  0x03, 0x19, 0x00, 0x00, 0x00, 0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00, 0x00, 0x01, 0xf4, 0x00, 0x00, 0x01, 0xf4, 0x00,
  0x05, 0x02, 0x11, 0x90, 0x06, 0x01, 0x02,
]);

export function makeAudioEncoder(flavor: AudioFlavor) {
  class FakeAudioEncoder {
    static async isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport> {
      if (flavor === "ios-throws") throw new TypeError("not supported on this platform");
      return { supported: flavor !== "unsupported", config };
    }
    /** Samples received and AAC frames (1024 samples) sent out. */
    samples = 0;
    outputs = 0;
    constructor(private readonly init: AudioEncoderInit) {}
    configure() {}
    encode(data: AudioData) {
      if (flavor === "silent") return;
      if (flavor === "error") {
        queueMicrotask(() => this.init.error(new DOMException("reclaimed", "QuotaExceededError")));
        return;
      }
      const description = flavor === "webkit" || flavor === "webkit-delay" ? WEBKIT_ESDS : new Uint8Array([0x11, 0x90]);
      this.samples += (data as unknown as FakeAudioData).init?.numberOfFrames ?? 1024;
      // The delaying encoder sends an AAC frame only for input past its delay.
      const due = flavor === "webkit-delay" ? Math.max(0, Math.floor((this.samples - WEBKIT_AAC_DELAY) / 1024)) : this.outputs + 1;
      while (this.outputs < due) {
        const first = this.outputs === 0;
        this.outputs++;
        queueMicrotask(() =>
          this.init.output(
            { type: "key", timestamp: 0, byteLength: 10 } as unknown as EncodedAudioChunk,
            first ? { decoderConfig: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, description } } : undefined,
          ),
        );
      }
    }
    flush() {
      return new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    close() {}
  }
  return FakeAudioEncoder as unknown as typeof AudioEncoder;
}

export class FakeAudioData {
  constructor(readonly init: AudioDataInit) {}
  close() {}
}

/** An in-memory OPFS root with sync access handles. */
export class FakeOpfs {
  files = new Map<string, Uint8Array>();
  syncHandles = true;
  async getDirectory() {
    return {
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!this.files.has(name)) {
          if (!options?.create) throw new DOMException("missing", "NotFoundError");
          this.files.set(name, new Uint8Array(0));
        }
        if (!this.syncHandles) return {};
        return {
          createSyncAccessHandle: async () => {
            const files = this.files;
            return {
              write(buffer: ArrayBufferView, opts?: { at?: number }) {
                const at = opts?.at ?? 0;
                const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                const old = files.get(name)!;
                const next = new Uint8Array(Math.max(old.length, at + bytes.length));
                next.set(old);
                next.set(bytes, at);
                files.set(name, next);
                return bytes.length;
              },
              read(buffer: ArrayBufferView, opts?: { at?: number }) {
                const at = opts?.at ?? 0;
                const src = files.get(name)!.subarray(at, at + buffer.byteLength);
                new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).set(src);
                return src.length;
              },
              flush() {},
              close() {},
            };
          },
        };
      },
      removeEntry: async (name: string) => {
        this.files.delete(name);
      },
    };
  }
}

/** Every avc1 codec string for the three probe levels and the three profiles. */
export function allCodecs(levels = ["1f", "20", "28"], profiles = ["64", "4d", "42"]): Set<string> {
  const set = new Set<string>();
  for (const p of profiles) for (const l of levels) set.add(`avc1.${p}00${l}`);
  return set;
}
