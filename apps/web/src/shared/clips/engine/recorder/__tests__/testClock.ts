/**
 * One page clock for the recorder tests: timers (the engine's and the
 * rotator's), queued browser tasks (the MediaRecorder double's events) and
 * the capture realm's frames all run on it, in time order, with the
 * microtasks after each step.
 */
import { flushMicrotasks } from "../../../../../__tests__/webcodecs-mock";

interface Timer {
  fn: () => void;
  ms: number;
  next: number;
  repeat: boolean;
  seq: number;
}

export class TestClock {
  t: number;
  private id = 0;
  private seq = 0;
  private readonly timers = new Map<number, Timer>();

  constructor(start = 10_000) {
    this.t = start;
  }

  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => this.add(fn, ms, false);
  setInterval = (fn: () => void, ms: number): unknown => this.add(fn, ms, true);
  clear = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  /** A queued browser task: runs at the current time, after the timers already due. */
  schedule = (fn: () => void): void => {
    this.add(fn, 0, false);
  };

  get pendingTimers(): number {
    return this.timers.size;
  }

  private add(fn: () => void, ms: number, repeat: boolean): number {
    const id = ++this.id;
    this.timers.set(id, { fn, ms: Math.max(0, ms), next: this.t + Math.max(0, ms), repeat, seq: ++this.seq });
    return id;
  }

  /** Runs every timer and task due up to t, in time order, flushing microtasks after each one. */
  async advanceTo(t: number): Promise<void> {
    await flushMicrotasks();
    for (let guard = 0; ; guard++) {
      if (guard > 200_000) throw new Error(`timer loop at ${this.t}`);
      let due: [number, Timer] | null = null;
      for (const entry of this.timers) {
        const timer = entry[1];
        if (timer.next > t) continue;
        if (!due || timer.next < due[1].next || (timer.next === due[1].next && timer.seq < due[1].seq)) due = entry;
      }
      if (!due) break;
      const [id, timer] = due;
      this.t = Math.max(this.t, timer.next);
      if (timer.repeat) {
        timer.next += Math.max(1, timer.ms);
        timer.seq = ++this.seq;
      } else this.timers.delete(id);
      timer.fn();
      await flushMicrotasks();
    }
    this.t = Math.max(this.t, t);
    await flushMicrotasks();
  }

  async advance(ms: number): Promise<void> {
    await this.advanceTo(this.t + ms);
  }

  /** Runs the tasks and timers that are due now. */
  async settle(): Promise<void> {
    await this.advanceTo(this.t);
  }
}
