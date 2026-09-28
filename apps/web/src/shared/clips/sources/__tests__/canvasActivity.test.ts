import { describe, expect, it } from "vitest";
import { CanvasRealm, FakeContext2D, FakeWebGLContext } from "@/__tests__/canvas-mock";
import { GL, WebGL2Mock } from "@/__tests__/webgl2-mock";
import { hasRafDispatcher } from "../../runtime/rafDispatcher";
import { installCanvasActivity, pathForContextType, type CanvasRecord } from "../canvasActivity";

describe("installCanvasActivity", () => {
  it("records the type and the context when the game calls getContext, and never calls it itself", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    const canvases = { two: realm.createCanvas(), gl1: realm.createCanvas(), gl2: realm.createCanvas(), none: realm.createCanvas() };
    const seen: CanvasRecord[] = [];
    activity.onContext((r) => seen.push(r));
    const c2d = canvases.two.getContext("2d");
    const c1 = canvases.gl1.getContext("experimental-webgl");
    const c2 = canvases.gl2.getContext("webgl2");
    expect(activity.record(canvases.two)).toMatchObject({ type: "2d", context: c2d, drawSeq: 0, drawFrames: 0 });
    expect(activity.record(canvases.gl1)).toMatchObject({ type: "webgl", context: c1 });
    expect(activity.record(canvases.gl2)).toMatchObject({ type: "webgl2", context: c2 });
    expect(activity.record(canvases.none)).toBeUndefined();
    expect(canvases.none.getContextCalls).toEqual([]);
    expect(seen.map((r) => r.type)).toEqual(["2d", "webgl", "webgl2"]);
    // A second getContext of the same type does not make a new record.
    canvases.two.getContext("2d");
    expect(seen).toHaveLength(3);
    activity.uninstall();
  });

  it("learns a context made before the install from its first draw", () => {
    const realm = new CanvasRealm();
    const canvas = realm.createCanvas();
    const ctx = canvas.getContext("2d") as FakeContext2D;
    const activity = installCanvasActivity(realm);
    expect(activity.record(canvas)).toBeUndefined();
    ctx.drawPicture(1);
    expect(activity.record(canvas)).toMatchObject({ type: "2d", context: ctx, drawSeq: 2, drawFrames: 1 });
    activity.uninstall();
  });

  it("counts draws and frames with draws, and tells listeners once per frame", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    const canvas = realm.createCanvas();
    const ctx = canvas.getContext("2d") as FakeContext2D;
    const drawn: number[] = [];
    activity.onFrameDrawn((r) => drawn.push(r.drawFrames));
    let n = 0;
    const loop = () => {
      n++;
      if (n !== 3) ctx.drawPicture(n); // frame 3 draws nothing
      realm.requestAnimationFrame(loop);
    };
    realm.requestAnimationFrame(loop);
    realm.run(0, 60, 5);
    const record = activity.record(canvas)!;
    expect(record.drawFrames).toBe(4);
    expect(record.drawSeq).toBe(8);
    expect(drawn).toEqual([1, 2, 3, 4]);
    activity.uninstall();
  });

  it("counts WebGL draws only while the default framebuffer is bound", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    const canvas = realm.createCanvas();
    const gl = canvas.getContext("webgl2") as WebGL2Mock;
    const record = activity.record(canvas)!;
    const target = gl.createFramebuffer();
    gl.bindFramebuffer(GL.FRAMEBUFFER, target);
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.drawArrays(4, 0, 3);
    expect(record.drawSeq).toBe(0);
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
    gl.drawElements(4, 3, 0x1403, 0);
    gl.drawArraysInstanced(4, 0, 3, 2);
    expect(record.drawSeq).toBe(2);
    // Deleting the bound framebuffer binds the default one again.
    gl.bindFramebuffer(GL.FRAMEBUFFER, target);
    gl.deleteFramebuffer(target);
    gl.drawArrays(4, 0, 3);
    expect(record.drawSeq).toBe(3);
    // A blit into the default framebuffer shows a picture too.
    const source = gl.createFramebuffer();
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, source);
    gl.blitFramebuffer(0, 0, 1, 1, 0, 0, 1, 1, GL.COLOR_BUFFER_BIT, GL.NEAREST);
    expect(record.drawSeq).toBe(4);
    activity.uninstall();
  });

  it("asks the binding once for a context whose binds it did not see", () => {
    const realm = new CanvasRealm();
    const canvas = realm.createCanvas();
    const gl = canvas.getContext("webgl") as FakeWebGLContext;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    const activity = installCanvasActivity(realm);
    gl.drawArrays(4, 0, 3);
    expect(activity.record(canvas)).toBeUndefined();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(4, 0, 3);
    expect(activity.record(canvas)).toMatchObject({ type: "webgl", drawSeq: 1 });
    activity.uninstall();
  });

  it("forgets the binding after a context loss and restore", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    const canvas = realm.createCanvas();
    const gl = canvas.getContext("webgl2") as WebGL2Mock;
    gl.bindFramebuffer(GL.FRAMEBUFFER, gl.createFramebuffer());
    gl.loseContext();
    canvas.dispatchEvent(new Event("webglcontextlost"));
    gl.restoreContext();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    gl.clear(GL.COLOR_BUFFER_BIT);
    expect(activity.record(canvas)!.drawSeq).toBe(1);
    activity.uninstall();
  });

  it("counts draws through a multi-draw extension the game gets after the install", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    const canvas = realm.createCanvas();
    const gl = canvas.getContext("webgl2") as WebGL2Mock;
    const ext = gl.getExtension("WEBGL_multi_draw") as { multiDrawArraysWEBGL: () => void };
    const record = activity.record(canvas)!;
    gl.nextPicture = 9;
    ext.multiDrawArraysWEBGL();
    expect(record.drawSeq).toBe(1);
    expect(gl.frameId).toBe(9);
    activity.uninstall();
    // Uninstall puts the extension's own method back; it still draws.
    gl.nextPicture = 10;
    ext.multiDrawArraysWEBGL();
    expect(record.drawSeq).toBe(1);
    expect(gl.frameId).toBe(10);
  });

  it("is reference counted, and uninstall restores every method exactly", () => {
    const realm = new CanvasRealm();
    const protos = [
      realm.HTMLCanvasElement.prototype,
      realm.CanvasRenderingContext2D.prototype,
      realm.WebGLRenderingContext.prototype,
      realm.WebGL2RenderingContext.prototype,
      realm.ImageBitmapRenderingContext.prototype,
    ];
    const before = protos.map((p) => Object.getOwnPropertyNames(p));
    const a = installCanvasActivity(realm);
    const b = installCanvasActivity(realm);
    expect(Object.getOwnPropertyNames(realm.CanvasRenderingContext2D.prototype)).toContain("fillRect");
    a.uninstall();
    expect(Object.getOwnPropertyNames(realm.CanvasRenderingContext2D.prototype)).toContain("fillRect");
    b.uninstall();
    expect(protos.map((p) => Object.getOwnPropertyNames(p))).toEqual(before);
    expect(hasRafDispatcher(realm)).toBe(false);
    // The fakes' own methods still work.
    const ctx = realm.createCanvas().getContext("2d") as FakeContext2D;
    ctx.drawPicture(3);
    expect(ctx.canvas.content).toBe(3);
  });

  it("restores an own method with its original descriptor", () => {
    const realm = new CanvasRealm();
    const proto = realm.CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
    const own = function fillRect(this: FakeContext2D) {
      this.canvas.content = 42;
    };
    Object.defineProperty(proto, "fillRect", { value: own, writable: true, configurable: true, enumerable: true });
    const activity = installCanvasActivity(realm);
    activity.uninstall();
    expect(Object.getOwnPropertyDescriptor(proto, "fillRect")).toEqual({ value: own, writable: true, configurable: true, enumerable: true });
  });

  it("leaves a later wrapper in place and becomes a pass-through", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    const proto = realm.CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => void>;
    const ours = proto.fillRect;
    let theirs = 0;
    proto.fillRect = function (this: unknown, ...args: unknown[]) {
      theirs++;
      return ours.apply(this, args);
    };
    const canvas = realm.createCanvas();
    const ctx = canvas.getContext("2d") as FakeContext2D;
    activity.uninstall();
    ctx.fillRect(0, 0, 1, 1);
    expect(theirs).toBe(1);
    // A new tracker still works on top of the chain.
    const again = installCanvasActivity(realm);
    ctx.drawPicture(2);
    expect(again.record(canvas)?.drawSeq).toBe(2);
    again.uninstall();
  });

  it("never throws into the game when a listener throws", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    activity.onFrameDrawn(() => {
      throw new Error("listener bug");
    });
    const ctx = realm.createCanvas().getContext("2d") as FakeContext2D;
    expect(() => ctx.drawPicture(1)).not.toThrow();
    expect(realm.errors).toHaveLength(1);
    activity.uninstall();
  });

  it("an uninstall on a dead realm touches nothing through it", () => {
    const realm = new CanvasRealm();
    const activity = installCanvasActivity(realm);
    realm.simulateNavigation();
    // The new document installs its own tracker through the same object.
    const fresh = installCanvasActivity(realm);
    activity.uninstall();
    const ctx = realm.createCanvas().getContext("2d") as FakeContext2D;
    ctx.drawPicture(1);
    expect(fresh.record(ctx.canvas as unknown as object)?.drawSeq).toBe(2);
    fresh.uninstall();
  });

  it("maps context types to capture paths", () => {
    expect(pathForContextType("2d")).toBe("P");
    expect(pathForContextType("webgl2")).toBe("E");
    expect(pathForContextType("webgl")).toBe("D");
    expect(pathForContextType("bitmaprenderer")).toBe("D");
    expect(pathForContextType("other")).toBe("D");
  });

  it("does nothing in a realm without canvas classes", () => {
    const realm = new CanvasRealm();
    const bare = { requestAnimationFrame: realm.requestAnimationFrame, cancelAnimationFrame: realm.cancelAnimationFrame };
    const activity = installCanvasActivity(bare);
    expect(activity.record({})).toBeUndefined();
    activity.uninstall();
  });

  it("records bitmap renderer contexts from their transfers", () => {
    const realm = new CanvasRealm();
    const canvas = realm.createCanvas();
    const ctx = canvas.getContext("bitmaprenderer") as { transferFromImageBitmap(b: { picture: number }): void };
    const activity = installCanvasActivity(realm);
    ctx.transferFromImageBitmap({ picture: 7 });
    expect(activity.record(canvas)).toMatchObject({ type: "bitmaprenderer", drawSeq: 1 });
    expect(canvas.content).toBe(7);
    activity.uninstall();
  });
});

describe("WebGL2Mock is a WebGLRenderingContext-like context", () => {
  it("is not a WebGL1 context", () => {
    const realm = new CanvasRealm();
    const gl = realm.createCanvas().getContext("webgl2");
    expect(gl).toBeInstanceOf(WebGL2Mock);
    expect(gl).not.toBeInstanceOf(FakeWebGLContext);
  });
});
