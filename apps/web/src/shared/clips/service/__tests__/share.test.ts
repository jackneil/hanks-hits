import { describe, expect, it, vi } from "vitest";

import { SAVE_URL_LIFETIME_MS, fileNameFor, renameFile, saveFile, shareFile, type ShareEnv } from "../share";

function domError(name: string): Error {
  return new DOMException("x", name);
}

function clip(name = "a.mp4", type = "video/mp4"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function shareEnv(share: (data: ShareData) => Promise<void>, canShare: (data: ShareData) => boolean = () => true) {
  const log = vi.fn();
  const env: ShareEnv = { navigator: { share: vi.fn(share), canShare: vi.fn(canShare) }, log };
  return { env, log };
}

describe("shareFile", () => {
  it("calls navigator.share with the file only, before it returns (inside the tap)", async () => {
    const { env } = shareEnv(async () => undefined);
    const file = clip();
    const pending = shareFile(file, env);
    // Synchronous: the call happened before any await.
    expect(env.navigator!.share).toHaveBeenCalledWith({ files: [file] });
    expect(env.navigator!.canShare).toHaveBeenCalledWith({ files: [file] });
    expect(await pending).toEqual({ kind: "shared" });
  });

  it("maps each share result to its outcome", async () => {
    const cases: Array<[Error, string]> = [
      [domError("AbortError"), "cancelled"],
      [domError("InvalidStateError"), "ignored"],
      [domError("NotAllowedError"), "retry"],
      [new TypeError("no files"), "fallback-save"],
      [domError("DataError"), "fallback-save"],
    ];
    for (const [error, kind] of cases) {
      const { env } = shareEnv(async () => {
        throw error;
      });
      expect(await shareFile(clip(), env)).toEqual({ kind });
    }
  });

  it("says blocked when the same file is refused a second time", async () => {
    const { env, log } = shareEnv(async () => {
      throw domError("NotAllowedError");
    });
    const file = clip();
    expect(await shareFile(file, env)).toEqual({ kind: "retry" });
    expect(await shareFile(file, env)).toEqual({ kind: "blocked" });
    // Another file starts with a retry again.
    expect(await shareFile(clip(), env)).toEqual({ kind: "retry" });
    for (const [message] of log.mock.calls) expect(String(message)).not.toMatch(/a\.mp4/);
  });

  it("falls back to save when canShare refuses the type, and is unsupported with no share sheet", async () => {
    const { env } = shareEnv(async () => undefined, () => false);
    expect(await shareFile(clip(), env)).toEqual({ kind: "fallback-save" });
    expect(env.navigator!.share).not.toHaveBeenCalled();
    expect(await shareFile(clip(), { navigator: {}, log: () => undefined })).toEqual({ kind: "unsupported" });
  });

  it("handles a share that throws synchronously", async () => {
    const env: ShareEnv = {
      navigator: {
        share: () => {
          throw domError("AbortError");
        },
      },
      log: () => undefined,
    };
    expect(await shareFile(clip(), env)).toEqual({ kind: "cancelled" });
  });

  it("logs only error type names, never file names", async () => {
    const { env, log } = shareEnv(async () => {
      throw new Error("secret-kid-name.mp4 failed");
    });
    await shareFile(clip("secret-kid-name.mp4"), env);
    expect(log).toHaveBeenCalled();
    for (const [message] of log.mock.calls) expect(String(message)).not.toContain("secret");
  });
});

describe("saveFile", () => {
  it("clicks a hidden download link with the file name and releases the URL later", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const createObjectURL = vi.fn(() => "blob:clip");
    const revokeObjectURL = vi.fn();
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    const env: ShareEnv = {
      document,
      URL: { createObjectURL, revokeObjectURL } as unknown as ShareEnv["URL"],
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      log: () => undefined,
    };
    expect(await saveFile(clip("hankshits-com-snake-20260928-1405.mp4"), env)).toEqual({ kind: "saved" });
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("hankshits-com-snake-20260928-1405.mp4");
    expect(clicked[0].getAttribute("href")).toBe("blob:clip");
    expect(clicked[0].isConnected).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(timers[0].ms).toBe(SAVE_URL_LIFETIME_MS);
    timers[0].fn();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:clip");
    click.mockRestore();
  });

  it("fails with a reason, and releases the URL, when the click throws", async () => {
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw domError("SecurityError");
    });
    const log = vi.fn();
    const env: ShareEnv = {
      document,
      URL: { createObjectURL: () => "blob:x", revokeObjectURL } as unknown as ShareEnv["URL"],
      log,
    };
    expect(await saveFile(clip(), env)).toEqual({ kind: "failed", reason: "blocked" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(log).toHaveBeenCalledWith("[clips] save: failed (SecurityError)");
    click.mockRestore();
  });

  it("fails without a document", async () => {
    expect(await saveFile(clip(), { log: () => undefined })).toEqual({ kind: "failed", reason: "unknown" });
  });
});

describe("fileNameFor", () => {
  const at = new Date(2026, 8, 28, 14, 5).getTime();

  it("builds <host-slug>-<game>-<yyyymmdd-hhmm>.<ext> from the deployment host", () => {
    expect(fileNameFor({ gameId: "flappy-bird", createdAt: at, mime: "video/mp4" }, "hankshits.com")).toBe(
      "hankshits-com-flappy-bird-20260928-1405.mp4",
    );
    expect(fileNameFor({ gameId: "snake", createdAt: at, mime: "video/webm" }, "www.jimmies-hits.up.railway.app")).toBe(
      "jimmies-hits-up-railway-app-snake-20260928-1405.webm",
    );
    expect(fileNameFor({ gameId: "breakout", createdAt: at, mime: "image/png" }, "localhost:3000")).toBe(
      "localhost-3000-breakout-20260928-1405.png",
    );
  });

  it("never lets odd characters into the name", () => {
    expect(fileNameFor({ gameId: "../..", createdAt: NaN, mime: "video/mp4" }, "")).toBe("clip-game-clip.mp4");
  });

  it("renames a file without changing its bytes or type", async () => {
    const renamed = renameFile(clip("snake-clip-2026-09-28.mp4"), { gameId: "snake", createdAt: at, mime: "video/mp4" }, "hankshits.com");
    expect(renamed.name).toBe("hankshits-com-snake-20260928-1405.mp4");
    expect(renamed.type).toBe("video/mp4");
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(renamed);
    });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
