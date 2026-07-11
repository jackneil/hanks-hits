import { describe, expect, it } from 'vitest';
import { clampDeltaTime, getControlsCopy, MAX_DELTA_TIME } from '../lib/gameHelpers';

describe('clampDeltaTime', () => {
  it('clamps a huge frame gap down to the max (throttled/slow first frame)', () => {
    // 2000ms gap -> would spike the physics if left un-clamped
    expect(clampDeltaTime(2000 / 1000)).toBe(MAX_DELTA_TIME);
  });

  it('passes a normal 60fps frame through untouched', () => {
    const normal = 16 / 1000;
    expect(clampDeltaTime(normal)).toBe(normal);
  });

  it('collapses negative or non-finite deltas to 0', () => {
    expect(clampDeltaTime(-5)).toBe(0);
    expect(clampDeltaTime(Number.NaN)).toBe(0);
  });

  it('honors a custom max', () => {
    expect(clampDeltaTime(1, 0.1)).toBe(0.1);
  });
});

describe('getControlsCopy', () => {
  it('gives touch viewports finger-friendly copy, no keyboard keys', () => {
    const copy = getControlsCopy(true);
    expect(copy).toContain('pedal');
    expect(copy).not.toMatch(/D\/|Space/);
  });

  it('gives keyboard viewports the key legend', () => {
    const copy = getControlsCopy(false);
    expect(copy).toContain('Gas');
    expect(copy).toContain('Space Nitro');
  });

  it('kid-facing copy uses no em-dashes', () => {
    expect(getControlsCopy(true)).not.toContain('—');
    expect(getControlsCopy(false)).not.toContain('—');
  });
});
