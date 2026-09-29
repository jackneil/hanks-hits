/**
 * Streaming readers for the game sound of tiers M and V (plan 5, 6.3).
 *
 * One audio-only MediaRecorder records the game sound while capture runs. Its
 * chunks come to the io worker in order, and a reader takes the sound packets
 * out of them as they arrive: a clip needs the sound up to "now", not at the
 * end of the file.
 *
 * - WebM (tier V, Opus): this module reads the EBML itself, one block at a
 *   time. A browser can write a Cluster of unknown size that runs for many
 *   seconds (Chrome's libwebm starts a new Cluster only at a video keyframe
 *   or after a long time), and a reader that waits for the end of a Cluster
 *   would give the newest sound many seconds late. This reader gives each
 *   block as soon as its bytes are in, with any chunk boundary.
 * - MP4 (tier M, AAC): a fragmented MP4. mediabunny reads it from a
 *   ReadableStream (ReadableStreamSource). A fragment (moof and mdat) is
 *   complete at each MediaRecorder timeslice, so the delay is one timeslice.
 *
 * A reader gives the decoder config once (onHeader), then each packet in
 * order with its time from the start of the stream (onPacket). A stream that
 * cannot be read ends with onError; the packets before the fault stay good.
 */

import { EncodedPacketSink, Input, MP4, ReadableStreamSource, type AudioCodec } from "mediabunny";
import type { SegmentContainer } from "../../protocol";

/** The sound's decoder config. */
export interface SoundHeader {
  codec: AudioCodec;
  config: AudioDecoderConfig;
}

/** One sound packet, with its time from the start of the stream. */
export interface StreamPacket {
  tsUs: number;
  durUs: number;
  data: Uint8Array;
  key: boolean;
}

export interface SoundParserEvents {
  onHeader(header: SoundHeader): void;
  onPacket(packet: StreamPacket): void;
  onError(message: string): void;
}

export interface SoundParser {
  /** The next bytes of the stream, in order. */
  push(bytes: Uint8Array): void;
  /** No more bytes. `done` settles after the last packet. */
  end(): void;
  /** Stops at once: no more events. */
  cancel(): void;
  /** Settles when the reader stopped (end, cancel or error). */
  readonly done: Promise<void>;
}

/**
 * Bytes that the MP4 reader keeps for its reads. A fragment is read whole,
 * and at 128 kbit/s one second of sound is 16 KiB, so 1 MiB is many
 * fragments. Older bytes are let go (the reader never reads back).
 */
export const MP4_SOUND_CACHE_BYTES = 1024 * 1024;

export function createSoundParser(container: SegmentContainer, events: SoundParserEvents): SoundParser {
  return container === "webm" ? new WebmSoundParser(events) : new Mp4SoundParser(events);
}

// ---------------------------------------------------------------------------
// Frame lengths
// ---------------------------------------------------------------------------

/** Opus frame lengths in microseconds for each TOC config (RFC 6716, 3.1). */
function opusFrameUs(config: number): number {
  if (config < 12) return [10_000, 20_000, 40_000, 60_000][config % 4];
  if (config < 16) return [10_000, 20_000][config % 2];
  return [2_500, 5_000, 10_000, 20_000][config % 4];
}

/** The length of one Opus packet from its TOC byte (RFC 6716, 3.1), or null when it cannot be read. */
export function opusPacketUs(data: Uint8Array): number | null {
  if (data.length === 0) return null;
  const toc = data[0];
  const frame = opusFrameUs(toc >> 3);
  const code = toc & 3;
  if (code === 0) return frame;
  if (code === 1 || code === 2) return 2 * frame;
  if (data.length < 2) return null;
  const count = data[1] & 0x3f;
  return count > 0 ? count * frame : null;
}

// ---------------------------------------------------------------------------
// WebM
// ---------------------------------------------------------------------------

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  Cues: 0x1c53bb6b,
  Tags: 0x1254c367,
  Chapters: 0x1043a770,
  Attachments: 0x1941a469,
} as const;

/** The elements that can follow a Cluster in a Segment: they end a Cluster of unknown size. */
const SEGMENT_CHILDREN: ReadonlySet<number> = new Set([
  ID.SeekHead,
  ID.Info,
  ID.Tracks,
  ID.Cluster,
  ID.Cues,
  ID.Tags,
  ID.Chapters,
  ID.Attachments,
]);

/** A larger header element is not a browser's: the stream is refused. */
const MAX_HEADER_ELEMENT_BYTES = 1024 * 1024;
/** A larger block is not a sound block. */
const MAX_BLOCK_BYTES = 1024 * 1024;

