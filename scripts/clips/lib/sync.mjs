/**
 * A/V sync analysis for the clips lab pattern (plan 15.1, 15.2, 3a, 6.4).
 *
 * The lab pattern: once each second, the game picture flashes white and a
 * 1 kHz beep starts at the same instant. A decoder gives two series:
 *   - video: one [presentation time (s), mean luma] pair per decoded frame;
 *   - audio: segments of a peak envelope, one peak per 1 ms bin.
 * This module finds the flash onsets and the beep onsets in those series,
 * pairs each flash with its beep, and turns the result into PASS, FAIL,
 * SKIPPED and INFO rows against the plan 15.2 limits.
 *
 * Sign convention: audioMinusVideoMs = beep time - flash time. A positive
 * value means that the sound comes after the picture (the sound lags).
 * ITU-R BT.1359 gives +45 ms (sound leads) to -125 ms (sound lags) as the
 * limits of detection. In audioMinusVideoMs that is the window -45..+125.
 *
 * This module has no I/O. media.mjs runs the decoders, analyze-sync.mjs
 * joins the two.
 */

/** Plan 15.2 and 6.4 limits. */
export const LIMITS = Object.freeze({
  /** Container A/V on synthetic-timestamp files, and decoder agreement on live files (ms). */
  containerMs: 5,
  /** BT.1359: the sound can lead the picture by at most this (ms). */
  liveLeadMs: 45,
  /** BT.1359: the sound can lag the picture by at most this (ms). */
  liveLagMs: 125,
  /** Plan 6.4: a decoder that ignores edit lists plays the sound at most this late (ms). */
  editListLateMs: 45,
  /** The same decoder must not play the sound early by more than this (ms). */
  editListEarlyMs: 5,
  /** Plan 15.2: the largest gap between two video frames (ms). */
  maxVideoGapMs: 100,
  /** Plan 15.2: effective capture fps as a share of the settled rung. */
  fpsShare: Object.freeze({ desktop: 0.9, phone: 0.8 }),
  /** Plan 6.4: the sound track is continuous. A jump over this is a gap (ms). */
  audioGapMs: 1,
  /** A flash and a beep further apart than this are not a pair (ms). The events are 1 s apart. */
  pairWindowMs: 500,
  /** An unpaired event this close to the start or the end of the file is cut by the edge (ms). */
  edgeMs: 150,
  /** Two decoders see the same flash when their times are this close (ms). */
  decoderMatchMs: 20,
  /** Plan 6.6: a clip starts at the last keyframe at or before the asked start, so it can be up to 1 s longer. */
  lengthShortSec: 1,
  lengthLongSec: 1.2,
});

/** Onset detection settings. */
export const DETECT = Object.freeze({
  /** A picture series whose brightest frame is less than this over the median has no flash (0-255 scale). */
  minLumaContrast: 24,
  /** The flash threshold, as a share of the way from the median luma to the peak luma. */
  flashLevel: 0.5,
  /** A sound track whose loudest peak is under this (full scale 1.0) has no beeps. */
  minBeepPeak: 0.05,
  /** The beep threshold, as a share of the loudest peak. */
  beepLevel: 0.25,
  /** The beep threshold is never under this. */
  beepFloor: 0.02,
  /** A beep onset needs this much quiet before it (ms). The lab beep is 60 ms long, once per second. */
  quietMs: 100,
});

