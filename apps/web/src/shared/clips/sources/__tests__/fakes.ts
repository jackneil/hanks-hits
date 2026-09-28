/**
 * Test doubles for the clips sources tests (single copy for this folder).
 * - FakeCanvas: a canvas with one context type, in a chosen realm.
 * - FakeVideoFrame: records what it was made from; throws like the real
 *   constructor for a tainted canvas.
 * - RecordingSink: a MessagePort-like sink for the frame pump.
 */
import type { EncodeCmd, FrameIn } from "../../protocol";
import type { FramePump, FrameSink } from "../../runtime/framePump";

export type ContextKind = "2d" | "webgl" | "webgl2" | "none" | "throws";

export class FakeCanvas extends EventTarget {
  width: number;
  height: number;
  /** The picture the game drew last (a frame number). */
  content = 0;
  /** Set to make new VideoFrame(canvas) throw a SecurityError. */
  tainted = false;
  readonly ownerDocument: { defaultView: unknown };
  readonly probes: string[] = [];

  constructor(
    realm: unknown,
    readonly kind: ContextKind,
    readonly context: unknown = {},
    width = 480,
    height = 640,
  ) {
    super();
    this.ownerDocument = { defaultView: realm };
    this.width = width;
    this.height = height;
  }

  getContext(type: string): unknown {
    this.probes.push(type);
    if (this.kind === "throws") throw new DOMException("transferred", "InvalidStateError");
    if (type === this.kind) return this.context;
    if (this.kind === "webgl" && type === "experimental-webgl") return this.context;
    return null;
  }

  get asElement(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement;
  }
}

export class FakeVideoFrame {
  static made: FakeVideoFrame[] = [];
  closed = false;
  readonly content: number;
  constructor(
    readonly source: unknown,
    readonly init: VideoFrameInit,
  ) {
    const canvas = source as FakeCanvas;
    if (canvas.tainted) throw new DOMException("tainted", "SecurityError");
    if (canvas.width === 0 || canvas.height === 0) throw new DOMException("empty", "InvalidStateError");
    this.content = canvas.content;
    FakeVideoFrame.made.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

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