interface Vint {
  value: number;
  length: number;
  /** All value bits are one: the "unknown size" value. */
  unknown: boolean;
}

/** Reads a variable-length integer at `at`, or null when the bytes are not all there. */
function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): Vint | null | "bad" {
  if (at >= bytes.length) return null;
  const first = bytes[at];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) return "bad";
  if (at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i];
    if (bytes[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function readUint(bytes: Uint8Array): number {
  let value = 0;
  for (const b of bytes) value = value * 256 + b;
  return value;
}

function readFloat(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length === 4) return view.getFloat32(0);
  if (bytes.length === 8) return view.getFloat64(0);
  return 0;
}

/** The children of a whole master element body. */
function* children(body: Uint8Array): Generator<{ id: number; data: Uint8Array }> {
  let at = 0;
  while (at < body.length) {
    const id = readVint(body, at, true);
    if (!id || id === "bad") return;
    const size = readVint(body, at + id.length, false);
    if (!size || size === "bad") return;
    const start = at + id.length + size.length;
    const end = size.unknown ? body.length : Math.min(body.length, start + size.value);
    yield { id: id.value, data: body.subarray(start, end) };
    at = end;
  }
}

interface Context {
  id: number;
  /** Absolute end of the element, or Infinity for an unknown size. */
  end: number;
}

interface WebmTrack {
  number: number;
  codec: AudioCodec;
  config: AudioDecoderConfig;
}

/** The track's codec from a Matroska CodecID. */
function codecOf(codecId: string): { codec: AudioCodec; webcodecs: string } | null {
  if (codecId === "A_OPUS") return { codec: "opus", webcodecs: "opus" };
  if (codecId.startsWith("A_AAC")) return { codec: "aac", webcodecs: "mp4a.40.2" };
  if (codecId === "A_VORBIS") return { codec: "vorbis", webcodecs: "vorbis" };
  return null;
}

class WebmSoundParser implements SoundParser {
  readonly done: Promise<void>;
  private settle: () => void = () => undefined;
  private buf = new Uint8Array(0);
  /** Absolute offset of buf[0] in the stream. */
  private base = 0;
  private readonly stack: Context[] = [];
  /** Bytes of the element that is skipped now (Cues, Tags, Void...), not yet in. */
  private skipping = 0;
  private timecodeScaleNs = 1_000_000;
  private clusterTimecode = 0;
  private track: WebmTrack | null = null;
  private stopped = false;
  private sawEbml = false;

  constructor(private readonly events: SoundParserEvents) {
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  push(bytes: Uint8Array): void {
    if (this.stopped || bytes.length === 0) return;
    let chunk = bytes;
    if (this.skipping > 0) {
      const n = Math.min(this.skipping, chunk.length);
      this.skipping -= n;
      this.base += n;
      chunk = chunk.subarray(n);
      if (chunk.length === 0) return;
    }
    if (this.buf.length === 0) {
      this.buf = chunk.slice();
    } else {
      const joined = new Uint8Array(this.buf.length + chunk.length);
      joined.set(this.buf);
      joined.set(chunk, this.buf.length);
      this.buf = joined;
    }
    try {
      this.parse();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  end(): void {
    if (this.stopped) return;
    // A block cut off at the end is not a packet: the packets before it stand.
    this.stop();
  }

  cancel(): void {
    this.stop();
  }

  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.buf = new Uint8Array(0);
    this.settle();
  }

  private fail(message: string): void {
    if (this.stopped) return;
    this.events.onError(message);
    this.stop();
  }

  /** Drops `n` bytes from the front of the buffer. */
  private consume(n: number): void {
    this.buf = this.buf.subarray(n);
    this.base += n;
  }

  private parse(): void {
    for (;;) {
      if (this.stopped) return;
      // Leave the masters that end here.
      while (this.stack.length > 0 && this.base >= this.stack[this.stack.length - 1].end) this.stack.pop();
      if (this.buf.length === 0) return;
      // An EBML element id has at most 4 bytes.
      if (!(this.buf[0] & 0xf0)) throw new Error("the sound stream has a bad element id");
      const id = readVint(this.buf, 0, true);
      if (id === "bad") throw new Error("the sound stream has a bad element id");
      if (!id) return;
      if (!this.sawEbml) {
        if (id.value !== ID.EBML) throw new Error("the sound stream is not WebM");
        this.sawEbml = true;
      }
      const size = readVint(this.buf, id.length, false);
      if (size === "bad") throw new Error("the sound stream has a bad element size");
      if (!size) return;
      const head = id.length + size.length;
      const parent = this.stack[this.stack.length - 1];
      // A Cluster of unknown size ends where the next Segment child starts.
      if (parent && parent.id === ID.Cluster && parent.end === Infinity && SEGMENT_CHILDREN.has(id.value)) {
        this.stack.pop();
        continue;
      }
      if (id.value === ID.Segment || id.value === ID.Cluster) {
        this.stack.push({ id: id.value, end: size.unknown ? Infinity : this.base + head + size.value });
        this.consume(head);
        continue;
      }
      if (size.unknown) throw new Error("an element of unknown size that is not a Segment or a Cluster");
      const whole = id.value === ID.Info || id.value === ID.Tracks || id.value === ID.Timecode || id.value === ID.SimpleBlock || id.value === ID.BlockGroup || id.value === ID.EBML;
      if (whole) {
        const limit = id.value === ID.SimpleBlock || id.value === ID.BlockGroup ? MAX_BLOCK_BYTES : MAX_HEADER_ELEMENT_BYTES;
        if (size.value > limit) throw new Error("a sound stream element is too large");
        if (this.buf.length < head + size.value) return;
        const body = this.buf.subarray(head, head + size.value);
        this.element(id.value, body);
        this.consume(head + size.value);
        continue;
      }
      // Anything else is skipped, also when its bytes are not all in yet.
      const available = Math.min(this.buf.length, head + size.value);
      this.skipping = head + size.value - available;
      this.consume(available);
    }
  }

  private element(id: number, body: Uint8Array): void {
    switch (id) {
      case ID.Info:
        for (const child of children(body)) if (child.id === ID.TimecodeScale) this.timecodeScaleNs = readUint(child.data) || 1_000_000;
        return;
      case ID.Tracks:
        this.readTracks(body);
        return;
      case ID.Timecode:
        this.clusterTimecode = readUint(body);
        return;
      case ID.SimpleBlock:
        this.block(body, null, true);
        return;
      case ID.BlockGroup: {
        let block: Uint8Array | null = null;
        let duration: number | null = null;
        for (const child of children(body)) {
          if (child.id === ID.Block) block = child.data;
          else if (child.id === ID.BlockDuration) duration = readUint(child.data);
        }
        if (block) this.block(block, duration, false);
        return;
      }
      default:
        return;
    }
  }

  private readTracks(body: Uint8Array): void {
    if (this.track) return;
    for (const entry of children(body)) {
      if (entry.id !== ID.TrackEntry) continue;
      let number = 0;
      let type = 0;
      let codecId = "";
      let priv: Uint8Array | null = null;
      let sampleRate = 0;
      let channels = 0;
      for (const child of children(entry.data)) {
        if (child.id === ID.TrackNumber) number = readUint(child.data);
        else if (child.id === ID.TrackType) type = readUint(child.data);
        else if (child.id === ID.CodecID) codecId = new TextDecoder("latin1").decode(child.data).replace(/\0+$/, "");
        else if (child.id === ID.CodecPrivate) priv = child.data.slice();
        else if (child.id === ID.Audio) {
          for (const a of children(child.data)) {
            if (a.id === ID.SamplingFrequency) sampleRate = readFloat(a.data);
            else if (a.id === ID.Channels) channels = readUint(a.data);
          }
        }
      }
      if (type !== 2 && !codecId.startsWith("A_")) continue;
      const codec = codecOf(codecId);
      if (!codec) throw new Error(`the sound codec "${codecId}" is not supported`);
      const config: AudioDecoderConfig = {
        codec: codec.webcodecs,
        sampleRate: Math.round(sampleRate) || 48_000,
        numberOfChannels: channels || 1,
        ...(priv && priv.length > 0 ? { description: priv } : {}),
      };
      this.track = { number, codec: codec.codec, config };
      this.events.onHeader({ codec: codec.codec, config });
      return;
    }
    throw new Error("the sound stream has no audio track");
  }

  /** The length of one frame of this track, in microseconds. */
  private frameUs(data: Uint8Array): number {
    const track = this.track!;
    if (track.codec === "opus") return opusPacketUs(data) ?? 20_000;
    if (track.codec === "aac") return Math.round((1024 * 1e6) / Math.max(1, track.config.sampleRate));
    return 20_000;
  }

  private block(body: Uint8Array, durationTicks: number | null, simple: boolean): void {
    const track = this.track;
    if (!track) return;
    const number = readVint(body, 0, false);
    if (!number || number === "bad") throw new Error("a sound block has no track number");
    if (number.value !== track.number) return;
    const at = number.length;
    if (body.length < at + 3) throw new Error("a sound block is too short");
    // A signed 16-bit time, relative to the Cluster's time.
    const relative = ((body[at] << 24) >> 16) | body[at + 1];
    const flags = body[at + 2];
    const key = simple ? (flags & 0x80) !== 0 : true;
    const tsUs = Math.round(((this.clusterTimecode + relative) * this.timecodeScaleNs) / 1000);
    const frames = this.unlace(body.subarray(at + 3), (flags >> 1) & 3);
    let t = tsUs;
    frames.forEach((data, i) => {
      const own = this.frameUs(data);
      const durUs = frames.length === 1 && durationTicks !== null ? Math.round((durationTicks * this.timecodeScaleNs) / 1000) : own;
      this.events.onPacket({ tsUs: t, durUs, data: data.slice(), key: i === 0 ? key : true });
      t += own;
    });
  }

  /** The frames of a block (Matroska lacing: none, Xiph, fixed or EBML). */
  private unlace(data: Uint8Array, lacing: number): Uint8Array[] {
    if (lacing === 0) return [data];
    if (data.length < 1) throw new Error("a laced sound block is too short");
    const count = data[0] + 1;
    let at = 1;
    const sizes: number[] = [];
    if (lacing === 1) {
      // Xiph: each size is a run of 255s and one smaller byte.
      for (let i = 0; i < count - 1; i++) {
        let size = 0;
        for (;;) {
          if (at >= data.length) throw new Error("a laced sound block is cut off");
          const b = data[at++];
          size += b;
          if (b !== 255) break;
        }
        sizes.push(size);
      }
    } else if (lacing === 3) {
      // EBML: the first size, then signed differences.
      const first = readVint(data, at, false);
      if (!first || first === "bad") throw new Error("a laced sound block is cut off");
      at += first.length;
      sizes.push(first.value);
      for (let i = 1; i < count - 1; i++) {
        const diff = readVint(data, at, false);
        if (!diff || diff === "bad") throw new Error("a laced sound block is cut off");
        at += diff.length;
        const bias = 2 ** (7 * diff.length - 1) - 1;
        sizes.push(sizes[i - 1] + diff.value - bias);
      }
    } else {
      // Fixed: equal sizes.
      const each = Math.floor((data.length - at) / count);
      for (let i = 0; i < count - 1; i++) sizes.push(each);
    }
    const out: Uint8Array[] = [];
    for (const size of sizes) {
      if (size < 0 || at + size > data.length) throw new Error("a laced sound block is cut off");
      out.push(data.subarray(at, at + size));
      at += size;
    }
    out.push(data.subarray(at));
    return out;
  }
}

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

class Mp4SoundParser implements SoundParser {
  readonly done: Promise<void>;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private stopped = false;
  private closed = false;

  constructor(private readonly events: SoundParserEvents) {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.done = this.read(stream);
  }

  push(bytes: Uint8Array): void {
    if (this.stopped || this.closed || bytes.length === 0) return;
    this.controller?.enqueue(bytes.slice());
  }

  end(): void {
    if (this.stopped || this.closed) return;
    this.closed = true;
    try {
      this.controller?.close();
    } catch {
      // Already closed.
    }
  }

  cancel(): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.controller?.error(new Error("cancelled"));
    } catch {
      // Already closed.
    }
  }

  private async read(stream: ReadableStream<Uint8Array>): Promise<void> {
    const input = new Input({
      formats: [MP4],
      source: new ReadableStreamSource(stream, { maxCacheSize: MP4_SOUND_CACHE_BYTES, handleUnhandledError: () => undefined }),
    });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error("the sound stream has no audio track");
      const codec = await track.getCodec();
      const config = await track.getDecoderConfig();
      if (!codec || !config) throw new Error("the sound codec is not known");
      if (this.stopped) return;
      this.events.onHeader({ codec, config });
      for await (const packet of new EncodedPacketSink(track).packets()) {
        if (this.stopped) return;
        this.events.onPacket({
          tsUs: Math.round(packet.timestamp * 1e6),
          durUs: Math.max(0, Math.round(packet.duration * 1e6)),
          data: packet.data.slice(),
          key: packet.type === "key",
        });
      }
    } catch (error) {
      if (!this.stopped) this.events.onError(error instanceof Error ? error.message : String(error));
    } finally {
      this.stopped = true;
      input.dispose();
    }
  }
}
