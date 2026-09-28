/**
 * AAC AudioSpecificConfig (ASC) checks for the muxer.
 *
 * WebKit bug 302253 (still live on iOS 27, plan 3a): AudioEncoder returns raw esds
 * bytes as decoderConfig.description, not an ASC. The encode worker rebuilds the ASC,
 * but the muxer checks it again, because a wrong ASC makes a file with no sound.
 */

/** Sampling frequency table, ISO/IEC 14496-3 table 1.18. The index is the ASC value. */
export const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
] as const;

/** AAC-LC, the only profile that "mp4a.40.2" names. */
export const AAC_LC_OBJECT_TYPE = 2;

export interface ParsedAsc {
  objectType: number;
  sampleRate: number;
  channelConfiguration: number;
}

class BitReader {
  private bit = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = this.bit >> 3;
      if (byte >= this.bytes.length) throw new RangeError("ASC is too short");
      value = value * 2 + ((this.bytes[byte] >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return value;
  }
}

/** Reads the first fields of an ASC. Returns null when the bytes are not a usable ASC. */
export function parseAsc(bytes: Uint8Array): ParsedAsc | null {
  try {
    const reader = new BitReader(bytes);
    let objectType = reader.read(5);
    if (objectType === 31) objectType = 32 + reader.read(6);
    const frequencyIndex = reader.read(4);
    const sampleRate = frequencyIndex === 15 ? reader.read(24) : AAC_SAMPLE_RATES[frequencyIndex];
    const channelConfiguration = reader.read(4);
    if (objectType === 0 || !sampleRate) return null;
    return { objectType, sampleRate, channelConfiguration };
  } catch {
    return null;
  }
}

/** Builds a 2-byte AAC-LC ASC, or a 5-byte one when the rate is not in the table. */
export function buildAsc(sampleRate: number, channels: number): Uint8Array {
  if (!Number.isInteger(channels) || channels < 1 || channels > 7) {
    throw new RangeError(`AAC channel count ${channels} has no channel configuration`);
  }
  const index = (AAC_SAMPLE_RATES as readonly number[]).indexOf(sampleRate);
  if (index >= 0) {
    return new Uint8Array([(AAC_LC_OBJECT_TYPE << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3)]);
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate >= 1 << 24) {
    throw new RangeError(`AAC sample rate ${sampleRate} is not valid`);
  }
  // objectType(5) frequencyIndex=15(4) frequency(24) channels(4) then 3 zero bits.
  const bits = [
    { value: AAC_LC_OBJECT_TYPE, count: 5 },
    { value: 15, count: 4 },
    { value: sampleRate, count: 24 },
    { value: channels, count: 4 },
    { value: 0, count: 3 },
  ];
  const out = new Uint8Array(5);
  let position = 0;
  for (const { value, count } of bits) {
    for (let i = count - 1; i >= 0; i--) {
      if (Math.floor(value / 2 ** i) % 2) out[position >> 3] |= 1 << (7 - (position & 7));
      position++;
    }
  }
  return out;
}

/**
 * Returns an ASC that agrees with the encoder settings. It keeps the given bytes when
 * they are an AAC-LC ASC for the same rate and channels. Otherwise it builds a new one.
 */
export function sanitizeAacDescription(
  description: ArrayBuffer | ArrayBufferView | undefined | null,
  sampleRate: number,
  channels: number,
): { description: Uint8Array; rebuilt: boolean } {
  if (description) {
    const bytes =
      description instanceof ArrayBuffer
        ? new Uint8Array(description)
        : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
    const parsed = parseAsc(bytes);
    if (
      parsed &&
      parsed.objectType === AAC_LC_OBJECT_TYPE &&
      parsed.sampleRate === sampleRate &&
      parsed.channelConfiguration === channels
    ) {
      return { description: bytes.slice(), rebuilt: false };
    }
  }
  return { description: buildAsc(sampleRate, channels), rebuilt: true };
}