/** Round to 0.1 ms (or to 0.1 of any unit). */
export function round1(value) {
  return Math.round(value * 10) / 10;
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function finiteFrames(frames) {
  return frames
    .filter((frame) => Array.isArray(frame) && Number.isFinite(frame[0]) && Number.isFinite(frame[1]))
    .slice()
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Flash onsets: frames that are over the threshold after a frame that is not.
 * The threshold adapts to the file (the median frame is the normal picture,
 * the brightest frame is a flash), because the clip compositor puts a band
 * and a border around the game picture, so a flash frame is never fully white.
 * The first frame is never an onset: its flash can have started before the file.
 *
 * @param {Array<[number, number]>} frames [time s, luma]
 * @returns {{ onsets: number[], threshold: number | null, low: number | null, high: number | null }}
 */
export function flashOnsets(frames, detect = DETECT) {
  const sorted = finiteFrames(frames);
  if (sorted.length < 2) return { onsets: [], threshold: null, low: null, high: null };
  const lumas = sorted.map((frame) => frame[1]).sort((a, b) => a - b);
  const low = median(lumas);
  const high = lumas[lumas.length - 1];
  if (high - low < detect.minLumaContrast) return { onsets: [], threshold: null, low, high };
  const threshold = low + detect.flashLevel * (high - low);
  const onsets = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][1] >= threshold && sorted[i - 1][1] < threshold) onsets.push(sorted[i][0]);
  }
  return { onsets, threshold, low, high };
}

/**
 * Beep onsets: the start of the first 1 ms bin over the threshold after at
 * least DETECT.quietMs of bins under it, in the same segment. The time is the
 * start of the bin, so it is at most one bin early.
 *
 * @param {Array<{ start: number, binMs: number, peaks: number[] }>} segments
 * @returns {{ onsets: number[], threshold: number | null, loudest: number }}
 */
export function beepOnsets(segments, detect = DETECT) {
  let loudest = 0;
  for (const segment of segments) for (const peak of segment.peaks) if (peak > loudest) loudest = peak;
  if (loudest < detect.minBeepPeak) return { onsets: [], threshold: null, loudest };
  const threshold = Math.max(detect.beepFloor, detect.beepLevel * loudest);
  const onsets = [];
  for (const segment of segments) {
    const quietBins = Math.ceil(detect.quietMs / segment.binMs);
    let quiet = 0;
    segment.peaks.forEach((peak, i) => {
      if (peak >= threshold) {
        if (quiet >= quietBins) onsets.push(segment.start + (i * segment.binMs) / 1000);
        quiet = 0;
      } else {
        quiet++;
      }
    });
  }
  onsets.sort((a, b) => a - b);
  return { onsets, threshold, loudest };
}

/**
 * Pairs flashes with beeps, one to one, closest pairs first. A pair is at
 * most `windowMs` apart.
 *
 * @param {number[]} flashes seconds
 * @param {number[]} beeps seconds
 */
export function pairEvents(flashes, beeps, windowMs = LIMITS.pairWindowMs) {
  const candidates = [];
  flashes.forEach((flash, i) => {
    beeps.forEach((beep, j) => {
      const ms = (beep - flash) * 1000;
      if (Math.abs(ms) <= windowMs) candidates.push({ i, j, ms });
    });
  });
  candidates.sort((a, b) => Math.abs(a.ms) - Math.abs(b.ms) || a.i - b.i || a.j - b.j);
  const usedFlashes = new Set();
  const usedBeeps = new Set();
  const pairs = [];
  for (const candidate of candidates) {
    if (usedFlashes.has(candidate.i) || usedBeeps.has(candidate.j)) continue;
    usedFlashes.add(candidate.i);
    usedBeeps.add(candidate.j);
    pairs.push({ flash: flashes[candidate.i], beep: beeps[candidate.j], audioMinusVideoMs: round1(candidate.ms) });
  }
  pairs.sort((a, b) => a.flash - b.flash);
  return {
    pairs,
    unmatchedFlashes: flashes.filter((_, i) => !usedFlashes.has(i)),
    unmatchedBeeps: beeps.filter((_, j) => !usedBeeps.has(j)),
  };
}

/**
 * Frame timing: the largest gap between two frames and the effective frame
 * rate ((frames - 1) / (last - first)).
 *
 * @param {Array<[number, number]>} frames
 */
