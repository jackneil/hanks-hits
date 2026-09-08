/**
 * Every sound in the game, made by the browser as it plays.
 *
 * No files are loaded and nothing comes from the internet: the engine, the
 * horn and the landing thump are all built out of Web Audio nodes, the same
 * way the monster-truck game does it.
 */

type ContextFactory = () => AudioContext;

function defaultFactory(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  return new Ctor();
}

/** The engine note at a standstill and at the top of the rev range, in hertz. */
export const ENGINE_MIN_HZ = 60;
export const ENGINE_MAX_HZ = 220;

export class FourWheelerSounds {
  private makeContext: ContextFactory;
  private context: AudioContext | null = null;
  private enabled = true;
  private volume = 0.5;

  private engine: {
    osc: OscillatorNode;
    noise: AudioBufferSourceNode;
    gain: GainNode;
  } | null = null;

  /** The last engine level, already clamped to 0..1. Read by the tests. */
  private engineLevel = 0;

  constructor(makeContext: ContextFactory = defaultFactory) {
    this.makeContext = makeContext;
  }

  private ctx(): AudioContext {
    if (!this.context) this.context = this.makeContext();
    return this.context;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopEngine();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /** Browsers keep audio asleep until a tap. Call this on the first tap. */
  resume() {
    if (this.context?.state === "suspended") {
      void this.context.resume();
    }
  }

  getEngineLevel(): number {
    return this.engineLevel;
  }

  isEngineRunning(): boolean {
    return this.engine !== null;
  }

  /** A short loop of white noise, which is the gravel under the engine note. */
  private makeNoise(ctx: AudioContext): AudioBufferSourceNode {
    const seconds = 1;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  /** Start the engine idling. Calling it twice does nothing the second time. */
  startEngine() {
    if (!this.enabled || this.engine) return;
    const ctx = this.ctx();

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = ENGINE_MIN_HZ;

    const noise = this.makeNoise(ctx);
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.04 * this.volume;

    const gain = ctx.createGain();
    gain.gain.value = 0.12 * this.volume;

    osc.connect(gain);
    noise.connect(noiseGain);
    noiseGain.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    noise.start();
    this.engine = { osc, noise, gain };
    this.setEngine(this.engineLevel);
  }

  stopEngine() {
    if (!this.engine) return;
    this.engine.osc.stop();
    this.engine.noise.stop();
    this.engine = null;
  }

  /**
   * How hard the engine is working, 0 at a standstill and 1 flat out.
   *
   * Anything outside that range is pulled back into it, so a speed reading
   * that overshoots for one frame can never scream.
   */
  setEngine(level: number) {
    const clamped = Number.isFinite(level)
      ? Math.max(0, Math.min(1, level))
      : 0;
    this.engineLevel = clamped;
    if (!this.engine) return;
    const hz = ENGINE_MIN_HZ + (ENGINE_MAX_HZ - ENGINE_MIN_HZ) * clamped;
    this.engine.osc.frequency.value = hz;
    this.engine.gain.gain.value = (0.09 + 0.09 * clamped) * this.volume;
  }

  /** HONK. */
  playHorn() {
    if (!this.enabled) return;
    const ctx = this.ctx();
    const now = ctx.currentTime;

    const low = ctx.createOscillator();
    const high = ctx.createOscillator();
    const gain = ctx.createGain();

    low.type = "sawtooth";
    high.type = "sawtooth";
    low.frequency.value = 196;
    high.frequency.value = 262;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35 * this.volume, now + 0.02);
    gain.gain.setValueAtTime(0.35 * this.volume, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

    low.connect(gain);
    high.connect(gain);
    gain.connect(ctx.destination);

    low.start(now);
    high.start(now);
    low.stop(now + 0.45);
    high.stop(now + 0.45);
  }

  /**
   * The thump of a landing.
   *
   * @param strength 0 for a gentle touch down and 1 for a big drop.
   */
  playThud(strength: number) {
    if (!this.enabled) return;
    const level = Math.max(0, Math.min(1, strength));
    const ctx = this.ctx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(120 + 60 * level, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);

    gain.gain.setValueAtTime((0.12 + 0.28 * level) * this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }
}

/** The one manager the game uses. */
export const sounds = new FourWheelerSounds();
