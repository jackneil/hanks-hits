/**
 * The capture rung over media time (plan 7).
 *
 * The governor changes the capture rate (the rung) while a kid plays: a busy
 * machine steps it down, and Record keeps the low-power rung while capture
 * rests. The frame rate of a clip or of a Record part is therefore not one
 * number from one moment. It is the rung weighted by the media time that each
 * rung covered inside the file's span (expected frames / duration).
 *
 * Why not the encoder's top rate, or the rung at the moment of the press: the
 * clips lab found every Record row at 60 fps while the file ran at 31 or 40 fps
 * (the governor had stepped down), so the "capture fps" check judged the file
 * against a rung that capture never used. The weighted rung of those two files
 * was 30.7 and 40.1 fps.
 *
 * Why not the frames in the file: that would make the capture fps check always
 * pass. The rung is what capture asked for; the file is what it got.
 *
 * Times are capture-timeline (media) microseconds: paused time is not in them,
 * so a rest with no Record adds no span. The module has no imports: the
 * service and the io worker both use it.
 */

export interface RungStep {
  /** The rung starts here (media microseconds). The oldest step can be -Infinity (the rung before any note). */
  atUs: number;
  /** Capture rate from atUs to the next step. 0 while capture rests. */
  fps: number;
}

/** Rung history kept beyond the longest ring (60 s), so a clip at the ring's start still finds its rung. */
export const RUNG_HISTORY_US = 120_000_000;

function validFps(fps: number): boolean {
  return Number.isFinite(fps) && fps >= 0;
}

export class RungTimeline {
  private steps: RungStep[];

  /** `fps` is the rung before the first note (the rung when the file started). */
  constructor(fps: number) {
    this.steps = [{ atUs: Number.NEGATIVE_INFINITY, fps: validFps(fps) ? fps : 0 }];
  }

  /** The rung changed to `fps` at media time atUs. A note for a time that has a step already replaces it. */
  note(atUs: number, fps: number): void {
    if (!Number.isFinite(atUs) || !validFps(fps)) return;
    let index = this.steps.length;
    while (index > 0 && this.steps[index - 1].atUs > atUs) index--;
    const before = this.steps[index - 1];
    if (before && before.atUs === atUs) {
      before.fps = fps;
      return;
    }
    this.steps.splice(index, 0, { atUs, fps });
  }

  /** The rung at media time atUs (the oldest rung for a time that is not a number). */
  at(atUs: number): number {
    let fps = this.steps[0].fps;
    if (Number.isNaN(atUs)) return fps;
    for (const step of this.steps) {
      if (step.atUs > atUs) break;
      fps = step.fps;
    }
    return fps;
  }

  /**
   * The rung weighted by media time over [startUs, endUs): the frames that
   * capture asked for, divided by the span. An empty span gives the rung at
   * startUs.
   */
  weighted(startUs: number, endUs: number): number {
    if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs <= startUs) return this.at(startUs);
    let frames = 0;
    for (let i = 0; i < this.steps.length; i++) {
      // The oldest step also covers the time before it (forgetBefore can move it).
      const from = i === 0 ? startUs : Math.max(startUs, this.steps[i].atUs);
      const to = Math.min(endUs, i + 1 < this.steps.length ? this.steps[i + 1].atUs : Number.POSITIVE_INFINITY);
      if (to > from) frames += this.steps[i].fps * (to - from);
    }
    return frames / (endUs - startUs);
  }

  /** Drops the steps that end before atUs (the ring no longer holds that footage). */
  forgetBefore(atUs: number): void {
    let keep = 0;
    while (keep + 1 < this.steps.length && this.steps[keep + 1].atUs <= atUs) keep++;
    if (keep > 0) this.steps = this.steps.slice(keep);
  }

  /**
   * A copy of the steps, oldest first. The first one is the rung before
   * every other step (its atUs is -Infinity until forgetBefore moves it). A
   * Record replays them to the io worker, so the footage from before the
   * press (the seed GOP) gets the rungs that really covered it.
   */
  history(): RungStep[] {
    return this.steps.map((step) => ({ ...step }));
  }

  /** The newest rung that is not 0 (capture ran), or 0 when capture never ran. */
  lastNonZero(): number {
    for (let i = this.steps.length - 1; i >= 0; i--) if (this.steps[i].fps > 0) return this.steps[i].fps;
    return 0;
  }

  /** The number of steps (tests). */
  get size(): number {
    return this.steps.length;
  }
}

/** A frame rate for a library row: one decimal, so 30.7 fps stays 30.7. */
export function rowFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 10) / 10 : 0;
}
