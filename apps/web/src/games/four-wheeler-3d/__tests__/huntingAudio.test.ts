import { expect, it, vi } from "vitest";
import { playRifleShot } from "../components/Hunting";

it("plays a bounded high-pass noise burst and disconnects every shot node", () => {
  const samples = new Float32Array(8640),
    buffer = { getChannelData: () => samples };
  const source = {
    buffer: null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const filter = {
    type: "",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const ctx = {
    sampleRate: 48000,
    currentTime: 12,
    destination: {},
    createBuffer: vi.fn(() => buffer),
    createBufferSource: () => source,
    createBiquadFilter: () => filter,
    createGain: () => gain,
  };
  playRifleShot(ctx as unknown as AudioContext);
  expect(ctx.createBuffer).toHaveBeenCalledWith(1, 8640, 48000);
  expect(samples.some((value) => value !== 0)).toBe(true);
  expect(
    samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 1),
  ).toBe(true);
  expect(filter.type).toBe("highpass");
  expect(filter.frequency.setValueAtTime).toHaveBeenCalledWith(700, 12);
  expect(source.stop).toHaveBeenCalledWith(12.18);
  expect(source.connect).toHaveBeenCalledWith(filter);
  expect(filter.connect).toHaveBeenCalledWith(gain);
  source.onended!();
  for (const node of [source, filter, gain])
    expect(node.disconnect).toHaveBeenCalledOnce();
});