export function videoStats(frames) {
  const times = finiteFrames(frames).map((frame) => frame[0]);
  let maxGapMs = 0;
  let maxGapAt = null;
  for (let i = 1; i < times.length; i++) {
    const gapMs = (times[i] - times[i - 1]) * 1000;
    if (gapMs > maxGapMs) {
      maxGapMs = gapMs;
      maxGapAt = times[i - 1];
    }
  }
  const span = times.length >= 2 ? times[times.length - 1] - times[0] : 0;
  // The cadence: the most common frame interval (to 0.1 ms). A clip can span
  // two governor rungs, so this names the rung that most frames came at.
  const counts = new Map();
  for (let i = 1; i < times.length; i++) {
    const key = Math.round((times[i] - times[i - 1]) * 10000) / 10;
    if (key > 0) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let cadenceMs = null;
  let best = 0;
  for (const [key, count] of counts) {
    if (count > best || (count === best && key < cadenceMs)) {
      best = count;
      cadenceMs = key;
    }
  }
  return {
    count: times.length,
    first: times.length ? times[0] : null,
    last: times.length ? times[times.length - 1] : null,
    maxGapMs: round1(maxGapMs),
    maxGapAt,
    effectiveFps: span > 0 ? round1((times.length - 1) / span) : null,
    cadenceMs,
    cadenceFps: cadenceMs ? round1(1000 / cadenceMs) : null,
    cadenceShare: times.length >= 2 ? round1((best / (times.length - 1)) * 100) / 100 : null,
  };
}

/**
 * Jumps between audio segments. The decoder layer starts a new segment where
 * the presentation time does not follow on from the samples before it.
 *
 * @param {Array<{ start: number, samples: number, sampleRate: number }>} segments
 */
export function audioGaps(segments) {
  const gaps = [];
  const sorted = segments.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const end = sorted[i - 1].start + sorted[i - 1].samples / sorted[i - 1].sampleRate;
    gaps.push({ at: end, ms: round1((sorted[i].start - end) * 1000) });
  }
  return gaps;
}

/** The first and last time that both the picture and the sound cover. */
function commonSpan(frames, segments) {
  const times = finiteFrames(frames).map((frame) => frame[0]);
  if (!times.length || !segments.length) return null;
  const audioStart = Math.min(...segments.map((segment) => segment.start));
  const audioEnd = Math.max(...segments.map((segment) => segment.start + segment.samples / segment.sampleRate));
  return { start: Math.max(times[0], audioStart), end: Math.min(times[times.length - 1], audioEnd) };
}

/**
 * Everything one decoder shows: onsets, pairs (with unpaired events split
 * into "edge" and "inside"), frame timing and sound gaps.
 *
 * @param {{ frames: Array<[number, number]>, segments: Array<{ start: number, samples: number, sampleRate: number, binMs: number, peaks: number[] }> }} decode
 */
export function analyzeDecode(decode, limits = LIMITS, detect = DETECT) {
  const flash = flashOnsets(decode.frames, detect);
  const beep = beepOnsets(decode.segments, detect);
  const pairing = pairEvents(flash.onsets, beep.onsets, limits.pairWindowMs);
  const span = commonSpan(decode.frames, decode.segments);
  const nearEdge = (t) => !span || t - span.start < limits.edgeMs / 1000 || span.end - t < limits.edgeMs / 1000;
  return {
    flash,
    beep,
    pairs: pairing.pairs,
    unmatched: {
      flashesInside: pairing.unmatchedFlashes.filter((t) => !nearEdge(t)),
      beepsInside: pairing.unmatchedBeeps.filter((t) => !nearEdge(t)),
      flashesAtEdge: pairing.unmatchedFlashes.filter(nearEdge),
      beepsAtEdge: pairing.unmatchedBeeps.filter(nearEdge),
    },
    span,
    video: videoStats(decode.frames),
    audioGaps: audioGaps(decode.segments),
  };
}

/**
 * Pairs the beeps of two decoders by flash time and gives the difference of
 * their offsets (b - a) for each beep that both saw.
 */
