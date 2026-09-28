/**
 * Performance governor (plan 7). Pure logic: no timers, no browser APIs.
 *
 * The guarantee: capture never costs the game more than 10% of its frame
 * rate. The governor reads capture-attributed signals first and uses the frame
 * rate against a baseline only as the severe backstop.
 *
 * Ladder (levels, best first):
 *   rungs from the rung table (plan 6.2)
 *   -> content scaled down inside the coded frame (lowest rung)
 *   -> low-power capture (lowest rung, smallest scale, last 15 s kept)
 *   -> resting (no capture)
 *
 * Rules:
 * - Signals are grouped in 2 s windows. A window with too few samples (a
 *   hidden tab, a pause) is neither clean nor violating.
 * - Two violating windows in a row step down one level.
 * - Two severe windows in a row go to resting.
 * - 30 s of clean windows (15 in a row) step up one level, at most twice per
 *   session. Resting is left only through resume() (the lifecycle probe) or
 *   when the power gate that caused it clears.
 * - Power gates: Compute Pressure "serious" steps down one level at once and
 *   blocks step-ups; "critical" rests. A battery under 20% and discharging
 *   rests. Low Power Mode keeps the level at low-power or lower.
 */
import { rungTable } from "./rungs";

export type LevelKind = "rung" | "scaled" | "low-power" | "resting";

export interface GovernorLevel {
  kind: LevelKind;
  /** Capture stride for the pump (0 when resting). */
  k: number;
  /** Capture rate (0 when resting). */
  fps: number;
  /** Content scale inside the coded frame (1 = full size). */
  scale: number;
  /** Seconds of history to keep, or null for the normal ring. */
  keepSeconds: number | null;
}

export type PressureState = "nominal" | "fair" | "serious" | "critical";

export interface PowerState {
  pressure?: PressureState;
  /** 0..1, from the Battery Status API where it exists. */
  batteryLevel?: number;
  charging?: boolean;
  /** Low Power Mode, inferred from a 30 Hz rAF (plan 7). */
  lowPowerMode?: boolean;
}

export type ViolationReason =
  | "capture-share"
  | "capture-p95"
  | "missed-frames"
  | "encoder-behind"
  | "backpressure"
  | "severe-fps-loss";

export interface WindowReport {
  startMs: number;
  endMs: number;
  frames: number;
  captures: number;
  /** Fraction of the window spent in capture on the main thread. */
  captureShare: number;
  captureP95Ms: number;
  /** Fraction of game frames that capture pushed past a vsync. */
  missedByCapture: number;
  gameFps: number;
  violations: ViolationReason[];
  severe: boolean;
  /** False when the window had too few samples to judge. */
  judged: boolean;
}

export interface GovernorDecision {
  atMs: number;
  from: number;
  to: number;
  reason: "violations" | "severe" | "clean" | "pressure" | "battery" | "low-power-mode" | "resume" | "power-cleared";
  report: WindowReport | null;
}

export interface GovernorOptions {
  displayHz: number;
  targetFps: number;
  /** The game's frame rate measured before capture started, when known. */
  baselineFps?: number;
  /** Start this many levels down (the crash-loop breaker starts one rung lower). */
  startLevel?: number;
  /** Content scales for the "scaled" levels. Default [0.75, 0.5]. */
  contentScales?: number[];
  onChange?: (level: GovernorLevel, decision: GovernorDecision) => void;
}

export const WINDOW_MS = 2000;
export const VIOLATIONS_TO_STEP_DOWN = 2;
export const CLEAN_WINDOWS_TO_STEP_UP = 15; // 30 s
export const MAX_STEP_UPS = 2;
/** The guarantee: at most 10% of the game's frame rate. */
export const MAX_CAPTURE_SHARE = 0.1;
/** p95 capture cost above this fraction of the vsync period pushes frames over. */
export const MAX_P95_FRACTION_OF_VSYNC = 0.5;
export const MAX_MISSED_BY_CAPTURE = 0.1;
export const MAX_BACKPRESSURE_DROPS = 0.1;
/** Frame-rate loss against the baseline that counts as severe. */
export const SEVERE_FPS_LOSS = 0.25;
export const LOW_POWER_KEEP_SECONDS = 15;
export const LOW_BATTERY = 0.2;
/** Battery level that clears a low-battery rest (hysteresis). */
export const BATTERY_CLEAR = 0.25;
/** Minimum game frames for a window to be judged. */
export const MIN_FRAMES_PER_WINDOW = 10;

