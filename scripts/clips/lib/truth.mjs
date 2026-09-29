/**
 * The file against the lab's ground truth (plan 15.1, browser E2E:
 * "coverage, drops and duplicates, A/V against ground truth").
 *
 * The lab logs every beat (labSchedule.ts BeatTruth): its index, the rAF
 * time of its flash frame (page ms) and its mark bit. The beep length
 * carries the mark (60 ms for 0, 120 ms for 1; sync.mjs reads it), and the
 * marks follow a 7-bit maximal-length sequence. So 7 beats in a row name
 * their place in the log, and the checks below know WHICH beats the file
 * holds. Beats alone are periodic, so without the marks a file that is one
 * beat off looks the same as a correct file.
 *
 * The checks:
 * 1. "beats match the lab's log": the marks of the file's pairs, in order,
 *    are the marks of consecutive logged beats. A beat that is lost or
 *    repeated inside the file breaks the order, so no place in the log
 *    fits. The sequence repeats every 127 beats, so the log can have more
 *    than one place that fits: the place whose file end is nearest the
 *    press wins (without a press, the newest place wins).
 * 2. "no beat lost at the ends": the logged beat just before the first
 *    matched beat, and the logged beat just after the last one, are outside
 *    the file, or in the edge band where the file can cut a beat.
 * 3. "beat spacing matches the log": the spacing of two paired flashes in
 *    the file is the logged spacing of the two beats, within one capture
 *    frame at the lowest rung. The frame pump stamps a frame with the start
 *    of its capture slot (framePump.ts), so the first captured white frame
 *    is 0 to k - 1 display frames after the real flash (plan 6.2). A span of
 *    the file that is stretched or squeezed fails here.
 * 4. "the file ends at the press": the end of the file, in page time
 *    (through the last matched beat), is within LIMITS.pressEndMs of the
 *    press (Clip it!, or Stop the video). The limit is half a beat: this
 *    check proves which second of the ring the file holds, so a file that
 *    is one beat or more off fails at every display rate. The value shows
 *    the real distance, which is the capture and encoder latency.
 *    A Record part that is not the last part has no press (endMs null):
 *    the row is INFO.
 *
 * Page time: the rAF timestamps and performance.now() use the same clock.
 * This module has no I/O.
 */

/** The row names, so the callers can make SKIPPED rows with the same names. */
export const TRUTH_CHECKS = Object.freeze({
  match: "ground truth: beats match the lab's log",
  ends: "ground truth: no beat lost at the ends",
  spacing: "ground truth: beat spacing matches the log",
  press: "ground truth: the file ends at the press",
});

/** Known marks that name a place in the log: the length of the mark sequence's state (7 bits). */
export const MARKS_TO_NAME_A_PLACE = 7;

