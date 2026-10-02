import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "../[...path]/route";
import { NextRequest } from "next/server";

// Each req() gets a unique client IP so the per-IP ROM rate-limit bucket never
// accumulates across the suite (the limiter uses a module-level store). The
// dedicated 429 test below deliberately pins ONE ip to exhaust its budget.
let ipCounter = 0;
const req = () =>
  new NextRequest("http://localhost/api/roms/snes/test.smc", {
    headers: { "x-real-ip": `198.51.100.${ipCounter++ % 250}` },
  });
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

  it("404s every ROM that a block rule matches (sexual content), without touching the network", async () => {
    // Guardrail 1, issue #25: the objects stay in the bucket until Jack
    // deletes them, so the URL of an adult cartridge must not play.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const blocked: [string[], string][] = [
      [["atari2600", "bachelor.bin"], "bachelor-party"],
      [["atari2600", "bachelor_party.bin"], "bachelor-party"],
      [["atari2600", "bachelorette_party.bin"], "bachelor-party"],
      [["atari2600", "beat_em_and_eat_em.bin"], "beat-em-and-eat-em"],
      [["atari2600", "burning_desire.bin"], "burning-desire"],
      [["atari2600", "cathouse_blues.bin"], "cathouse-blues"],
      [["atari2600", "custerev.bin"], "custers-revenge"],
      [["atari2600", "custers_revenge.bin"], "custers-revenge"],
      [["atari2600", "general_re_treat.bin"], "general-re-treat"],
      [["atari2600", "gigolo.bin"], "gigolo"],
      [["atari2600", "harem.bin"], "harem"],
      [["atari2600", "jungle_fever.bin"], "jungle-fever"],
      [["atari2600", "knight_on_the_town.bin"], "knight-on-the-town"],
      [["atari2600", "lady_in_wading.bin"], "lady-in-wading"],
      [["atari2600", "philly_flasher.bin"], "philly-flasher"],
      [["atari2600", "x_man.bin"], "x-man-universal-gamex"],
    ];
    for (const [segments, ruleId] of blocked) {
      const res = await GET(req(), params(segments));
      expect(res.status, segments.join("/")).toBe(404);
      expect(warnSpy).toHaveBeenLastCalledWith(
        `ROM proxy: refused /${segments.join("/")} (content rule: ${ruleId})`
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves every ROM that a notice rule matches (violent classics, Jack 2026-10-02)", async () => {
    // The arcade shows the heads-up card before it asks for the ROM, so the
    // proxy does not refuse these files.
    const rom = new Uint8Array(16).fill(2);
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(bodyStream([rom]), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const notice: string[][] = [
      ["snes", "alien_3.smc"],
      ["snes", "alien_vs_predator.smc"],
      ["snes", "cannon_fodder.smc"],
      ["snes", "doom.smc"],
      ["snes", "killer_instinct.smc"],
      ["snes", "mortal_kombat_1.smc"],
      ["snes", "mortal_kombat_2.smc"],
      ["snes", "mortal_kombat_3.smc"],
      ["snes", "samurai_showdown.smc"],
      ["snes", "super_fire_pro_wrestling_x_premium.smc"],
      ["snes", "super_smash_tv.smc"],
      ["snes", "wolfenstein_3d.smc"],
      ["atari2600", "bloodyhumanfreeway_ntsc.bin"],
      ["atari2600", "halloween.bin"],
      ["atari2600", "texas_chainsaw_massacre.bin"],
      ["atari2600", "texas_chainsaw_massacre_the.bin"],
    ];
    for (const segments of notice) {
      expect((await GET(req(), params(segments))).status, segments.join("/")).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(notice.length);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("still serves a kid-safe ROM whose name looks like a blocked title", async () => {
    const rom = new Uint8Array(16).fill(1);
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(bodyStream([rom]), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    for (const segments of [
      ["snes", "lufia_1_the_fortress_of_doom.smc"],
      ["atari2600", "room_of_doom.bin"],
      ["atari2600", "x_doom.bin"],
    ]) {
      expect((await GET(req(), params(segments))).status, segments.join("/")).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("429s once the per-IP rate limit is exceeded, without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Dedicated IP so this burst can't collide with the other tests' bucket.
    const ip = `192.0.2.${Date.now() % 250}`;
    const bursts = (segments: string[]) =>
      GET(
        new NextRequest("http://localhost/api/roms/snes/test.smc", {
          headers: { "x-real-ip": ip },
        }),
        params(segments)
      );

    // Exhaust the 120/min budget using an INVALID path: the rate-limit check
    // runs first (so each call counts) and the bad path 400s before any fetch.
    for (let i = 0; i < 120; i++) {
      expect((await bursts(["..", "nope"])).status).toBe(400);
    }

    // The 121st is blocked by the limiter before path validation or fetch.
    const blocked = await bursts(["snes", "test.smc"]);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