/** Build the ladder for a display rate and target. */
export function buildLadder(displayHz: number, targetFps: number, contentScales = [0.75, 0.5]): GovernorLevel[] {
  const rungs = rungTable(displayHz, targetFps);
  const ladder: GovernorLevel[] = rungs.map((r) => ({ kind: "rung", k: r.k, fps: r.fps, scale: 1, keepSeconds: null }));
  const lowest = rungs[rungs.length - 1];
  for (const scale of contentScales) {
    ladder.push({ kind: "scaled", k: lowest.k, fps: lowest.fps, scale, keepSeconds: null });
  }
  const smallest = contentScales.length ? Math.min(...contentScales) : 1;
  ladder.push({ kind: "low-power", k: lowest.k, fps: lowest.fps, scale: smallest, keepSeconds: LOW_POWER_KEEP_SECONDS });
  ladder.push({ kind: "resting", k: 0, fps: 0, scale: smallest, keepSeconds: null });
  return ladder;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

interface WindowAcc {
  startMs: number;
  frameTimes: number[];
  costs: number[];
  costByFrame: Map<number, number>;
  encoderQueues: number[];
  encoderLatencies: number[];
  offered: number;
  dropped: number;
  longFramesByCapture: number;
}

export class Governor {
  readonly ladder: GovernorLevel[];
  private index: number;
  private readonly vsyncMs: number;
  private readonly baselineFps: number | null;
  private readonly onChange?: GovernorOptions["onChange"];

  private win: WindowAcc | null = null;
  private lastPump: { offered: number; drops: number } | null = null;
  private violationsInRow = 0;
  private severeInRow = 0;
  private cleanInRow = 0;
  private stepUps = 0;
  private power: Required<Pick<PowerState, "pressure" | "charging" | "lowPowerMode">> & { batteryLevel: number | null } = {
    pressure: "nominal",
    charging: true,
    lowPowerMode: false,
    batteryLevel: null,
  };
  /** Set while resting because of a power gate; the level to go back to. */
  private powerRest: { cause: "pressure" | "battery"; returnTo: number } | null = null;
  private readonly reports: WindowReport[] = [];
  private readonly decisions: GovernorDecision[] = [];

  constructor(options: GovernorOptions) {
    this.ladder = buildLadder(options.displayHz, options.targetFps, options.contentScales);
    this.index = Math.min(Math.max(0, options.startLevel ?? 0), this.restingIndex);
    this.vsyncMs = 1000 / options.displayHz;
    this.baselineFps = options.baselineFps ?? null;
    this.onChange = options.onChange;
  }

  get level(): GovernorLevel {
    return this.ladder[this.index];
  }
  get levelIndex(): number {
    return this.index;
  }
  get resting(): boolean {
    return this.index === this.restingIndex;
  }
  get stepUpsUsed(): number {
    return this.stepUps;
  }
  /** Judged and unjudged windows, oldest first (for dogfood logs). */
  get windowReports(): readonly WindowReport[] {
    return this.reports;
  }
  get history(): readonly GovernorDecision[] {
    return this.decisions;
  }

  private get restingIndex(): number {
    return this.ladder.length - 1;
  }
  private get lowPowerIndex(): number {
    return this.ladder.length - 2;
  }

  // ---- inputs -------------------------------------------------------------

  /** A game frame ran at page time atMs (rAF timestamp). */
  gameFrame(atMs: number): void {
    this.advance(atMs);
    this.acc(atMs).frameTimes.push(atMs);
  }

  /** Main-thread capture cost (ms) of the frame at atMs. */
  captureCost(atMs: number, ms: number): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    w.costs.push(ms);
    w.costByFrame.set(atMs, (w.costByFrame.get(atMs) ?? 0) + ms);
  }

  /** Encoder report: queue size and submit-to-output latency. */
  encoder(atMs: number, report: { queue: number; latencyMs: number }): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    w.encoderQueues.push(report.queue);
    w.encoderLatencies.push(report.latencyMs);
  }

  /** Cumulative pump counters (FramePump.stats()). */
  pumpStats(atMs: number, stats: { offered: number; dropsBackpressure: number }): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    if (this.lastPump) {
      w.offered += Math.max(0, stats.offered - this.lastPump.offered);
      w.dropped += Math.max(0, stats.dropsBackpressure - this.lastPump.drops);
    }
    this.lastPump = { offered: stats.offered, drops: stats.dropsBackpressure };
  }

  /** A long animation frame whose script time was mostly capture (LoAF attribution). */
  longFrame(atMs: number, entry: { durationMs: number; captureMs: number }): void {
    this.advance(atMs);
    if (entry.durationMs > this.vsyncMs * 1.5 && entry.durationMs - entry.captureMs <= this.vsyncMs * 1.5) {
      this.acc(atMs).longFramesByCapture++;
    }
  }

  /** Close windows that ended before atMs. Call it on a timer too. */
  tick(atMs: number): void {
    this.advance(atMs);
  }

  /** Power and pressure gates. Apply at once. */
  setPower(atMs: number, state: PowerState): void {
    const before = this.power.pressure;
    if (state.pressure !== undefined) this.power.pressure = state.pressure;
    if (state.charging !== undefined) this.power.charging = state.charging;
    if (state.batteryLevel !== undefined) this.power.batteryLevel = state.batteryLevel;
    if (state.lowPowerMode !== undefined) this.power.lowPowerMode = state.lowPowerMode;
    // Step down once when pressure BECOMES serious, not on every report.
    const seriousNow = this.power.pressure === "serious" && before !== "serious" && before !== "critical";
    this.applyPowerGates(atMs, seriousNow);
  }

  /**
   * Leave resting after the lifecycle probe passed (plan 7, RESTING ->
   * BUFFERING). Goes to low-power capture. Power gates still apply.
   */
  resume(atMs: number): boolean {
    if (!this.resting || this.powerGateActive() !== null) return false;
    this.move(atMs, this.lowPowerIndex, "resume", null);
    return true;
  }

  // ---- windows ------------------------------------------------------------

  private acc(atMs: number): WindowAcc {
    if (!this.win) {
      this.win = {
        startMs: atMs,
        frameTimes: [],
        costs: [],
        costByFrame: new Map(),
        encoderQueues: [],
        encoderLatencies: [],
        offered: 0,
        dropped: 0,
        longFramesByCapture: 0,
      };
    }
    return this.win;
  }

  private advance(atMs: number): void {
    while (this.win && atMs >= this.win.startMs + WINDOW_MS) {
      const done = this.win;
      const nextStart = done.startMs + WINDOW_MS;
      this.win = null;
      this.evaluate(done, nextStart);
      // Skip whole empty windows at once (a hidden tab).
      const gap = Math.floor((atMs - nextStart) / WINDOW_MS);
      const start = nextStart + Math.max(0, gap) * WINDOW_MS;
      this.acc(start);
    }
  }

  private report(w: WindowAcc, endMs: number): WindowReport {
    const span = endMs - w.startMs;
    const captureTotal = w.costs.reduce((a, b) => a + b, 0);
    const frames = w.frameTimes.length;
    // Frames that capture pushed past a vsync. The control group is the frames
    // of the same window with no capture: only the EXTRA miss rate of capture
    // frames counts, so a game that misses vsyncs on its own is not blamed on
    // capture. With no control group (a capture every frame), a miss counts
    // when the frame would have fit without the capture cost.
    const intervals: number[] = [];
    const late = this.vsyncMs * 1.5;
    let capFrames = 0;
    let capMissed = 0;
    let otherFrames = 0;
    let otherMissed = 0;
    let fitWithoutCapture = 0;
    for (let i = 1; i < frames; i++) {
      const interval = w.frameTimes[i] - w.frameTimes[i - 1];
      intervals.push(interval);
      const cost = w.costByFrame.get(w.frameTimes[i - 1]) ?? 0;
      const missedVsync = interval > late;
      if (cost > 0) {
        capFrames++;
        if (missedVsync) capMissed++;
        if (missedVsync && interval - cost <= late) fitWithoutCapture++;
      } else {
        otherFrames++;
        if (missedVsync) otherMissed++;
      }
    }
    let missed = 0;
    if (capFrames > 0 && otherFrames >= 5) {
      missed = Math.max(0, capMissed / capFrames - otherMissed / otherFrames) * capFrames;
    } else if (capFrames > 0) {
      missed = fitWithoutCapture;
    }
    missed += w.longFramesByCapture;
    const intervalSum = intervals.reduce((a, b) => a + b, 0);
    const gameFps = intervals.length ? (1000 * intervals.length) / intervalSum : 0;
    const judged = frames >= MIN_FRAMES_PER_WINDOW;
    const violations: ViolationReason[] = [];
    let severe = false;
    const captureShare = span > 0 ? captureTotal / span : 0;
    const captureP95Ms = p95(w.costs);
    const missedByCapture = frames > 1 ? missed / (frames - 1) : 0;
    if (judged && this.level.kind !== "resting") {
      if (captureShare > MAX_CAPTURE_SHARE) violations.push("capture-share");
      if (captureP95Ms > this.vsyncMs * MAX_P95_FRACTION_OF_VSYNC) violations.push("capture-p95");
      if (missedByCapture > MAX_MISSED_BY_CAPTURE) violations.push("missed-frames");
      // The encoder is behind when a frame waits longer than 4 capture slots.
      const latencyLimit = Math.max(250, 4 * this.level.k * this.vsyncMs);
      const queueBehind =
        w.encoderQueues.length > 0 && w.encoderQueues.filter((q) => q >= 2).length > w.encoderQueues.length / 2;
      if (queueBehind || p95(w.encoderLatencies) > latencyLimit) violations.push("encoder-behind");
      const attempts = w.offered + w.dropped;
      if (attempts > 0 && w.dropped / attempts > MAX_BACKPRESSURE_DROPS) violations.push("backpressure");
      if (this.baselineFps && w.costs.length > 0 && gameFps < this.baselineFps * (1 - SEVERE_FPS_LOSS)) {
        violations.push("severe-fps-loss");
        severe = true;
      }
    }
    return {
      startMs: w.startMs,
      endMs,
      frames,
      captures: w.costs.length,
      captureShare,
      captureP95Ms,
      missedByCapture,
      gameFps,
      violations,
      severe,
      judged,
    };
  }

  private evaluate(w: WindowAcc, endMs: number): void {
    const r = this.report(w, endMs);
    this.reports.push(r);
    if (this.reports.length > 64) this.reports.shift();
    if (!r.judged || this.resting) return;
    if (r.violations.length > 0) {
      this.cleanInRow = 0;
      this.violationsInRow++;
      this.severeInRow = r.severe ? this.severeInRow + 1 : 0;
      if (this.severeInRow >= VIOLATIONS_TO_STEP_DOWN) {
        this.move(endMs, this.restingIndex, "severe", r);
      } else if (this.violationsInRow >= VIOLATIONS_TO_STEP_DOWN) {
        this.move(endMs, Math.min(this.index + 1, this.restingIndex), "violations", r);
      }
      return;
    }
    this.violationsInRow = 0;
    this.severeInRow = 0;
    this.cleanInRow++;
    if (
      this.cleanInRow >= CLEAN_WINDOWS_TO_STEP_UP &&
      this.stepUps < MAX_STEP_UPS &&
      this.index > this.ceilingIndex()
    ) {
      this.stepUps++;
      this.move(endMs, this.index - 1, "clean", r);
    }
  }

  // ---- power gates --------------------------------------------------------

  /** Best level the power state allows. */
  private ceilingIndex(): number {
    let ceiling = 0;
    if (this.power.lowPowerMode) ceiling = Math.max(ceiling, this.lowPowerIndex);
    if (this.power.pressure === "serious") ceiling = Math.max(ceiling, this.index);
    return ceiling;
  }

  private powerGateActive(): "pressure" | "battery" | null {
    if (this.power.pressure === "critical") return "pressure";
    const level = this.power.batteryLevel;
    if (level !== null && !this.power.charging) {
      const limit = this.powerRest?.cause === "battery" ? BATTERY_CLEAR : LOW_BATTERY;
      if (level < limit) return "battery";
    }
    return null;
  }

  private applyPowerGates(atMs: number, seriousNow: boolean): void {
    const gate = this.powerGateActive();
    if (gate) {
      if (!this.resting) {
        this.powerRest = { cause: gate, returnTo: this.index };
        this.move(atMs, this.restingIndex, gate === "pressure" ? "pressure" : "battery", null);
      }
      return;
    }
    if (this.powerRest && this.resting) {
      const back = Math.max(this.powerRest.returnTo, this.power.lowPowerMode ? this.lowPowerIndex : 0);
      this.powerRest = null;
      this.move(atMs, back, "power-cleared", null);
    }
    this.powerRest = null;
    if (this.power.lowPowerMode && this.index < this.lowPowerIndex) {
      this.move(atMs, this.lowPowerIndex, "low-power-mode", null);
    } else if (seriousNow && !this.resting) {
      this.move(atMs, Math.min(this.index + 1, this.lowPowerIndex), "pressure", null);
    }
  }

  private move(atMs: number, to: number, reason: GovernorDecision["reason"], report: WindowReport | null): void {
    if (to === this.index) return;
    const decision: GovernorDecision = { atMs, from: this.index, to, reason, report };
    this.index = to;
    this.violationsInRow = 0;
    this.severeInRow = 0;
    this.cleanInRow = 0;
    this.decisions.push(decision);
    this.onChange?.(this.level, decision);
  }
}