export function offsetDeltas(pairsA, pairsB, matchMs = LIMITS.decoderMatchMs) {
  const deltas = [];
  const used = new Set();
  for (const a of pairsA) {
    let best = -1;
    let bestDistance = Infinity;
    pairsB.forEach((b, j) => {
      const distance = Math.abs(b.flash - a.flash) * 1000;
      if (!used.has(j) && distance <= matchMs && distance < bestDistance) {
        best = j;
        bestDistance = distance;
      }
    });
    if (best >= 0) {
      used.add(best);
      deltas.push({ flash: a.flash, a: a.audioMinusVideoMs, b: pairsB[best].audioMinusVideoMs, deltaMs: round1(pairsB[best].audioMinusVideoMs - a.audioMinusVideoMs) });
    }
  }
  return { deltas, unmatchedA: pairsA.length - deltas.length, unmatchedB: pairsB.length - deltas.length };
}

/** "+12.3" / "-4.0": a signed millisecond value with one decimal. */
export function signedMs(value) {
  const rounded = round1(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function rangeText(values) {
  if (!values.length) return "none";
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${signedMs(low)} ms` : `${signedMs(low)}..${signedMs(high)} ms`;
}

function row(status, check, value, limit, detail) {
  const out = { status, check, value: String(value), limit: String(limit) };
  if (detail !== undefined) out.detail = detail;
  return out;
}

/** The number of flash-and-beep pairs that a file of this length must have. */
export function expectedPairs(durationSec) {
  return Math.max(1, Math.floor(durationSec) - 1);
}

/**
 * The checks for one analysed file.
 *
 * @param {object} measure
 * @param {{ durationSec: number | null, video: string, audio: string } | null} measure.container
 * @param {ReturnType<typeof analyzeDecode> | null} measure.ffmpeg        edit lists applied
 * @param {ReturnType<typeof analyzeDecode> | null} measure.ffmpegRaw     ffmpeg -ignore_editlist 1
 * @param {ReturnType<typeof analyzeDecode> | null} measure.avfoundation  AVFoundation (Apple's player stack)
 * @param {{ ffmpeg: string | null, avfoundation: string | null }} measure.skipped  why a decoder did not run
 * @param {object} options
 * @param {"live" | "synthetic"} [options.mode] live: BT.1359 window; synthetic: within 5 ms of expectOffsetMs
 * @param {number} [options.expectOffsetMs] synthetic mode: the offset the file was made with
 * @param {number | null} [options.rungFps] the settled capture rung (ClipRecord.fps)
 * @param {"desktop" | "phone"} [options.profile]
 * @param {number | null} [options.expectSeconds] the asked clip or recording length
 * @returns {Array<{ status: "PASS" | "FAIL" | "SKIPPED" | "INFO", check: string, value: string, limit: string, detail?: unknown }>}
 */
export function evaluate(measure, options = {}, limits = LIMITS) {
  const mode = options.mode ?? "live";
  const profile = options.profile ?? "desktop";
  const rows = [];
  const ffmpegSkip = measure.skipped?.ffmpeg ?? null;
  const avfSkip = measure.skipped?.avfoundation ?? null;

  if (measure.container) {
    const c = measure.container;
    rows.push(row("INFO", "container", `${c.durationSec === null ? "?" : c.durationSec.toFixed(3)} s`, "-", `${c.video}; ${c.audio}`));
  } else {
    rows.push(row("SKIPPED", "container (ffprobe)", "-", "-", ffmpegSkip ?? "ffprobe did not run"));
  }

  const primary = measure.ffmpeg ?? measure.avfoundation;
  const primaryName = measure.ffmpeg ? "ffmpeg" : "AVFoundation";

  // Pairing: every second has a flash and a beep.
  const pairing = (name, decode) => {
    const duration = decode.span ? decode.span.end - decode.span.start : 0;
    const need = expectedPairs(duration);
    const inside = decode.unmatched.flashesInside.length + decode.unmatched.beepsInside.length;
    const ok = decode.pairs.length >= need && inside === 0;
    return row(ok ? "PASS" : "FAIL", `flash and beep every second (${name})`, `${decode.pairs.length} pairs, ${inside} unpaired`, `>= ${need} pairs, 0 unpaired`, {
      flashes: decode.flash.onsets.length,
      beeps: decode.beep.onsets.length,
      unpairedFlashes: decode.unmatched.flashesInside,
      unpairedBeeps: decode.unmatched.beepsInside,
      cutByEdge: decode.unmatched.flashesAtEdge.length + decode.unmatched.beepsAtEdge.length,
    });
  };

  const sync = (name, decode) => {
    const offsets = decode.pairs.map((pair) => pair.audioMinusVideoMs);
    if (mode === "synthetic") {
      const expected = options.expectOffsetMs ?? 0;
      const worst = offsets.reduce((w, x) => (Math.abs(x - expected) > Math.abs(w - expected) ? x : w), offsets[0] ?? NaN);
      const ok = offsets.length > 0 && offsets.every((x) => Math.abs(x - expected) <= limits.containerMs);
      return row(ok ? "PASS" : "FAIL", `container A/V (${name})`, offsets.length ? `${rangeText(offsets)} (worst ${signedMs(worst)})` : "no pairs", `${signedMs(expected)} ms +/- ${limits.containerMs} ms`, { offsets });
    }
    const ok = offsets.length > 0 && offsets.every((x) => x >= -limits.liveLeadMs && x <= limits.liveLagMs);
    return row(ok ? "PASS" : "FAIL", `live A/V, BT.1359 (${name})`, offsets.length ? rangeText(offsets) : "no pairs", `-${limits.liveLeadMs}..+${limits.liveLagMs} ms (sound minus picture)`, { offsets });
  };

  if (measure.ffmpeg) {
    rows.push(pairing("ffmpeg", measure.ffmpeg));
    rows.push(sync("ffmpeg", measure.ffmpeg));
  } else {
    rows.push(row("SKIPPED", "flash and beep every second (ffmpeg)", "-", "-", ffmpegSkip));
    rows.push(row("SKIPPED", mode === "synthetic" ? "container A/V (ffmpeg)" : "live A/V, BT.1359 (ffmpeg)", "-", "-", ffmpegSkip));
  }

  if (measure.avfoundation) {
    rows.push(pairing("AVFoundation", measure.avfoundation));
    rows.push(sync("AVFoundation", measure.avfoundation));
  } else {
    rows.push(row("SKIPPED", "flash and beep every second (AVFoundation)", "-", "-", avfSkip));
    rows.push(row("SKIPPED", mode === "synthetic" ? "container A/V (AVFoundation)" : "live A/V, BT.1359 (AVFoundation)", "-", "-", avfSkip));
  }

  // The two decoders read the container the same way (plan 3a: the roll-group
  // patch exists because AVFoundation read -44 ms where ffmpeg read -0.6 ms).
  if (measure.ffmpeg && measure.avfoundation) {
    const { deltas, unmatchedA, unmatchedB } = offsetDeltas(measure.ffmpeg.pairs, measure.avfoundation.pairs, limits.decoderMatchMs);
    const values = deltas.map((d) => d.deltaMs);
    const ok = deltas.length > 0 && unmatchedA === 0 && unmatchedB === 0 && values.every((d) => Math.abs(d) <= limits.containerMs);
    rows.push(row(ok ? "PASS" : "FAIL", "decoders agree (AVFoundation minus ffmpeg)", deltas.length ? `${rangeText(values)}, ${unmatchedA + unmatchedB} unmatched` : "no common beeps", `+/- ${limits.containerMs} ms at every beep`, { deltas }));
  } else {
    rows.push(row("SKIPPED", "decoders agree (AVFoundation minus ffmpeg)", "-", "-", avfSkip ?? ffmpegSkip));
  }

  // Plan 6.4: players that ignore edit lists.
  if (measure.ffmpeg && measure.ffmpegRaw) {
    const { deltas } = offsetDeltas(measure.ffmpeg.pairs, measure.ffmpegRaw.pairs, limits.decoderMatchMs + 50);
    const values = deltas.map((d) => d.deltaMs);
    const ok = deltas.length > 0 && deltas.length === measure.ffmpeg.pairs.length && values.every((d) => d >= -limits.editListEarlyMs && d <= limits.editListLateMs);
    rows.push(row(ok ? "PASS" : "FAIL", "edit list ignored (ffmpeg -ignore_editlist 1)", deltas.length ? `${rangeText(values)} later` : "no common beeps", `-${limits.editListEarlyMs}..+${limits.editListLateMs} ms`, { deltas }));
  } else {
    rows.push(row("SKIPPED", "edit list ignored (ffmpeg -ignore_editlist 1)", "-", "-", ffmpegSkip));
  }

  if (primary) {
    const v = primary.video;
    rows.push(row(v.maxGapMs <= limits.maxVideoGapMs && v.count >= 2 ? "PASS" : "FAIL", `largest video gap (${primaryName})`, `${v.maxGapMs.toFixed(1)} ms${v.maxGapAt === null ? "" : ` at ${v.maxGapAt.toFixed(3)} s`}`, `<= ${limits.maxVideoGapMs} ms`));

    rows.push(
      row(
        "INFO",
        `frame cadence (${primaryName})`,
        v.cadenceFps === null ? "?" : `${v.cadenceFps.toFixed(1)} fps`,
        "-",
        v.cadenceMs === null ? undefined : `${Math.round((v.cadenceShare ?? 0) * 100)}% of the frames are ${v.cadenceMs} ms apart`,
      ),
    );

    const share = limits.fpsShare[profile] ?? limits.fpsShare.desktop;
    if (options.rungFps && options.rungFps > 0) {
      const need = options.rungFps * share;
      const ok = v.effectiveFps !== null && v.effectiveFps >= need;
      // A rung that the file's own cadence does not match is worth a look: the
      // rung may be the encoder's nominal rate, not the governor's rung.
      const mismatch = v.cadenceFps !== null && Math.abs(v.cadenceFps - options.rungFps) > options.rungFps * 0.1;
      const detail = mismatch ? `the file's cadence is ${v.cadenceFps.toFixed(1)} fps, not the given rung ${options.rungFps}` : undefined;
      rows.push(row(ok ? "PASS" : "FAIL", `capture fps (${profile})`, `${v.effectiveFps === null ? "?" : v.effectiveFps.toFixed(1)} fps`, `>= ${need.toFixed(1)} fps (${Math.round(share * 100)}% of ${options.rungFps})`, detail));
    } else {
      rows.push(row("SKIPPED", `capture fps (${profile})`, `${v.effectiveFps === null ? "?" : v.effectiveFps.toFixed(1)} fps`, "-", "no settled rung was given"));
    }

    const gaps = primary.audioGaps.filter((gap) => Math.abs(gap.ms) > limits.audioGapMs);
    rows.push(row(gaps.length === 0 ? "PASS" : "FAIL", `sound track is continuous (${primaryName})`, gaps.length ? `${gaps.length} gaps, largest ${Math.max(...gaps.map((g) => Math.abs(g.ms))).toFixed(1)} ms` : "no gaps", `no jump over ${limits.audioGapMs} ms`, { gaps }));
  } else {
    for (const check of ["largest video gap", `capture fps (${profile})`, "sound track is continuous"]) rows.push(row("SKIPPED", check, "-", "-", ffmpegSkip ?? avfSkip));
  }

  if (options.expectSeconds) {
    const duration = measure.container?.durationSec ?? (primary?.span ? primary.span.end - primary.span.start : null);
    if (duration === null) {
      rows.push(row("SKIPPED", "length", "-", "-", ffmpegSkip ?? "no duration"));
    } else {
      const lo = options.expectSeconds - limits.lengthShortSec;
      const hi = options.expectSeconds + limits.lengthLongSec;
      rows.push(row(duration >= lo && duration <= hi ? "PASS" : "FAIL", "length", `${duration.toFixed(2)} s`, `${lo.toFixed(1)}..${hi.toFixed(1)} s`));
    }
  }
  return rows;
}

