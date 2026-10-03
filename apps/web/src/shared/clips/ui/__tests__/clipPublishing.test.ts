import { afterEach, describe, expect, it, vi } from "vitest";
import { publishForm, safeReturnTo, uploadClip } from "../clipPublishing";
import { makeRecord } from "./fakeClipService";

afterEach(() => vi.unstubAllGlobals());
describe("publishing the actual captured run", () => {
  it("omits an absent score but retains an actual zero", () => {
    const video = new File(["video"], "run.mp4", { type: "video/mp4" });
    const poster = new Blob(["cover"], { type: "image/jpeg" });
    expect(publishForm(makeRecord(), video, poster).has("runScore")).toBe(false);
    expect(publishForm(makeRecord({ challengeScore: 0 }), video, poster).get("runScore")).toBe("0");
    expect(publishForm(makeRecord({ challengeScore: 42 }), video, poster).get("runScore")).toBe("42");
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil.test"])("refuses external login continuation %s", (path) => {
    expect(safeReturnTo(path)).toBe("/");
  });
  it("keeps a game return path and query on this origin", () => {
    expect(safeReturnTo("/games/snake?from=clip#play")).toBe("/games/snake?from=clip#play");
  });
  it("binds upload to the expected account, reports real progress and keeps the file for retry", async () => {
    const sent: FormData[] = [];
    const headers: Record<string, string> = {};
    const instances: FakeXHR[] = [];
    class FakeXHR {
      status = 502; response: unknown = { code: "storage_failed" }; responseType = "";
      upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
      onload?: () => void; onerror?: () => void; onabort?: () => void;
      constructor() { instances.push(this); }
      open = vi.fn(); setRequestHeader = (key: string, value: string) => { headers[key] = value; };
      send = (form: FormData) => { sent.push(form); }; abort = () => this.onabort?.();
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const record = makeRecord(); const file = new File(["video"], "run.mp4"); const poster = new Blob(["cover"]);
    const progress = vi.fn();
    const first = uploadClip(record, file, poster, "owner-a", new AbortController().signal, progress);
    expect(headers["x-hh-expected-owner"]).toBe("owner-a");
    instances[instances.length - 1].upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 });
    expect(progress).toHaveBeenCalledWith(50);
    instances[instances.length - 1].onload?.(); await expect(first).rejects.toMatchObject({ code: "storage_failed" });
    const retry = uploadClip(record, file, poster, "owner-a", new AbortController().signal, progress);
    instances[instances.length - 1].status = 201; instances[instances.length - 1].response = { clip: { id: "published" }, replaced: false }; instances[instances.length - 1].onload?.();
    await expect(retry).resolves.toMatchObject({ clip: { id: "published" } });
    expect(sent).toHaveLength(2); expect(sent[1].get("video")).toBeInstanceOf(File);
  });
});