function row(status, check, value, limit, detail) {
  const out = { status, check, value: String(value), limit: String(limit) };
  if (detail !== undefined) out.detail = detail;
  return out;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function signedMs(value) {
  const rounded = round1(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

/** The logged beats with the fields the checks need, by index, without duplicates. */
export function cleanBeats(beats) {
  const byIndex = new Map();
  for (const beat of beats ?? []) {
    if (!beat || !Number.isInteger(beat.index) || !Number.isFinite(beat.rafTs) || (beat.mark !== 0 && beat.mark !== 1)) continue;
    if (!byIndex.has(beat.index)) byIndex.set(beat.index, beat);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** The file's marks as text: "1", "0", or "?" for a beep whose length is not known. */
export function marksText(pairs) {
  return pairs.map((pair) => (pair.mark === 0 || pair.mark === 1 ? String(pair.mark) : "?")).join("");
}

/**
 * The places in the log where the file's pairs fit: start positions s in
 * `beats` (cleanBeats) such that beats s .. s + n - 1 are consecutive beats
 * and each known mark of the file is the mark of its beat. An unknown mark
 * (null) fits any beat.
 */
export function fitPlaces(pairs, beats) {
  const n = pairs.length;
  const places = [];
  if (n === 0) return places;
  for (let s = 0; s + n <= beats.length; s++) {
    let fits = true;
    for (let i = 0; i < n; i++) {
      const beat = beats[s + i];
      const mark = pairs[i].mark;
      if (beat.index !== beats[s].index + i || ((mark === 0 || mark === 1) && mark !== beat.mark)) {
        fits = false;
        break;
      }
    }
    if (fits) places.push(s);
  }
  return places;
}

/** Page time (ms) of the file's end, when the file's pair `last` is logged beat `beat`. */
function fileEndInPage(beat, lastFlashSec, fileEndSec) {
  return beat.rafTs + (fileEndSec - lastFlashSec) * 1000;
}

/**
 * The ground-truth rows for one decoded file.
 *
 * @param {{ pairs: Array<{ flash: number, mark: 0 | 1 | null }>, span: { start: number, end: number } | null }} decode
 *   the primary decoder's analyzeDecode result
 * @param {number | null} fileEndSec the end of the file (s, file time): the container duration
 * @param {{ beats: Array<{ index: number, rafTs: number, mark: 0 | 1 }>, endMs?: number | null, displayHz: number, maxStride: number }} truth
 *   beats: the lab's log. endMs: page time of the press, or null. displayHz
 *   and maxStride (the stride of the lowest rung): for the capture frame.
 * @param {{ edgeMs: number, pressEndMs: number, truthSlackMs: number }} limits
 */
export function truthRows(decode, fileEndSec, truth, limits) {
  const rows = [];
  const beats = cleanBeats(truth?.beats);
  const pairs = decode?.pairs ?? [];
  const n = pairs.length;
  const known = pairs.filter((pair) => pair.mark === 0 || pair.mark === 1).length;
  // 7 known marks name one place in 127 beats. The end of the file can cut the last beep, so a short file can have one mark fewer.
  const need = n === 1 ? 1 : Math.min(MARKS_TO_NAME_A_PLACE, n - 1);
  const hz = Number.isFinite(truth?.displayHz) && truth.displayHz > 0 ? truth.displayHz : 60;
  const stride = Number.isInteger(truth?.maxStride) && truth.maxStride > 0 ? truth.maxStride : 1;
  const captureFrameMs = (1000 * stride) / hz;
  const endMs = Number.isFinite(truth?.endMs) ? truth.endMs : null;
  const notChecked = (why) => {
    rows.push(row("INFO", TRUTH_CHECKS.ends, "not checked", "-", why));
    rows.push(row("INFO", TRUTH_CHECKS.spacing, "not checked", "-", why));
    rows.push(row("INFO", TRUTH_CHECKS.press, "not checked", "-", why));
  };

  if (n === 0) {
    rows.push(row("FAIL", TRUTH_CHECKS.match, "no pairs in the file", "the file's beats are consecutive beats of the log"));
    notChecked("the file has no flash-and-beep pairs");
    return rows;
  }
  if (!beats.length) {
    rows.push(row("FAIL", TRUTH_CHECKS.match, "the log has no beats", "the file's beats are consecutive beats of the log"));
    notChecked("the lab logged no beats");
    return rows;
  }
  if (known < need) {
    rows.push(row("FAIL", TRUTH_CHECKS.match, `${known} of ${n} marks read`, `>= ${need} beep marks read`, `file marks ${marksText(pairs)}`));
    notChecked("too few beep marks were read to name the beats");
    return rows;
  }

  const places = fitPlaces(pairs, beats);
  if (!places.length) {
    rows.push(row("FAIL", TRUTH_CHECKS.match, "no place in the log fits", "the file's beats are consecutive beats of the log", `file marks ${marksText(pairs)}; a beat was lost or repeated in the file, or the file is not from this lab run`));
    notChecked("the file's beats do not match the log");
    return rows;
  }

  const lastFlash = pairs[n - 1].flash;
  const fileEnd = Number.isFinite(fileEndSec) ? fileEndSec : decode.span ? decode.span.end : lastFlash;
  const lagAt = (s) => endMs - fileEndInPage(beats[s + n - 1], lastFlash, fileEnd);
  let best = places[places.length - 1];
  if (endMs !== null) {
    for (const s of places) if (Math.abs(lagAt(s)) < Math.abs(lagAt(best))) best = s;
  }
  const first = beats[best];
  const last = beats[best + n - 1];
  rows.push(
    row(
      "PASS",
      TRUTH_CHECKS.match,
      `beats ${first.index + 1}..${last.index + 1} (${n})`,
      "the file's beats are consecutive beats of the log",
      `${places.length} ${places.length === 1 ? "place" : "places"} in the log fit; ${n - known} marks not read; file marks ${marksText(pairs)}${known < MARKS_TO_NAME_A_PLACE ? `; fewer than ${MARKS_TO_NAME_A_PLACE} marks, so the place is not unique in the 127-beat sequence` : ""}`,
    ),
  );

  // 2. The logged neighbours are outside the file (or in the edge band).
  const slackSec = captureFrameMs / 1000;
  const low = (decode.span ? decode.span.start : 0) + limits.edgeMs / 1000 + slackSec;
  const high = (decode.span ? decode.span.end : fileEnd) - limits.edgeMs / 1000 - slackSec;
  const lost = [];
  const before = beats[best - 1];
  if (before && before.index === first.index - 1) {
    const at = pairs[0].flash - (first.rafTs - before.rafTs) / 1000;
    if (at >= low && at <= high) lost.push({ beat: before.index + 1, atSec: Math.round(at * 1000) / 1000 });
  }
  const after = beats[best + n];
  if (after && after.index === last.index + 1) {
    const at = lastFlash + (after.rafTs - last.rafTs) / 1000;
    if (at >= low && at <= high) lost.push({ beat: after.index + 1, atSec: Math.round(at * 1000) / 1000 });
  }
  rows.push(
    row(
      lost.length ? "FAIL" : "PASS",
      TRUTH_CHECKS.ends,
      lost.length ? lost.map((l) => `beat ${l.beat} at ${l.atSec.toFixed(3)} s`).join(", ") : "none lost",
      `each logged beat inside the file (${limits.edgeMs} ms from its ends) is in it`,
      lost.length ? { lost } : undefined,
    ),
  );

  // 3. Spacing against the log, within one capture frame at the lowest rung.
  if (n < 2) {
    rows.push(row("INFO", TRUTH_CHECKS.spacing, "one beat only", "-"));
  } else {
    const deltas = [];
    for (let i = 1; i < n; i++) {
      const fileMs = (pairs[i].flash - pairs[i - 1].flash) * 1000;
      const logMs = beats[best + i].rafTs - beats[best + i - 1].rafTs;
      deltas.push({ beat: beats[best + i].index + 1, deltaMs: round1(fileMs - logMs) });
    }
    const limit = captureFrameMs + limits.truthSlackMs;
    const worst = deltas.reduce((w, d) => (Math.abs(d.deltaMs) > Math.abs(w.deltaMs) ? d : w), deltas[0]);
    const ok = deltas.every((d) => Math.abs(d.deltaMs) <= limit);
    rows.push(
      row(
        ok ? "PASS" : "FAIL",
        TRUTH_CHECKS.spacing,
        `worst ${signedMs(worst.deltaMs)} ms (beat ${worst.beat})`,
        `+/- ${round1(limit).toFixed(1)} ms (one capture frame at ${round1(hz / stride)} fps, + ${limits.truthSlackMs} ms)`,
        { deltas },
      ),
    );
  }

  // 4. The file ends at the press.
  if (endMs === null) {
    rows.push(row("INFO", TRUTH_CHECKS.press, "no press for this file", "-", "a Record part before the last part ends where the next part starts"));
  } else {
    const lag = lagAt(best);
    const text = `${Math.abs(Math.round(lag))} ms ${lag >= 0 ? "before" : "after"} the press`;
    rows.push(row(Math.abs(lag) <= limits.pressEndMs ? "PASS" : "FAIL", TRUTH_CHECKS.press, text, `within ${limits.pressEndMs} ms (half a beat)`, { lagMs: round1(lag) }));
  }
  return rows;
}
