import { describe, expect, it } from "vitest";
import { avcCodecString, avcLevelHex, profileOfCodec } from "../avcLevel";
import { probeAudio, probeOpfs, probeVideo, probeVideoConfig, runProbe, type ProbeEnv } from "../capabilityProbe";
import {
  allCodecs,
  FakeAudioData,
  FakeOpfs,
  FakeVideoFrame,
  makeAudioEncoder,
  makeVideoEncoder,
  type VideoDevice,
} from "./probeFakes";

function env(device: Partial<VideoDevice> = {}, extra: Partial<ProbeEnv> = {}): ProbeEnv {
  return {
    scope: "worker",
    VideoEncoder: makeVideoEncoder({
      codecs: allCodecs(),
      hardware: true,
      software: true,
      portrait: true,
      ...device,
    }),
    VideoFrame: FakeVideoFrame as unknown as typeof VideoFrame,
    timeoutMs: 50,
    ...extra,
  };
}

describe("avcLevelHex", () => {
  it("uses the frame rate: 720p30 3.1, 720p60 3.2, 1080p30 4.0 (plan 5.1)", () => {
    expect(avcLevelHex(1280, 720, 30)).toBe("1f");
    expect(avcLevelHex(1280, 720, 60)).toBe("20");
    expect(avcLevelHex(1920, 1080, 30)).toBe("28");
  });
  it("handles portrait and the software preset", () => {
    expect(avcLevelHex(720, 1280, 30)).toBe("1f");
    expect(avcLevelHex(540, 960, 30)).toBe("1f");
    expect(avcLevelHex(640, 360, 30)).toBe("1e");
  });
  it("moves up a level for a bitrate the level cannot carry", () => {
    expect(avcLevelHex(1280, 720, 30, { bitrate: 17_000_000, profile: "high" })).toBe("1f");
    expect(avcLevelHex(1280, 720, 30, { bitrate: 17_000_000, profile: "main" })).toBe("20");
  });
  it("returns null for a size no level holds", () => {
    expect(avcLevelHex(16384, 16384, 60)).toBeNull();
  });
  it("builds and reads codec strings", () => {
    expect(avcCodecString("high", "1f")).toBe("avc1.64001f");
    expect(avcCodecString("main", "20")).toBe("avc1.4d0020");
    expect(avcCodecString("baseline", "28")).toBe("avc1.420028");
    expect(profileOfCodec("avc1.4d001f")).toBe("main");
    expect(profileOfCodec("vp8")).toBeNull();
  });
});

describe("probeVideo", () => {
  it("finds hardware High profile at every level, and portrait support", async () => {
    const e = env();
    const v = await probeVideo(e);
    expect(v.ok).toBe(true);
    expect(v.hardware).toBe(true);
    expect(v.levels).toEqual(["1f", "20", "28"]);
    expect(v.codecByLevel).toEqual({ "1f": "avc1.64001f", "20": "avc1.640020", "28": "avc1.640028" });
    expect(v.portrait).toBe(true);
    expect(v.attempts).toHaveLength(4);
    expect(v.attempts.every((a) => a.hardwareAcceleration === "prefer-hardware")).toBe(true);
    // Every probe used latencyMode "quality" (plan 3a).
    const configs = (e.VideoEncoder as unknown as { configs: VideoEncoderConfig[] }).configs;
    expect(configs.every((c) => c.latencyMode === "quality")).toBe(true);
    expect(FakeVideoFrame.open).toBe(0);
  });

  it("falls back to software when no hardware encoder answers", async () => {
    const v = await probeVideo(env({ hardware: false }));
    expect(v.ok).toBe(true);
    expect(v.hardware).toBe(false);
    expect(v.attempts.slice(0, 3).map((a) => [a.codec, a.hardwareAcceleration, a.reason])).toEqual([
      ["avc1.64001f", "prefer-hardware", "unsupported"],
      ["avc1.4d001f", "prefer-hardware", "unsupported"],
      ["avc1.42001f", "prefer-hardware", "unsupported"],
    ]);
    expect(v.attempts[3]).toMatchObject({ codec: "avc1.64001f", hardwareAcceleration: "no-preference", ok: true });
  });

  it("tries High, then Main, then Baseline", async () => {
    const v = await probeVideo(env({ codecs: allCodecs(["1f", "20", "28"], ["4d", "42"]) }));
    expect(v.codecByLevel["1f"]).toBe("avc1.4d001f");
    const baselineOnly = await probeVideo(env({ codecs: allCodecs(["1f"], ["42"]) }));
    expect(baselineOnly.levels).toEqual(["1f"]);
    expect(baselineOnly.codecByLevel["1f"]).toBe("avc1.42001f");
  });

  it("records a device that rejects portrait coded frames", async () => {
    const v = await probeVideo(env({ portrait: false }));
    expect(v.ok).toBe(true);
    expect(v.portrait).toBe(false);
  });

  it("reports no H.264 when nothing encodes", async () => {
    const v = await probeVideo(env({ codecs: new Set() }));
    expect(v.ok).toBe(false);
    expect(v.levels).toEqual([]);
    const none = await probeVideo({ scope: "worker" });
    expect(none.ok).toBe(false);
    expect(none.attempts).toEqual([]);
  });
});

