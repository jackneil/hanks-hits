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
 *   { t: "flush" }                 post the part batch now (the tap pauses:
 *                                  the next samples come after a gap)
 *   { t: "stop" }                  stop: post the part batch, end the node
 *
 * PcmBatch: { t: "pcm", streamId, firstFrame, sampleRate, data }
 *   firstFrame is the frame index of the first sample in this context's own
 *   clock (the worklet's currentFrame), so the mixer can place every batch
 *   exactly, also across a suspend and resume. `data` is an ArrayBuffer of
 *   Int16 samples, interleaved L,R.
 *
 * Conversion: sample * 32768, rounded, clamped to [-32768, 32767] (the mixer
 * divides by 32768). NaN becomes 0. A mono input is copied to both sides
 * (the node also asks the browser to up-mix with channelCount 2). An input
 * with no channels (no game sound plays) is written as silence, so the
 * stream stays contiguous.
 *
 * No garbage on the audio thread (plan 6.4): this thread renders the game's
 * own sound, so a garbage collection here can make the game crackle. The
 * processor fills ONE batch buffer again and again and posts it with ONE
 * message object that it changes in place. postMessage copies the bytes
 * (structured clone) before it returns, so the buffer is free again at once,
 * and the processor makes no new object for a full batch. Only a part batch
 * (at "flush" and "stop", not during play) makes a new, shorter buffer.
 */

/* global AudioWorkletProcessor, registerProcessor, currentFrame, sampleRate */

const BATCH_FRAMES = 2048;

class ClipTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.stopped = false;
    // One buffer and one message for the life of the node (see the file comment).
    this.batch = new Int16Array(BATCH_FRAMES * 2);
    this.fill = 0;
    this.message = { t: "pcm", streamId: "page", firstFrame: 0, sampleRate, data: this.batch.buffer };
    this.port.onmessage = (event) => this.control(event.data);
  }

  control(message) {
    if (!message || typeof message !== "object") return;
    if (message.t === "port" && message.port) {
      this.out = message.port;
      if (typeof message.streamId === "string") this.message.streamId = message.streamId;
    } else if (message.t === "flush") {
      this.flush();
    } else if (message.t === "stop") {
      this.flush();
      this.stopped = true;
      if (this.out) this.out.close();
      this.out = null;
    }
  }

  /** Posts the samples of the open batch, if any. */
  flush() {
    const frames = this.fill;
    this.fill = 0;
    if (frames === 0 || !this.out) return;
    const message = this.message;
    // A full batch posts the reused buffer (the port copies it). A part batch
    // has its own length (whole frames only).
    message.data = frames === BATCH_FRAMES ? this.batch.buffer : this.batch.buffer.slice(0, frames * 4);
    this.out.postMessage(message);
    message.data = this.batch.buffer;
  }

  process(inputs) {
    if (this.stopped) return false;
    if (!this.out) return true;
    const input = inputs[0] || [];
    const left = input[0];
    const right = input[1] || left;
    const frames = left ? left.length : 128;
    const batch = this.batch;
    for (let i = 0; i < frames; i++) {
      if (this.fill === 0) this.message.firstFrame = currentFrame + i;
      const at = this.fill * 2;
      batch[at] = left ? toInt16(left[i]) : 0;
      batch[at + 1] = right ? toInt16(right[i]) : 0;
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
