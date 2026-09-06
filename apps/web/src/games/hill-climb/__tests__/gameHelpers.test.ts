import { describe, expect, it } from 'vitest';
import { clampDeltaTime, getControlsCopy, MAX_DELTA_TIME } from '../lib/gameHelpers';

describe('clampDeltaTime', () => {
  it('clamps a huge frame gap down to the max (throttled/slow first frame)', () => {
    // 2000ms gap -> would over-drain fuel/nitro and falsely credit airtime
    // if left un-clamped (physics is unaffected: it steps on Matter.Runner)
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
    const { touch } = getControlsCopy();
    expect(touch).toEqual([
      '🦶 Tap the right side to go',
      '🛑 Tap the left side to stop',
      '🤸 Drag up to lean the truck',
      '⚡ Tap NITRO for a big boost',
    ]);
    for (const line of touch) {
      expect(line).not.toMatch(/Press|arrow|space bar/);
    }
  });

  it('gives keyboard viewports the key legend', () => {
    const { keyboard } = getControlsCopy();
    expect(keyboard).toEqual([
      '🦶 Press D or the right arrow to go',
      '🛑 Press A or the left arrow to stop',
      '🤸 Press W and S to lean',
      '⚡ Press the space bar for nitro',
      '🔄 Press R to flip back over',
    ]);
  });

  it('kid-facing copy uses no em-dashes', () => {
    const { touch, keyboard } = getControlsCopy();
    for (const line of [...touch, ...keyboard]) {
      expect(line).not.toContain('—');
    }
  });
});