describe("probeVideoConfig", () => {
  const target = { width: 1280, height: 720, fps: 30 };
  it("times out on an encoder that never outputs, and closes it", async () => {
    const a = await probeVideoConfig(env({ stuck: true }), "avc1.64001f", target, "prefer-hardware");
    expect(a).toMatchObject({ ok: false, reason: "timeout" });
  });
  it("fails on an encoder error", async () => {
    const a = await probeVideoConfig(env({ failConfigure: true }), "avc1.64001f", target, "prefer-hardware");
    expect(a).toMatchObject({ ok: false, reason: "error" });
  });
  it("fails when the first chunk is not a keyframe", async () => {
    const a = await probeVideoConfig(env({ deltaFirst: true }), "avc1.64001f", target, "prefer-hardware");
    expect(a).toMatchObject({ ok: false, reason: "not-key" });
  });
  it("fails when isConfigSupported throws", async () => {
    const a = await probeVideoConfig(env({ throwOnSupport: true }), "avc1.64001f", target, "prefer-hardware");
    expect(a).toMatchObject({ ok: false, reason: "threw" });
  });
  it("encodes exactly 2 frames", async () => {
    const a = await probeVideoConfig(env(), "avc1.64001f", target, "prefer-hardware");
    expect(a).toMatchObject({ ok: true, outputs: 2, reason: null });
  });
});

describe("probeAudio", () => {
  const withAudio = (flavor: Parameters<typeof makeAudioEncoder>[0], data = true): ProbeEnv => ({
    scope: "worker",
    AudioEncoder: makeAudioEncoder(flavor),
    AudioData: data ? (FakeAudioData as unknown as typeof AudioData) : undefined,
    timeoutMs: 50,
  });
  it("Chromium: AAC encodes with a raw AudioSpecificConfig", async () => {
    expect(await probeAudio(withAudio("chromium"))).toEqual({ aac: true, reason: null, description: "asc" });
  });
  it("WebKit: AAC encodes, and the broken esds description is recognized (302253)", async () => {
    expect(await probeAudio(withAudio("webkit"))).toEqual({ aac: true, reason: null, description: "esds" });
  });
  it("iOS that throws from isConfigSupported has no native AAC", async () => {
    expect(await probeAudio(withAudio("ios-throws"))).toMatchObject({ aac: false, reason: "threw" });
  });
  it("no AudioData means the encoder cannot be fed (Safari before 26)", async () => {
    expect(await probeAudio(withAudio("chromium", false))).toMatchObject({ aac: false, reason: "no-audiodata" });
  });
  it("unsupported, missing and silent encoders", async () => {
    expect(await probeAudio(withAudio("unsupported"))).toMatchObject({ aac: false, reason: "unsupported" });
    expect(await probeAudio({ scope: "worker" })).toMatchObject({ aac: false, reason: "missing" });
    expect(await probeAudio(withAudio("silent"))).toMatchObject({ aac: false, reason: "no-output" });
  });
});

describe("probeOpfs", () => {
  it("writes, reads back and removes its file in a worker", async () => {
    const fs = new FakeOpfs();
    expect(await probeOpfs({ scope: "worker", getDirectory: () => fs.getDirectory() })).toBe(true);
    expect(fs.files.size).toBe(0);
  });
  it("is false in window scope, without sync handles, and when OPFS throws", async () => {
    const fs = new FakeOpfs();
    expect(await probeOpfs({ scope: "window", getDirectory: () => fs.getDirectory() })).toBe(false);
    fs.syncHandles = false;
    expect(await probeOpfs({ scope: "worker", getDirectory: () => fs.getDirectory() })).toBe(false);
    expect(fs.files.size).toBe(0);
    expect(
      await probeOpfs({
        scope: "worker",
        getDirectory: () => Promise.reject(new DOMException("private", "SecurityError")),
      }),
    ).toBe(false);
  });
});

describe("runProbe", () => {
  it("combines video, audio, AudioData, AudioDecoder and OPFS", async () => {
    const fs = new FakeOpfs();
    const report = await runProbe({
      ...env(),
      AudioEncoder: makeAudioEncoder("webkit"),
      AudioData: FakeAudioData as unknown as typeof AudioData,
      AudioDecoder: undefined,
      getDirectory: () => fs.getDirectory(),
    });
    expect(report.scope).toBe("worker");
    expect(report.video.ok).toBe(true);
    expect(report.audio.aac).toBe(true);
    expect(report.audioData).toBe(true);
    expect(report.audioDecoder).toBe(false);
    expect(report.opfsSyncAccess).toBe(true);
  });
});
