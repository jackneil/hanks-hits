/**
 * Performance governor (plan 7). Pure logic: no timers, no browser APIs.
 *
 * The guarantee: capture never costs the game more than 10% of its frame
 * rate. The governor reads capture-attributed signals first and uses the frame
 * rate against a baseline as the backstop.
 *
 * Ladder (levels, best first):
 *   rungs from the rung table (plan 6.2)
 *   -> content scaled down inside the coded frame (lowest rung)
 *   -> low-power capture (lowest rung, smallest scale, last 15 s kept)
 *   -> resting (no capture)
 *
 * Signals:
 * - Capture frames are the frames that took a capture TICKET (a frame read,
 *   or a path E readback queued). Classification never uses "cost > 0":
 *   Safari rounds performance.now() to 1 ms, so a real capture can measure 0.
 * - Missed vsyncs: capture frames against the frames of the same window with
 *   no ticket (the control group). Only the EXTRA miss rate of capture frames
 *   counts, so a game that misses vsyncs on its own is not blamed on capture.
 * - Main-thread cost: share of the window and p95 against the vsync period.
 *   A p95 of a whole vsync or more ("capture-over-frame": path D on a WebGL
 *   canvas on WebKit, 23-30 ms) costs a frame on every capture at any rung,
 *   so it goes at once to the low-power level, and from there to resting.
 * - Path E costs GPU time, not main-thread time. Its GPU signals are the
 *   readback latency in frames and the share of draws with every readback
 *   slot still busy. With no control group (a capture on every frame), path E
 *   windows are also checked against the baseline at the 10% limit.
 * - Encoder queue and latency, and pump backpressure (dropsBackpressure plus
 *   dropsLate: on path E most losses arrive late).
 * - Frame rate against the baseline: a 25% loss is severe on every path,
 *   when capture can be blamed for it (no control group, or capture frames
 *   miss vsyncs more than the others). A drop that capture frames do not
 *   share is the game's own (a heavier scene).
 *
 * Known limit, to confirm on devices (plan 15 performance gates): with a
 * deep GPU pipeline, the delay from a path E readback can land on the frame
 * AFTER the capture frame, which is in the control group. The busy and
 * latency signals and the baseline check at k = 1 still see a GPU that
 * cannot keep up.
 *
 * Baseline: the game's frame rate without capture. It comes from the option,
 * from setBaseline(), or from game frames marked baseline (the canvas
 * source's warmup: live play before the first capture). A later run of
 * baseline frames replaces it.
 *
 * Rules:
 * - Signals are grouped in 2 s windows. A window with too few game frames,
 *   or with no capture activity (a hidden tab, a pause, a warmup), is
 *   neither clean nor violating.
 * - Two violating windows in a row step down one level.
 * - Two severe windows in a row go to resting.
 * - A capture-over-frame window goes to low-power at once (resting when
 *   already at low-power).
 * - 30 s of clean windows (15 in a row) step up one level, at most twice per
 *   session. Resting is left only through resume() (the lifecycle probe) or
 *   when the power gate that caused it clears.
 * - Power gates: Compute Pressure "serious" steps down one level at once and
 *   blocks step-ups; "critical" rests. A battery under 20% and discharging
 *   rests. Low Power Mode keeps the level at low-power or lower.
 */
import type { CapturePath } from "../protocol";
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
  /** Low Power Mode, inferred from an IDLE 30 Hz rAF sample (rungs.inferLowPowerMode). */
  lowPowerMode?: boolean;
}

export type ViolationReason =
  | "capture-share"
  | "capture-p95"
  | "capture-over-frame"
  | "missed-frames"
  | "encoder-behind"
  | "backpressure"
  | "gpu-behind"
  | "fps-loss"
  | "severe-fps-loss";

export interface WindowReport {
  startMs: number;
  endMs: number;
  frames: number;
  /** Frames that took a capture ticket. */
  captures: number;
  /** Fraction of the window spent in capture on the main thread. */
  captureShare: number;
  captureP95Ms: number;
  /** Fraction of game frames that capture pushed past a vsync. */
  missedByCapture: number;
  gameFps: number;
  /** The baseline the window was compared with, or null. */
  baselineFps: number | null;
  /** Median path E readback latency in frames, or null with no readbacks. */
  readbackLatency: number | null;
  /** Share of path E capture attempts with every slot busy. */
  readbackBusy: number;
  violations: ViolationReason[];
  severe: boolean;
  /** False when the window had too few samples to judge. */
  judged: boolean;
}

