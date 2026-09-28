/**
 * Clip audio tap (plan 6.3, 6.4). An AudioWorklet processor.
 *
 * The clip service connects the game-audio bus's tap point (every game
 * sound, before the sound switch) to this node. The node converts each
 * render quantum to 16-bit interleaved stereo and posts it in batches of
 * 2048 frames, as PcmBatch messages, on a MessagePort that goes straight to
 * the encode worker. The main thread is never on the audio path.
 *
 * Messages on this node's own port (from the main thread):
 *   { t: "port", port, streamId }  start: post batches on `port`
 *   { t: "stop" }                  stop: post the part batch, end the node
 * Messages on the data port (from the encode worker, optional):
 *   { t: "recycle", buffer }       an ArrayBuffer to use again
 *
 * PcmBatch: { t: "pcm", streamId, firstFrame, sampleRate, data }
 *   firstFrame is the frame index of the first sample in this context's own
 *   clock (the worklet's currentFrame), so the mixer can place every batch
 *   exactly, also across a suspend and resume. `data` is transferred.
 *
 * Conversion: sample * 32768, rounded, clamped to [-32768, 32767] (the mixer
 * divides by 32768). NaN becomes 0. A mono input is copied to both sides
 * (the node also asks the browser to up-mix with channelCount 2). An input
 * with no channels (no game sound plays) is written as silence, so the
 * stream stays contiguous.
 *
 * Buffers: a batch buffer is taken from the recycle pool; the audio thread
 * makes a new one only when the pool is empty.
 */

/* global AudioWorkletProcessor, registerProcessor, currentFrame, sampleRate */

const BATCH_FRAMES = 2048;
const POOL_LIMIT = 8;

class ClipTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.streamId = "page";
    this.stopped = false;
    this.pool = [];
    this.batch = null;
    this.fill = 0;
    this.firstFrame = 0;
    this.port.onmessage = (event) => this.control(event.data);
  }

  control(message) {
    if (!message || typeof message !== "object") return;
    if (message.t === "port" && message.port) {
      this.out = message.port;
      if (typeof message.streamId === "string") this.streamId = message.streamId;
      this.out.onmessage = (event) => this.recycle(event.data);
    } else if (message.t === "stop") {
      this.flush();
      this.stopped = true;
      if (this.out) {
        this.out.onmessage = null;
        this.out.close();
      }
      this.out = null;
    }
  }

  recycle(message) {
    const buffer = message && message.t === "recycle" ? message.buffer : null;
    if (buffer instanceof ArrayBuffer && buffer.byteLength === BATCH_FRAMES * 4 && this.pool.length < POOL_LIMIT) {
      this.pool.push(buffer);
    }
  }

  take() {
    const buffer = this.pool.pop() || new ArrayBuffer(BATCH_FRAMES * 4);
    return new Int16Array(buffer);
  }

  flush() {
    if (!this.batch || this.fill === 0 || !this.out) return;
    const full = this.batch;
    const frames = this.fill;
    // A part batch at stop is posted with its own length (whole frames only).
    const data = frames === BATCH_FRAMES ? full.buffer : full.buffer.slice(0, frames * 4);
    this.out.postMessage(
      { t: "pcm", streamId: this.streamId, firstFrame: this.firstFrame, sampleRate, data },
      [data],
    );
    this.batch = null;
    this.fill = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    if (!this.out) return true;
    const input = inputs[0] || [];
    const left = input[0];
    const right = input[1] || left;
    const frames = left ? left.length : 128;
    for (let i = 0; i < frames; i++) {
      if (!this.batch) {
        this.batch = this.take();
        this.fill = 0;
        this.firstFrame = currentFrame + i;
      }
      const at = this.fill * 2;
      this.batch[at] = left ? toInt16(left[i]) : 0;
      this.batch[at + 1] = right ? toInt16(right[i]) : 0;
      this.fill++;
      if (this.fill === BATCH_FRAMES) this.flush();
    }
    return true;
  }
}

function toInt16(sample) {
  const v = Math.round(sample * 32768);
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return Number.isNaN(v) ? 0 : v;
}

registerProcessor("hh-clip-tap", ClipTapProcessor);
