// @vitest-environment node
/**
 * The leaderboard clip settings (D6): off unless the bucket is set up,
 * LEADERBOARD_CLIPS=off is the kill switch, and the feature turns itself off
 * when the bucket host is not in the CSP that the build made.
 */
import { describe, expect, it, vi } from "vitest";

import {
  isClipAdmin,
  leaderboardClipsConfig,
  objectOrigin,
  parseAdminUserIds,
  resolveLeaderboardClipsConfig,
  type LeaderboardClipsEnv,
} from "../config";

const RAILWAY: LeaderboardClipsEnv = {
  LEADERBOARD_CLIPS_S3_ENDPOINT: "https://t3.storageapi.dev",
  LEADERBOARD_CLIPS_S3_BUCKET: "hanks-hits-clips-abc123",
  LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: "key-id",
  LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: "secret-value",
};

describe("resolveLeaderboardClipsConfig", () => {
  it("is off and quiet with no bucket settings (a kid clone)", () => {
    const config = resolveLeaderboardClipsConfig({});
    expect(config).toMatchObject({ enabled: false, reason: "not_set_up", bucket: null });
  });

  it("is on for a Railway bucket, with region auto and path-style URLs on t3.storageapi.dev", () => {
    const config = resolveLeaderboardClipsConfig(RAILWAY);
    expect(config.enabled).toBe(true);
    expect(config.bucket).toEqual({
      endpoint: "https://t3.storageapi.dev",
      bucket: "hanks-hits-clips-abc123",
      accessKeyId: "key-id",
      secretAccessKey: "secret-value",
      region: "auto",
      urlStyle: "path",
    });
    expect(objectOrigin(config.bucket!)).toBe("https://t3.storageapi.dev");
  });

  it("takes virtual-hosted style and a region", () => {
    const config = resolveLeaderboardClipsConfig({
      ...RAILWAY,
      LEADERBOARD_CLIPS_S3_URL_STYLE: "VIRTUAL",
      LEADERBOARD_CLIPS_S3_REGION: "us-east-1",
    });
    expect(config.enabled).toBe(true);
    expect(config.bucket).toMatchObject({ urlStyle: "virtual", region: "us-east-1" });
    expect(objectOrigin(config.bucket!)).toBe("https://hanks-hits-clips-abc123.t3.storageapi.dev");
  });

  it.each(["off", "OFF", " off ", "false", "0", "disabled"])("is off when LEADERBOARD_CLIPS=%j (fail closed)", (value) => {
    const config = resolveLeaderboardClipsConfig({ ...RAILWAY, LEADERBOARD_CLIPS: value });
    expect(config).toMatchObject({ enabled: false, reason: "killed" });
    // The sweeper still gets the bucket: deleting old data is a duty.
    expect(config.bucket).not.toBeNull();
  });

  it.each(["", "on", "ON"])("is on when LEADERBOARD_CLIPS=%j", (value) => {
    expect(resolveLeaderboardClipsConfig({ ...RAILWAY, LEADERBOARD_CLIPS: value }).enabled).toBe(true);
  });

  it.each<[string, LeaderboardClipsEnv, string[]]>([
    ["no secret", { ...RAILWAY, LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY: "" }, ["LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY"]],
    ["no key id", { ...RAILWAY, LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID: " " }, ["LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID"]],
    ["an http endpoint on the internet", { ...RAILWAY, LEADERBOARD_CLIPS_S3_ENDPOINT: "http://t3.storageapi.dev" }, ["LEADERBOARD_CLIPS_S3_ENDPOINT"]],
    ["an endpoint with a path", { ...RAILWAY, LEADERBOARD_CLIPS_S3_ENDPOINT: "https://t3.storageapi.dev/bucket" }, ["LEADERBOARD_CLIPS_S3_ENDPOINT"]],
    ["an endpoint with a password", { ...RAILWAY, LEADERBOARD_CLIPS_S3_ENDPOINT: "https://a:b@t3.storageapi.dev" }, ["LEADERBOARD_CLIPS_S3_ENDPOINT"]],
    ["a bad bucket name", { ...RAILWAY, LEADERBOARD_CLIPS_S3_BUCKET: "Bad_Bucket" }, ["LEADERBOARD_CLIPS_S3_BUCKET"]],
    ["a dotted bucket in virtual style", { ...RAILWAY, LEADERBOARD_CLIPS_S3_BUCKET: "clips.example", LEADERBOARD_CLIPS_S3_URL_STYLE: "virtual" }, ["LEADERBOARD_CLIPS_S3_URL_STYLE"]],
    ["an unknown URL style", { ...RAILWAY, LEADERBOARD_CLIPS_S3_URL_STYLE: "sideways" }, ["LEADERBOARD_CLIPS_S3_URL_STYLE"]],
    ["a bad region", { ...RAILWAY, LEADERBOARD_CLIPS_S3_REGION: "us east" }, ["LEADERBOARD_CLIPS_S3_REGION"]],
  ])("is off and names the setting for %s", (_name, env, problems) => {
    const config = resolveLeaderboardClipsConfig(env);
    expect(config).toMatchObject({ enabled: false, reason: "incomplete", bucket: null, problems });
  });

  it("takes a dotted bucket in path style (the default)", () => {
    const config = resolveLeaderboardClipsConfig({
      ...RAILWAY,
      LEADERBOARD_CLIPS_S3_BUCKET: "clips.example",
    });
    expect(config.enabled).toBe(true);
  });

  it("takes an http endpoint on this computer (a local MinIO) in path style", () => {
    const config = resolveLeaderboardClipsConfig({
      ...RAILWAY,
      LEADERBOARD_CLIPS_S3_ENDPOINT: "http://127.0.0.1:9100",
      LEADERBOARD_CLIPS_S3_URL_STYLE: "path",
    });
    expect(config.enabled).toBe(true);
    expect(config.bucket?.endpoint).toBe("http://127.0.0.1:9100");
  });

  it("is off (reason csp) when the bucket host is not in the CSP that the build made", () => {
    const config = resolveLeaderboardClipsConfig({
      ...RAILWAY,
      LEADERBOARD_CLIPS_S3_ENDPOINT: "https://r2.example.com",
      // The build saw no endpoint: only the Railway hosts are in the CSP.
      LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES: "https://t3.storageapi.dev https://*.t3.storageapi.dev",
    });
    expect(config).toMatchObject({ enabled: false, reason: "csp" });
    expect(config.bucket).not.toBeNull();
  });

  it("is on when the build put that host in the CSP", () => {
    const config = resolveLeaderboardClipsConfig({
      ...RAILWAY,
      LEADERBOARD_CLIPS_S3_ENDPOINT: "https://r2.example.com",
      LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES:
        "https://t3.storageapi.dev https://*.t3.storageapi.dev https://r2.example.com",
      LEADERBOARD_CLIPS_S3_URL_STYLE: "path",
    });
    expect(config.enabled).toBe(true);
  });

  it("covers the Railway bucket in both URL styles with the built-in sources", () => {
    const built = "https://t3.storageapi.dev https://*.t3.storageapi.dev";
    for (const style of ["virtual", "path"]) {
      const config = resolveLeaderboardClipsConfig({
        ...RAILWAY,
        LEADERBOARD_CLIPS_S3_URL_STYLE: style,
        LEADERBOARD_CLIPS_CSP_MEDIA_SOURCES: built,
      });
      expect(config.enabled, style).toBe(true);
    }
  });
});