export interface GovernorDecision {
  atMs: number;
  from: number;
  to: number;
  reason:
    | "violations"
    | "severe"
    | "capture-over-frame"
    | "clean"
    | "pressure"
    | "battery"
    | "low-power-mode"
    | "resume"
    | "power-cleared";
  report: WindowReport | null;
}

export interface GovernorOptions {
  displayHz: number;
  targetFps: number;
  /** The game's frame rate without capture, when the caller knows it. */
  baselineFps?: number;
  /** Start this many levels down (the crash-loop breaker starts one rung lower). */
  startLevel?: number;
  /** Content scales for the "scaled" levels. Default [0.75, 0.5]. */
  contentScales?: number[];
  onChange?: (level: GovernorLevel, decision: GovernorDecision) => void;
}

/** One capture-cost sample. */
export interface CaptureSample {
  /** True when the frame took a capture ticket (default true). */
  ticket?: boolean;
  path?: CapturePath;
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
/**
 * Path E readback latency (median, in frames) above this means the GPU is
 * behind. The iPhone SE measured 1 (plan 3a). Chromium reports fence status
 * through its GPU process, which can add a frame, so 2 is still normal.
 */
export const MAX_READBACK_LATENCY_FRAMES = 2;
/** Share of path E capture attempts with every readback slot busy. */
export const MAX_READBACK_BUSY = 0.1;
/** Frame-rate loss against the baseline that breaks the guarantee (path E without a control group). */
export const MAX_FPS_LOSS = 0.1;
/** Frame-rate loss against the baseline that counts as severe. */
export const SEVERE_FPS_LOSS = 0.25;
export const LOW_POWER_KEEP_SECONDS = 15;
export const LOW_BATTERY = 0.2;
/** Battery level that clears a low-battery rest (hysteresis). */
export const BATTERY_CLEAR = 0.25;
/** Minimum game frames for a window to be judged. */
export const MIN_FRAMES_PER_WINDOW = 10;
/** Minimum no-ticket frames for a control group. */
export const MIN_CONTROL_FRAMES = 5;
/** Minimum frame intervals in a baseline run. */
export const MIN_BASELINE_INTERVALS = 20;
/** An interval longer than this (a hidden tab) ends a baseline run. */
export const BASELINE_MAX_GAP_MS = 1000;

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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface WindowAcc {
  startMs: number;
  frameTimes: number[];
  costs: number[];
  costByFrame: Map<number, number>;
  ticketFrames: Set<number>;
  pathE: boolean;
  encoderQueues: number[];
  encoderLatencies: number[];
  offered: number;
  dropped: number;
  readbackLatencies: number[];
  readbackBusy: number;
  pathETickets: number;
  longFramesByCapture: number;
}

export class Governor {
  readonly ladder: GovernorLevel[];
  private index: number;
  private readonly vsyncMs: number;
  private baseline: number | null;
  private baselineRun: number[] = [];
  private readonly onChange?: GovernorOptions["onChange"];

  private win: WindowAcc | null = null;
  private lastPump: { offered: number; backpressure: number; late: number } | null = null;
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
    this.baseline = options.baselineFps && options.baselineFps > 0 ? options.baselineFps : null;
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
  /** The game's frame rate without capture, or null while unknown. */
  get baselineFps(): number | null {
    return this.baseline;
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

  /**
   * A game frame ran at page time atMs (rAF timestamp). baseline: true marks
   * a frame of live play with no capture (the source's warmup).
   */
  gameFrame(atMs: number, info: { baseline?: boolean } = {}): void {
    this.advance(atMs);
    this.acc(atMs).frameTimes.push(atMs);
    if (info.baseline) this.addBaselineFrame(atMs);
    else this.endBaselineRun();
  }

  /** Set the baseline directly (a caller that measured it). */
  setBaseline(fps: number): void {
    if (Number.isFinite(fps) && fps > 0) this.baseline = fps;
  }

  /**
   * Main-thread capture cost (ms) of the frame at atMs. ticket: false for a
   * dispatch that only collected path E readbacks.
   */
  captureCost(atMs: number, ms: number, sample: CaptureSample = {}): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    w.costs.push(ms);
    w.costByFrame.set(atMs, (w.costByFrame.get(atMs) ?? 0) + ms);
    const ticket = sample.ticket ?? true;
    if (ticket) w.ticketFrames.add(atMs);
    if (sample.path === "E") {
      w.pathE = true;
      if (ticket) w.pathETickets++;
    }
  }

