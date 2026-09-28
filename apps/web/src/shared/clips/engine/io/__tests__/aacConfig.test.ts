// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AAC_SAMPLE_RATES, buildAsc, parseAsc, sanitizeAacDescription } from "../aacConfig";
import { hexBytes, toHex } from "./fixtures";

// What WebKit's AudioEncoder returns as decoderConfig.description (bug 302253): the
// raw esds body (ES_Descriptor tag 0x03 first), not an AudioSpecificConfig.
const WEBKIT_RAW_ESDS_HEX = "03808080220000000480808014401500000000000000000000000580808002119006808080010200";

describe("buildAsc", () => {
  it("builds 1190 for AAC-LC 48 kHz stereo (the value measured on iOS 27)", () => {
    expect(toHex(buildAsc(48000, 2))).toBe("1190");
  });

  it.each(AAC_SAMPLE_RATES.map((rate, index) => [rate, index]))("round-trips %i Hz", (rate, index) => {
    for (const channels of [1, 2, 6]) {
      const asc = buildAsc(rate, channels);
      expect(asc.length).toBe(2);
      expect(parseAsc(asc)).toEqual({ objectType: 2, sampleRate: rate, channelConfiguration: channels });
      expect(((asc[0] & 0x07) << 1) | (asc[1] >> 7)).toBe(index);
    }
  });

  it("writes an explicit 24-bit rate when the rate is not in the table", () => {
    const asc = buildAsc(37800, 2);
    expect(asc.length).toBe(5);
    expect(parseAsc(asc)).toEqual({ objectType: 2, sampleRate: 37800, channelConfiguration: 2 });
  });

  it("rejects channel counts and rates that an ASC cannot hold", () => {
    expect(() => buildAsc(48000, 0)).toThrow(RangeError);
    expect(() => buildAsc(48000, 8)).toThrow(RangeError);
    expect(() => buildAsc(0, 2)).toThrow(RangeError);
    expect(() => buildAsc(2 ** 24, 2)).toThrow(RangeError);
  });
});

describe("parseAsc", () => {
  it("reads an escaped object type (31 + 6 bits)", () => {
    // objectType 31 escape, then 6 bits = 10 (42 = USAC), index 3, channels 2.
    const bits = "11111" + "001010" + "0011" + "0010" + "000";
    const bytes = new Uint8Array(3);
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") bytes[i >> 3] |= 1 << (7 - (i & 7));
    expect(parseAsc(bytes)).toEqual({ objectType: 42, sampleRate: 48000, channelConfiguration: 2 });
  });

  it("returns null for bytes that are not an ASC", () => {
    expect(parseAsc(new Uint8Array([]))).toBeNull();
    expect(parseAsc(new Uint8Array([0x00, 0x00]))).toBeNull(); // object type 0
    expect(parseAsc(new Uint8Array([0x17, 0x80]))).toBeNull(); // frequency index 15 without the 24 bits
    expect(parseAsc(new Uint8Array([0x16, 0x90]))).toBeNull(); // frequency index 13 is reserved
    expect(parseAsc(hexBytes(WEBKIT_RAW_ESDS_HEX))).toBeNull();
  });
});

describe("sanitizeAacDescription", () => {
  it("keeps a correct ASC as it is", () => {
    const result = sanitizeAacDescription(hexBytes("1190").buffer, 48000, 2);
    expect(result.rebuilt).toBe(false);
    expect(toHex(result.description)).toBe("1190");
  });

  it("keeps a longer valid ASC (with extension bits)", () => {
    const result = sanitizeAacDescription(hexBytes("119056e500"), 48000, 2);
    expect(result.rebuilt).toBe(false);
    expect(toHex(result.description)).toBe("119056e500");
  });

  it("rebuilds WebKit's raw esds bytes into 1190", () => {
    const result = sanitizeAacDescription(hexBytes(WEBKIT_RAW_ESDS_HEX).buffer, 48000, 2);
    expect(result.rebuilt).toBe(true);
    expect(toHex(result.description)).toBe("1190");
  });

  it("rebuilds a missing description", () => {
    expect(sanitizeAacDescription(undefined, 48000, 2)).toEqual({ description: hexBytes("1190"), rebuilt: true });
    expect(sanitizeAacDescription(null, 44100, 1).rebuilt).toBe(true);
  });

  it("rebuilds an ASC that disagrees with the encoder rate, channels or profile", () => {
    expect(sanitizeAacDescription(buildAsc(44100, 2), 48000, 2).rebuilt).toBe(true);
    expect(sanitizeAacDescription(buildAsc(48000, 1), 48000, 2).rebuilt).toBe(true);
    // HE-AAC (object type 5) is not what "mp4a.40.2" names.
    expect(sanitizeAacDescription(new Uint8Array([0x29, 0x90]), 48000, 2).rebuilt).toBe(true);
  });

  it("accepts a view into a larger buffer", () => {
    const backing = new Uint8Array([9, 9, 0x11, 0x90, 9]);
    const result = sanitizeAacDescription(new DataView(backing.buffer, 2, 2), 48000, 2);
    expect(result.rebuilt).toBe(false);
    expect(toHex(result.description)).toBe("1190");
  });
});