/**
 * One line per beep: the flash time and the offset (sound minus picture) that
 * each decoder read. The first decoder that ran sets the beeps; the others
 * join by flash time. "-" means that decoder did not see that beep.
 *
 * @param {{ ffmpeg?: ReturnType<typeof analyzeDecode> | null, avfoundation?: ReturnType<typeof analyzeDecode> | null, ffmpegRaw?: ReturnType<typeof analyzeDecode> | null }} measure
 * @returns {Array<{ beep: number, flash: number, ffmpeg: number | null, avfoundation: number | null, ignoreEditList: number | null }>}
 */
export function beepTable(measure, limits = LIMITS) {
  const base = measure.ffmpeg ?? measure.avfoundation;
  if (!base) return [];
  const join = (decode, windowMs) => {
    const used = new Set();
    return base.pairs.map((pair) => {
      if (!decode) return null;
      let best = -1;
      let bestDistance = Infinity;
      decode.pairs.forEach((other, j) => {
        const distance = Math.abs(other.flash - pair.flash) * 1000;
        if (!used.has(j) && distance <= windowMs && distance < bestDistance) {
          best = j;
          bestDistance = distance;
        }
      });
      if (best < 0) return null;
      used.add(best);
      return decode.pairs[best].audioMinusVideoMs;
    });
  };
  const ffmpeg = measure.ffmpeg ? base.pairs.map((pair) => pair.audioMinusVideoMs) : base.pairs.map(() => null);
  const avf = measure.ffmpeg ? join(measure.avfoundation, limits.decoderMatchMs) : base.pairs.map((pair) => pair.audioMinusVideoMs);
  const raw = join(measure.ffmpegRaw, limits.decoderMatchMs + 50);
  return base.pairs.map((pair, i) => ({ beep: i + 1, flash: pair.flash, ffmpeg: ffmpeg[i], avfoundation: avf[i], ignoreEditList: raw[i] }));
}

