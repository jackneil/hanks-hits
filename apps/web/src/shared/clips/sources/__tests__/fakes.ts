/**
 * Frame-pump sink double for the clips sources tests.
 * The canvas, context, rAF realm and VideoFrame doubles are shared: they are
 * in src/__tests__/canvas-mock.ts.
 */
import type { EncodeCmd, FrameIn } from "../../protocol";
import type { FramePump, FrameSink } from "../../runtime/framePump";

/** A MessagePort-like sink for the frame pump. The test decides when frames are consumed. */
export class RecordingSink implements FrameSink {
  messages: EncodeCmd[] = [];
  private unconsumed = 0;
  postMessage(message: EncodeCmd): void {
    this.messages.push(message);
    if (message.t === "frame" || message.t === "pixels") this.unconsumed++;
  }
  frames(): FrameIn[] {
    return this.messages.filter((m): m is FrameIn => m.t === "frame" || m.t === "pixels");
  }
  consumeAll(pump: FramePump): void {
    while (this.unconsumed > 0) {
      this.unconsumed--;
      pump.consumed();
    }
  }
}