describe("admins (ADMIN_USER_IDS, optional)", () => {
  it("parses comma and space separated ids", () => {
    expect([...parseAdminUserIds(" a, b  c,,d ")]).toEqual(["a", "b", "c", "d"]);
    expect(parseAdminUserIds(undefined).size).toBe(0);
  });

  it("knows an admin also when the feature is off, and never a missing user", () => {
    const config = resolveLeaderboardClipsConfig({ ADMIN_USER_IDS: "admin-1" });
    expect(isClipAdmin(config, "admin-1")).toBe(true);
    expect(isClipAdmin(config, "someone")).toBe(false);
    expect(isClipAdmin(config, null)).toBe(false);
    expect(isClipAdmin(config, "")).toBe(false);
  });
});

describe("leaderboardClipsConfig (process.env)", () => {
  it("reads the settings at each call, so the kill switch works at the next request", () => {
    vi.stubEnv("LEADERBOARD_CLIPS_S3_ENDPOINT", RAILWAY.LEADERBOARD_CLIPS_S3_ENDPOINT!);
    vi.stubEnv("LEADERBOARD_CLIPS_S3_BUCKET", RAILWAY.LEADERBOARD_CLIPS_S3_BUCKET!);
    vi.stubEnv("LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID", RAILWAY.LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID!);
    vi.stubEnv("LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY", RAILWAY.LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY!);
    vi.stubEnv("LEADERBOARD_CLIPS", "");
    try {
      expect(leaderboardClipsConfig().enabled).toBe(true);
      vi.stubEnv("LEADERBOARD_CLIPS", "off");
      expect(leaderboardClipsConfig().enabled).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("logs a settings problem by name, never by value, once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("LEADERBOARD_CLIPS_S3_ENDPOINT", "https://t3.storageapi.dev");
    vi.stubEnv("LEADERBOARD_CLIPS_S3_BUCKET", "hanks-hits-clips-abc123");
    vi.stubEnv("LEADERBOARD_CLIPS_S3_ACCESS_KEY_ID", "super-secret-key-id");
    vi.stubEnv("LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY", "");
    try {
      leaderboardClipsConfig();
      leaderboardClipsConfig();
      const printed = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(printed).toContain("LEADERBOARD_CLIPS_S3_SECRET_ACCESS_KEY");
      expect(printed).not.toContain("super-secret-key-id");
      expect(printed).not.toContain("hanks-hits-clips-abc123");
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
  });
});
