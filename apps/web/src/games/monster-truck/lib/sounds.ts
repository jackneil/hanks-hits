import { getGameAudio, setGameSpeakerEnabled, type GameAudioChannel } from "@/shared/lib/audio";
// Sound manager using Web Audio API - no external files needed!
// All sounds are generated programmatically

export class SoundManager {
  private channel: GameAudioChannel | null = null;
  private enabled = true;
  private masterVolume = 0.5;

  private getContext(): BaseAudioContext | null {
    const audio = getGameAudio();
    if (!audio) return null;
    if (!this.channel || this.channel.disposed) this.channel = audio.channel("monster-truck");
    audio.unlock();
    return this.channel.context;
  }

  dispose() {
    this.channel?.dispose();
    this.channel = null;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    setGameSpeakerEnabled("monster-truck", enabled);
  }

  setVolume(volume: number) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  resume() {
    getGameAudio()?.unlock();
  }

  // Coin collect - bright, satisfying "cha-ching"
  playCoin() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.setValueAtTime(1320, now + 0.08);
    osc2.frequency.setValueAtTime(1100, now);
    osc2.frequency.setValueAtTime(1760, now + 0.08);

    gain.gain.setValueAtTime(0.3 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.channel!.input);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.2);
    osc2.stop(now + 0.2);
  }

  // Star collect - magical ascending arpeggio
  playStar() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = [523, 659, 784, 1047, 1319]; // C5, E5, G5, C6, E6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      const startTime = now + i * 0.06;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.25 * this.masterVolume, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);

      osc.connect(gain);
      gain.connect(this.channel!.input);

      osc.start(startTime);
      osc.stop(startTime + 0.35);
    });
  }

  // Deep truck horn - HONK!
  playHorn() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.value = 180;
    osc2.frequency.value = 240;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4 * this.masterVolume, now + 0.02);
    gain.gain.setValueAtTime(0.4 * this.masterVolume, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.channel!.input);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.5);
    osc2.stop(now + 0.5);
  }

  // NOS boost - whoooosh!
  playNos() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // White noise burst with bandpass filter
    const bufferSize = ctx.sampleRate * 0.6;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(4000, now + 0.15);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.6);
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.channel!.input);

    noise.start(now);
    noise.stop(now + 0.6);
  }

  // Crash/bump - satisfying crunch
  playCrash() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);

    gain.gain.setValueAtTime(0.5 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    osc.connect(gain);
    gain.connect(this.channel!.input);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  // Destruction - crunchy breaking
  playDestroy() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.08));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2500;

    const gain = ctx.createGain();
    gain.gain.value = 0.4 * this.masterVolume;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.channel!.input);

    noise.start(now);
  }

  // Landing thump
  playLanding() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);

    gain.gain.setValueAtTime(0.6 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.channel!.input);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  // Flip bonus - exciting swoosh + chime
  playFlip() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = [440, 554, 659, 880, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      const startTime = now + i * 0.04;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3 * this.masterVolume, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.25);

      osc.connect(gain);
      gain.connect(this.channel!.input);

      osc.start(startTime);
      osc.stop(startTime + 0.25);
    });
  }

  // Upgrade purchase - mechanical upgrade sound
  playUpgrade() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = [220, 330, 440, 550, 660, 770];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.value = freq;

      const startTime = now + i * 0.05;
      gain.gain.setValueAtTime(0.12 * this.masterVolume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.08);

      osc.connect(gain);
      gain.connect(this.channel!.input);

      osc.start(startTime);
      osc.stop(startTime + 0.08);
    });
  }

  // Truck unlock - celebratory fanfare!
  playUnlock() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const fanfare = [
      { freq: 523, time: 0, duration: 0.12 },
      { freq: 659, time: 0.1, duration: 0.12 },
      { freq: 784, time: 0.2, duration: 0.12 },
      { freq: 1047, time: 0.35, duration: 0.25 },
      { freq: 784, time: 0.55, duration: 0.1 },
      { freq: 1047, time: 0.65, duration: 0.3 },
    ];

    fanfare.forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      const startTime = now + time;
      gain.gain.setValueAtTime(0.3 * this.masterVolume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      osc.connect(gain);
      gain.connect(this.channel!.input);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  // Engine idle loop (returns stop function)
  startEngine(): () => void {
    if (!this.enabled) return () => {};
    const ctx = this.getContext();
    if (!ctx) return () => {};

    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();

    // Base engine frequency
    osc.type = 'sawtooth';
    osc.frequency.value = 55;

    // LFO for that rumble effect
    lfo.type = 'sine';
    lfo.frequency.value = 8;
    lfoGain.gain.value = 10;

    gain.gain.value = 0.15 * this.masterVolume;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(this.channel!.input);

    osc.start();
    lfo.start();

    return () => {
      osc.stop();
      lfo.stop();
    };
  }
}

// Singleton instance
export const sounds = new SoundManager();