  /** A path E readback came in, latencyFrames after its kick. */
  readback(atMs: number, latencyFrames: number): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    w.pathE = true;
    w.readbackLatencies.push(latencyFrames);
  }

  /** The game drew, but every path E readback slot was busy. */
  readbackBusy(atMs: number): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    w.pathE = true;
    w.readbackBusy++;
  }

  /** Encoder report: queue size and submit-to-output latency. */
  encoder(atMs: number, report: { queue: number; latencyMs: number }): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    w.encoderQueues.push(report.queue);
    w.encoderLatencies.push(report.latencyMs);
  }

  /**
   * Cumulative pump counters (FramePump.stats()). Backpressure losses are
   * dropsBackpressure (not taken) plus dropsLate (read, then no room).
   */
  pumpStats(atMs: number, stats: { offered: number; dropsBackpressure: number; dropsLate?: number }): void {
    this.advance(atMs);
    const w = this.acc(atMs);
    const late = stats.dropsLate ?? 0;
    if (this.lastPump) {
      const offered = Math.max(0, stats.offered - this.lastPump.offered);
      const backpressure = Math.max(0, stats.dropsBackpressure - this.lastPump.backpressure);
      const lateDrops = Math.max(0, late - this.lastPump.late);
      w.offered += offered + backpressure;
      w.dropped += backpressure + lateDrops;
    }
    this.lastPump = { offered: stats.offered, backpressure: stats.dropsBackpressure, late };
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

  // ---- baseline -----------------------------------------------------------

  private addBaselineFrame(atMs: number): void {
    const run = this.baselineRun;
    if (run.length > 0 && atMs - run[run.length - 1] > BASELINE_MAX_GAP_MS) run.length = 0;
    run.push(atMs);
    if (run.length > MIN_BASELINE_INTERVALS) {
      this.baseline = (1000 * (run.length - 1)) / (run[run.length - 1] - run[0]);
    }
  }

  private endBaselineRun(): void {
    if (this.baselineRun.length > 0) this.baselineRun = [];
  }

  // ---- windows ------------------------------------------------------------

  private acc(atMs: number): WindowAcc {
    if (!this.win) {
      this.win = {
        startMs: atMs,
        frameTimes: [],
        costs: [],
        costByFrame: new Map(),
        ticketFrames: new Set(),
        pathE: false,
        encoderQueues: [],
        encoderLatencies: [],
        offered: 0,
        dropped: 0,
        readbackLatencies: [],
        readbackBusy: 0,
        pathETickets: 0,
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
    // Frames that capture pushed past a vsync, by ticket. With a control
    // group, only the extra miss rate of capture frames counts. With no
    // control group (a capture every frame), a miss counts when the frame
    // would have fit without its main-thread capture cost.
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
      const at = w.frameTimes[i - 1];
      const missedVsync = interval > late;
      if (w.ticketFrames.has(at)) {
        capFrames++;
        if (missedVsync) capMissed++;
        if (missedVsync && interval - (w.costByFrame.get(at) ?? 0) <= late) fitWithoutCapture++;
      } else {
        otherFrames++;
        if (missedVsync) otherMissed++;
      }
    }
    const controlGroup = otherFrames >= MIN_CONTROL_FRAMES;
    let missed = 0;
    if (capFrames > 0 && controlGroup) {
      missed = Math.max(0, capMissed / capFrames - otherMissed / otherFrames) * capFrames;
    } else if (capFrames > 0) {
      missed = fitWithoutCapture;
    }
    missed += w.longFramesByCapture;
    const intervalSum = intervals.reduce((a, b) => a + b, 0);
    const gameFps = intervals.length ? (1000 * intervals.length) / intervalSum : 0;
    const captureActive =
      w.ticketFrames.size > 0 || w.offered > 0 || w.dropped > 0 || w.longFramesByCapture > 0 || w.readbackBusy > 0;
    const judged = frames >= MIN_FRAMES_PER_WINDOW && captureActive;
    const violations: ViolationReason[] = [];
    let severe = false;
    const captureShare = span > 0 ? captureTotal / span : 0;
    const captureP95Ms = p95(w.costs);
    const missedByCapture = frames > 1 ? missed / (frames - 1) : 0;
    const readbackLatency = median(w.readbackLatencies);
    const attemptsE = w.pathETickets + w.readbackBusy;
    const readbackBusy = attemptsE > 0 ? w.readbackBusy / attemptsE : 0;
    if (judged && this.level.kind !== "resting") {
      if (captureShare > MAX_CAPTURE_SHARE) violations.push("capture-share");
      if (captureP95Ms > this.vsyncMs * MAX_P95_FRACTION_OF_VSYNC) violations.push("capture-p95");
      if (captureP95Ms >= this.vsyncMs) violations.push("capture-over-frame");
      if (missedByCapture > MAX_MISSED_BY_CAPTURE) violations.push("missed-frames");
      // The encoder is behind when a frame waits longer than 4 capture slots.
      const latencyLimit = Math.max(250, 4 * this.level.k * this.vsyncMs);
      const queueBehind =
        w.encoderQueues.length > 0 && w.encoderQueues.filter((q) => q >= 2).length > w.encoderQueues.length / 2;
      if (queueBehind || p95(w.encoderLatencies) > latencyLimit) violations.push("encoder-behind");
      if (w.offered > 0 && w.dropped / w.offered > MAX_BACKPRESSURE_DROPS) violations.push("backpressure");
      if ((readbackLatency !== null && readbackLatency > MAX_READBACK_LATENCY_FRAMES) || readbackBusy > MAX_READBACK_BUSY) {
        violations.push("gpu-behind");
      }
      if (this.baseline !== null && gameFps > 0) {
        const loss = 1 - gameFps / this.baseline;
        // With a control group, a frame-rate drop that capture frames do not
        // share is the game's own (a heavier scene), not capture's.
        const attributable = !controlGroup || missedByCapture > MAX_MISSED_BY_CAPTURE;
        if (loss > SEVERE_FPS_LOSS && attributable) {
          violations.push("severe-fps-loss");
          severe = true;
        } else if (w.pathE && !controlGroup && loss > MAX_FPS_LOSS) {
          // Path E's cost is on the GPU. With no control group, only the
          // baseline can see it.
          violations.push("fps-loss");
        }
      }
    }
    return {
      startMs: w.startMs,
      endMs,
      frames,
      captures: w.ticketFrames.size,
      captureShare,
      captureP95Ms,
      missedByCapture,
      gameFps,
      baselineFps: this.baseline,
      readbackLatency,
      readbackBusy,
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
      } else if (r.violations.includes("capture-over-frame")) {
        // Every capture costs a whole frame, at any rung: skip the rungs.
        const to = this.index < this.lowPowerIndex ? this.lowPowerIndex : this.restingIndex;
        this.move(endMs, to, "capture-over-frame", r);
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

/**
 * The canvas source callbacks that feed a governor (registerCanvasSource
 * options onGameFrame, onCaptureCost and onReadback). Spread them into the
 * source options, so the signals reach the governor with the right meaning.
 */
export function governorInputs(governor: Governor): {
  onGameFrame: (pageMs: number, info: { baseline: boolean }) => void;
  onCaptureCost: (sample: { frameMs: number; ms: number; path: CapturePath; ticket: boolean }) => void;
  onReadback: (signal: { kind: "done"; frameMs: number; latencyFrames: number } | { kind: "busy"; frameMs: number }) => void;
} {
  return {
    onGameFrame: (pageMs, info) => governor.gameFrame(pageMs, info),
    onCaptureCost: (s) => governor.captureCost(s.frameMs, s.ms, { ticket: s.ticket, path: s.path }),
    onReadback: (signal) => {
      if (signal.kind === "done") governor.readback(signal.frameMs, signal.latencyFrames);
      else governor.readbackBusy(signal.frameMs);
    },
  };
}
