/**
 * H.264 level and codec strings (plan 5.1).
 *
 * The level comes from the frame size, the frame rate and the bitrate, per
 * ITU-T H.264 Table A-1. It must use the frame rate: 720p30 is level 3.1
 * ("1f"), 720p60 is level 3.2 ("20") and 1080p30 is level 4.0 ("28").
 * (mediabunny's own table ignores the frame rate, so it is not used here.)
 */

export type AvcProfile = "high" | "main" | "baseline";

/** Profile order for probes: High, then Main, then Baseline (plan 5.1). */
export const PROFILE_ORDER: readonly AvcProfile[] = ["high", "main", "baseline"];

const PROFILE_IDC: Record<AvcProfile, string> = { high: "64", main: "4d", baseline: "42" };

interface LevelLimits {
  /** level_idc (10 * level). */
  idc: number;
  /** Max macroblocks per second. */
  maxMbps: number;
  /** Max frame size in macroblocks. */
  maxFs: number;
  /** Max bitrate for Baseline and Main, in 1000 bit/s. High allows 1.25 times this. */
  maxBrKbps: number;
}

/** ITU-T H.264 (08/2021) Table A-1. Level 1b is left out (WebCodecs does not need it). */
export const AVC_LEVELS: readonly LevelLimits[] = [
  { idc: 10, maxMbps: 1485, maxFs: 99, maxBrKbps: 64 },
  { idc: 11, maxMbps: 3000, maxFs: 396, maxBrKbps: 192 },
  { idc: 12, maxMbps: 6000, maxFs: 396, maxBrKbps: 384 },
  { idc: 13, maxMbps: 11880, maxFs: 396, maxBrKbps: 768 },
  { idc: 20, maxMbps: 11880, maxFs: 396, maxBrKbps: 2000 },
  { idc: 21, maxMbps: 19800, maxFs: 792, maxBrKbps: 4000 },
  { idc: 22, maxMbps: 20250, maxFs: 1620, maxBrKbps: 4000 },
  { idc: 30, maxMbps: 40500, maxFs: 1620, maxBrKbps: 10000 },
  { idc: 31, maxMbps: 108000, maxFs: 3600, maxBrKbps: 14000 },
  { idc: 32, maxMbps: 216000, maxFs: 5120, maxBrKbps: 20000 },
  { idc: 40, maxMbps: 245760, maxFs: 8192, maxBrKbps: 20000 },
  { idc: 41, maxMbps: 245760, maxFs: 8192, maxBrKbps: 50000 },
  { idc: 42, maxMbps: 522240, maxFs: 8704, maxBrKbps: 50000 },
  { idc: 50, maxMbps: 589824, maxFs: 22080, maxBrKbps: 135000 },
  { idc: 51, maxMbps: 983040, maxFs: 36864, maxBrKbps: 240000 },
  { idc: 52, maxMbps: 2073600, maxFs: 36864, maxBrKbps: 240000 },
];

/**
 * The lowest level that holds width x height at fps (and the bitrate, when
 * given), as two hex digits, for example "1f". Null when no level holds it.
 */
export function avcLevelHex(
  width: number,
  height: number,
  fps: number,
  options: { bitrate?: number; profile?: AvcProfile } = {},
): string | null {
  const wMbs = Math.ceil(width / 16);
  const hMbs = Math.ceil(height / 16);
  const fs = wMbs * hMbs;
  const mbps = fs * fps;
  const brFactor = options.profile === "high" || options.profile === undefined ? 1.25 : 1;
  for (const level of AVC_LEVELS) {
    // A-3.1(f): each side is at most sqrt(8 * MaxFS) macroblocks.
    const maxSide = Math.sqrt(8 * level.maxFs);
    if (fs > level.maxFs || wMbs > maxSide || hMbs > maxSide) continue;
    if (mbps > level.maxMbps) continue;
    if (options.bitrate !== undefined && options.bitrate > level.maxBrKbps * 1000 * brFactor) continue;
    return level.idc.toString(16).padStart(2, "0");
  }
  return null;
}

/** "avc1." + profile_idc + constraint flags "00" + level, for example "avc1.64001f". */
export function avcCodecString(profile: AvcProfile, levelHex: string): string {
  return `avc1.${PROFILE_IDC[profile]}00${levelHex}`;
}

/** The profile of an avc1 codec string, or null. */
export function profileOfCodec(codec: string): AvcProfile | null {
  const idc = codec.slice(5, 7).toLowerCase();
  const found = (Object.keys(PROFILE_IDC) as AvcProfile[]).find((p) => PROFILE_IDC[p] === idc);
  return found ?? null;
}
