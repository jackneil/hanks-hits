/** An original, loopable single-cylinder exhaust bed. No tonal sawtooth. */
export function exhaustSamples(
  sampleRate: number,
  seconds = 2,
): Float32Array<ArrayBuffer> {
  const length = Math.round(sampleRate * seconds),
    out = new Float32Array(length);
  let seed = 1847,
    lowNoise = 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  // Thirty firings in two seconds, with the small irregularity of an idling motor.
  for (let pulse = 0; pulse < 30; pulse++) {
    const start = Math.round((pulse / 15 + random() * 0.0015) * sampleRate),
      strength = 0.84 + random() * 0.13;
    for (let i = 0; i < sampleRate * 0.1; i++) {
      const t = i / sampleRate,
        envelope = (1 - Math.exp(-t * 1600)) * Math.exp(-t * 62);
      lowNoise = lowNoise * 0.86 + random() * 0.14;
      const pop =
        Math.sin(2 * Math.PI * (77 * t - 105 * t * t)) * 0.72 +
        Math.sin(2 * Math.PI * 151 * t) * 0.17 +
        lowNoise * 0.7;
      const at = (((start + i) % length) + length) % length;
      out[at] += pop * envelope * strength;
    }
  }
  let dc = 0;
  for (const n of out) dc += n;
  dc /= length;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    out[i] -= dc;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < length; i++) out[i] *= 0.8 / Math.max(0.8, peak);
  return out;
}

/** The automatic transmission holds revs under load and relaxes when coasting. */
export function engineTargets(speed: number, throttle: number) {
  const normalized = Number.isFinite(speed)
    ? Math.min(1, Math.max(0, speed))
    : 0;
  const load = Number.isFinite(throttle) ? Math.min(1, Math.abs(throttle)) : 0;
  const rpm = 1050 + normalized * 2500 + load * (900 + normalized * 600);
  return {
    rpm,
    rate: rpm / 1800,
    cutoff: 520 + load * 850 + normalized * 350,
    volume: 0.2 + load * 0.14 + normalized * 0.07,
  };
}
