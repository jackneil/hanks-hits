import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "../[...path]/route";
import { NextRequest } from "next/server";

const req = () =>
  new NextRequest("http://localhost/api/roms/snes/test.smc");
const params = (segments: string[]) => ({
  params: Promise.resolve({ path: segments }),
});

function bodyStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(c);
      ctrl.close();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ROM proxy route", () => {
  it("follows one validated redirect hop and streams the ROM", async () => {
    const rom = new Uint8Array(1024).fill(7);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://storage.railway.app/bucket/test.smc?X-Amz-Signature=x" },
        })
      )
      .mockResolvedValueOnce(
        new Response(bodyStream([rom]), {
          status: 200,
          headers: { "content-length": String(rom.byteLength) },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(req(), params(["snes", "test.smc"]));

    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(1024);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("storage.railway.app");
  });

  it("404s (and does not fetch) when the redirect points off the pinned host", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.com/rom.smc" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req(), params(["snes", "test.smc"]));

    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second hop
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("redirect rejected (host: evil.example.com)")
    );
  });

  it("404s on a second redirect (one hop only)", async () => {
    const redirect = () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://storage.railway.app/bounce.smc" },
      });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(redirect()).mockResolvedValueOnce(redirect()));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req(), params(["snes", "test.smc"]));

    expect(res.status).toBe(404);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("upstream returned 302")
    );
  });

  it("aborts a stream that exceeds the byte cap even without content-length", async () => {
    // 65 chunks of 1MiB = 65MiB > 64MiB cap; upstream sends NO content-length
    const chunk = new Uint8Array(1024 * 1024);
    const chunks = Array.from({ length: 65 }, () => chunk);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(bodyStream(chunks), { status: 200 }))
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req(), params(["snes", "huge.smc"]));
    expect(res.status).toBe(200); // headers already sent; the STREAM must die

    let failed = false;
    let received = 0;
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value!.byteLength;
      }
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(received).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("exceeded 67108864 bytes")
    );
  });

  it("400s on path traversal and bad segments without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect((await GET(req(), params(["..", "secrets"]))).status).toBe(400);
    expect((await GET(req(), params(["snes", "a/b.smc"]))).status).toBe(400);
    expect((await GET(req(), params([]))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
