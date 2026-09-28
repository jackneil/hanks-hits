class HHTap extends AudioWorkletProcessor {
  constructor() { super(); this.n = 0; this.sent = false; }
  process(inputs) {
    const i = inputs[0];
    if (i && i[0]) this.n += i[0].length;
    if (!this.sent && this.n >= 24000) { this.sent = true; this.port.postMessage({ frames: this.n, channels: i.length, sampleRate }); }
    return true;
  }
}
registerProcessor('hh-tap', HHTap);