/** The beep table as text, one line per beep. */
export function formatBeepTable(table) {
  if (!table.length) return "no beeps were paired";
  const cell = (value) => (value === null ? "-" : `${signedMs(value)} ms`).padStart(11);
  const head = `${"beep".padStart(4)} | ${"flash".padStart(9)} | ${"ffmpeg".padStart(11)} | ${"AVFoundation".padStart(12)} | ${"no edit list".padStart(12)}`;
  const lines = table.map(
    (row) => `${String(row.beep).padStart(4)} | ${`${row.flash.toFixed(3)} s`.padStart(9)} | ${cell(row.ffmpeg)} | ${cell(row.avfoundation).padStart(12)} | ${cell(row.ignoreEditList).padStart(12)}`,
  );
  return [head, ...lines].join("\n");
}

/** True when no row failed. SKIPPED rows never fail a run. */
export function passed(rows) {
  return rows.every((r) => r.status !== "FAIL");
}

/** The rows as a fixed-width text table, one line per row. A SKIPPED row shows its reason; any other row shows its text detail. */
export function formatRows(rows, title) {
  const widths = [7, Math.max(20, ...rows.map((r) => r.check.length)), Math.max(10, ...rows.map((r) => r.value.length))];
  const lines = rows.map((r) => {
    const text = typeof r.detail === "string" ? r.detail : null;
    const tail = r.status === "SKIPPED" && text ? `skipped: ${text}` : r.status === "INFO" && text ? text : text ? `${r.limit} (${text})` : r.limit;
    return `${r.status.padEnd(widths[0])} | ${r.check.padEnd(widths[1])} | ${r.value.padEnd(widths[2])} | ${tail}`;
  });
  return (title ? [`== ${title}`] : []).concat(lines).join("\n");
}
