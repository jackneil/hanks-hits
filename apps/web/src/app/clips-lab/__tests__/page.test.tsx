/**
 * Privacy gate of the clips lab route (plan 15.3): /clips-lab answers 404
 * unless the server has CLIPS_LAB=1 when the request comes in.
 */
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("next/server", () => ({ connection }));

import { ClipsLabPage } from "@/shared/clips/lab/ClipsLab";

import ClipsLabRoute, { metadata } from "../page";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

function request(params: Record<string, string | string[] | undefined> = {}) {
  return ClipsLabRoute({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  connection.mockClear();
  connection.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/clips-lab", () => {
  it("answers 404 when CLIPS_LAB is not set", async () => {
    vi.stubEnv("CLIPS_LAB", undefined);
    await expect(request()).rejects.toMatchObject({ digest: NOT_FOUND });
  });

  it.each(["", "0", "true", "yes", "on", " 1", "1 "])("answers 404 when CLIPS_LAB is %j", async (value) => {
    vi.stubEnv("CLIPS_LAB", value);
    await expect(request()).rejects.toMatchObject({ digest: NOT_FOUND });
  });

  it("answers 404 with clips on but the lab off (CLIPS_MODE is not the lab switch)", async () => {
    vi.stubEnv("CLIPS_LAB", undefined);
    vi.stubEnv("CLIPS_MODE", "on");
    await expect(request()).rejects.toMatchObject({ digest: NOT_FOUND });
  });

  it("renders the lab with the options from the query when CLIPS_LAB is 1", async () => {
    vi.stubEnv("CLIPS_LAB", "1");
    const page = (await request({ gl: "2", fps: "30", hold: "3", aac: "wasm" })) as ReactElement<{ options: unknown }>;
    expect(page.type).toBe(ClipsLabPage);
    expect(page.props.options).toEqual({ gl: true, targetFps: 30, hold: 3, aac: "wasm" });
    const plain = (await request()) as ReactElement<{ options: unknown }>;
    expect(plain.props.options).toEqual({ gl: false, targetFps: 60, hold: null, aac: "auto" });
  });

  it("reads CLIPS_LAB at request time, after connection(), so no build can bake the page", async () => {
    let open!: () => void;
    connection.mockImplementation(() => new Promise<void>((resolve) => (open = resolve)));
    vi.stubEnv("CLIPS_LAB", undefined);
    const pending = request();
    expect(connection).toHaveBeenCalledOnce();
    // The server gets the variable before the request reaches the check.
    vi.stubEnv("CLIPS_LAB", "1");
    open();
    const page = (await pending) as ReactElement;
    expect(page.type).toBe(ClipsLabPage);

    // And the other way: the variable goes away before the check.
    connection.mockImplementation(() => new Promise<void>((resolve) => (open = resolve)));
    const second = request();
    vi.stubEnv("CLIPS_LAB", undefined);
    open();
    await expect(second).rejects.toMatchObject({ digest: NOT_FOUND });
  });

  it("asks search engines not to index the lab", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
