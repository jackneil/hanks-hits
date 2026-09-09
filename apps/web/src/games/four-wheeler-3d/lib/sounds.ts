/** Locally hosted engine texture and original Web Audio exhaust, horn and impacts. */
import { engineTargets, exhaustSamples } from "./engineAudio";
type ContextFactory = () => AudioContext;
type RecordingLoader = (context: AudioContext) => Promise<AudioBuffer | null>;
function defaultFactory(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  return new Ctor();
}
const recording: RecordingLoader = async (ctx) => {
  const response = await fetch(
    "/games/four-wheeler-3d/audio/engine-rumble.wav",
  );
  if (!response.ok) throw new Error("Local engine recording unavailable");
  return ctx.decodeAudioData(await response.arrayBuffer());
};
type Engine = {
  exhaust: AudioBufferSourceNode;
  recorded: AudioBufferSourceNode | null;
  gain: GainNode;
  filter: BiquadFilterNode;
  nodes: AudioNode[];
};
export class FourWheelerSounds {
  private context: AudioContext | null = null;
  private engine: Engine | null = null;
  private enabled = true;
  private volume = 0.5;
  private engineLevel = 0;
  private throttle = 0;
  private recordingPromise: Promise<AudioBuffer | null> | null = null;
  constructor(
    private makeContext: ContextFactory = defaultFactory,
    private loadRecording: RecordingLoader = recording,
  ) {}
  private ctx() {
    if (!this.context) this.context = this.makeContext();
    if (this.context.state === "suspended")
      void this.context.resume().catch(() => {});
    return this.context;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopEngine();
  }
  isEnabled() {
    return this.enabled;
  }
  setVolume(volume: number) {
    this.volume = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0;
    this.setEngine(this.engineLevel, this.throttle);
  }
  resume() {
    if (this.context?.state === "suspended")
      void this.context.resume().catch(() => {});
  }
  getEngineLevel() {
    return this.engineLevel;
  }
  isEngineRunning() {
    return this.engine !== null;
  }
  startEngine() {
    if (!this.enabled || this.engine) return;
    const ctx = this.ctx(),
      samples = exhaustSamples(ctx.sampleRate),
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const exhaust = ctx.createBufferSource();
    exhaust.buffer = buffer;
    exhaust.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.55;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    exhaust.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    const engine: Engine = {
      exhaust,
      recorded: null,
      gain,
      filter,
      nodes: [exhaust, filter, gain],
    };
    this.engine = engine;
    exhaust.start();
    this.setEngine(this.engineLevel, this.throttle);
    // Exhaust is ready immediately. A delayed decode may never revive a stopped engine.
    this.recordingPromise ??= this.loadRecording(ctx).catch(() => null);
    void this.recordingPromise.then((buffer) => {
      if (!buffer || this.engine !== engine) return;
      const source = ctx.createBufferSource(),
        textureGain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      textureGain.gain.value = 0.4;
      source.connect(textureGain);
      textureGain.connect(filter);
      engine.recorded = source;
      engine.nodes.push(source, textureGain);
      source.start();
      this.setEngine(this.engineLevel, this.throttle);
    });
  }
  stopEngine() {
    const engine = this.engine,
      ctx = this.context;
    if (!engine || !ctx) return;
    this.engine = null;
    engine.gain.gain.cancelScheduledValues(ctx.currentTime);
    engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
    engine.exhaust.onended = () =>
      engine.nodes.forEach((node) => node.disconnect());
    engine.exhaust.stop(ctx.currentTime + 0.06);
    engine.recorded?.stop(ctx.currentTime + 0.06);
  }
  setEngine(level: number, throttle = level) {
    this.engineLevel = Number.isFinite(level)
      ? Math.max(0, Math.min(1, level))
      : 0;
    this.throttle = Number.isFinite(throttle)
      ? Math.min(1, Math.abs(throttle))
      : 0;
    const engine = this.engine,
      ctx = this.context;
    if (!engine || !ctx) return;
    const target = engineTargets(this.engineLevel, this.throttle),
      now = ctx.currentTime;
    engine.exhaust.playbackRate.setTargetAtTime(target.rate, now, 0.16);
    engine.recorded?.playbackRate.setTargetAtTime(
      0.72 + this.engineLevel * 0.78 + this.throttle * 0.22,
      now,
      0.2,
    );
    engine.filter.frequency.setTargetAtTime(target.cutoff, now, 0.12);
    engine.gain.gain.setTargetAtTime(target.volume * this.volume, now, 0.07);
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
