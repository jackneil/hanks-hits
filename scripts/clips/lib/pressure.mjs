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

function changeText(change) {
  return `${change.state} at ${signedSec(change.atSec)} s`;
}

/**
 * True when the governor acts on this change (governor.ts setPower): the
 * pressure becomes serious from nominal or fair (one step down), or it
 * becomes critical (rest). Critical back to serious is not a new step.
 */
function governorActs(previous, state) {
  if (state === "critical") return previous !== "critical";
  return state === "serious" && previous !== "serious" && previous !== "critical";
}

/**
 * The pressure over time, from readings in page time.
 *
 * @param {Array<{ atMs: number, state: string }>} readings in any order
 * @param {number} zeroMs the page time that "+0.0 s" means (the Start click)
 * @returns {{ value: string, all: string, changes: Array<{ atSec: number, state: string }>, steps: Array<{ atSec: number, state: string }>, worst: string | null }}
 *   changes: each change, the first is the state when the watch started.
 *   steps: the changes that the governor acts on. value: the steps, or
 *   "never serious (highest fair)". all: every change, as text. worst: the
 *   highest state seen.
 */
export function pressureTimeline(readings, zeroMs) {
  const sorted = readings
    .filter((r) => r && Number.isFinite(r.atMs) && PRESSURE_STATES.includes(r.state))
    .slice()
    .sort((a, b) => a.atMs - b.atMs);
  const changes = [];
  for (const reading of sorted) {
    if (changes.length && changes[changes.length - 1].state === reading.state) continue;
    // "|| 0": a time just before Start rounds to -0, which reads as +0.0.
    changes.push({ atSec: Math.round((reading.atMs - zeroMs) / 100) / 10 || 0, state: reading.state });
  }
  if (!changes.length) return { value: "no reading", all: "no reading", changes, steps: [], worst: null };
  // The governor starts at "nominal" (governor.ts), so a first reading of serious is a step too.
  const steps = changes.filter((change, i) => governorActs(i === 0 ? "nominal" : changes[i - 1].state, change.state));
  const worst = PRESSURE_STATES[Math.max(...changes.map((c) => PRESSURE_STATES.indexOf(c.state)))];
  return {
    value: steps.length ? steps.map(changeText).join(", ") : `never serious (highest ${worst})`,
    all: changes.map(changeText).join(", "),
    changes,
    steps,
    worst,
  };
}
