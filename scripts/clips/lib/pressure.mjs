/**
 * Compute Pressure readings for the clips harness (plan 7, 15.3).
 *
 * The clip governor reads the browser's Compute Pressure ("cpu"). When the
 * pressure becomes "serious", the governor steps the capture rung down one
 * step at once and blocks step-ups. At "critical" it rests capture (Record
 * keeps the low-power rung). So on a busy machine, the rung and the frame
 * rate of a clip can fall for a reason that is not in the clip code. The
 * E2E spec watches the same pressure in the page and prints it, so a rung
 * step in the file (sync.mjs rateParts) has its cause next to it.
 *
 * This module has no I/O: e2e/clips/lib/lab.ts collects the readings.
 */

/** The Compute Pressure states, lowest first. */
export const PRESSURE_STATES = Object.freeze(["nominal", "fair", "serious", "critical"]);

/** "+7.0" / "-1.2": signed seconds with one decimal. */
function signedSec(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}`;
}

/**
 * The pressure over time, from readings in page time.
 *
 * @param {Array<{ atMs: number, state: string }>} readings in any order
 * @param {number} zeroMs the page time that "+0.0 s" means (the Start click)
 * @returns {{ value: string, changes: Array<{ atSec: number, state: string }>, worst: string | null }}
 *   value: each change, "fair at -2.1 s, serious at +7.0 s"; the first
 *   entry is the state when the watch started. worst: the highest state seen.
 */
export function pressureTimeline(readings, zeroMs) {
  const sorted = readings
    .filter((r) => r && Number.isFinite(r.atMs) && PRESSURE_STATES.includes(r.state))
    .slice()
    .sort((a, b) => a.atMs - b.atMs);
  const changes = [];
  for (const reading of sorted) {
    if (changes.length && changes[changes.length - 1].state === reading.state) continue;
    changes.push({ atSec: Math.round((reading.atMs - zeroMs) / 100) / 10, state: reading.state });
  }
  if (!changes.length) return { value: "no reading", changes, worst: null };
  const worst = PRESSURE_STATES[Math.max(...changes.map((c) => PRESSURE_STATES.indexOf(c.state)))];
  return { value: changes.map((c) => `${c.state} at ${signedSec(c.atSec)} s`).join(", "), changes, worst };
}
