// @vitest-environment node
/**
 * src/lib/read-body.ts: a request body read with a byte limit that is
 * counted while the bytes arrive, and a time limit that each caller writes
 * down (a number, or null for none).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bodyFailureStatus,
  JsonValueCounter,
  PROGRESS_SAVE_BODY,
  readBody,
  readJson,
  refuseBody,
  SMALL_JSON_BODY,
  SMALL_SAVE_BODY,
  type BodyLimits,
  type JsonLimits,
} from "@/lib/read-body";

afterEach(() => {
  vi.useRealTimers();
});

/** A request with a body that arrives in the given chunks. */
function chunked(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  return new Request("http://localhost/fixture", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

/** A body that never ends: it counts the chunks that the reader pulls, and if it was cancelled. */
function endless(chunkBytes: number, headers: Record<string, string> = {}) {
  const seen = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulled += chunkBytes;
        controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 }
  );
  const request = new Request("http://localhost/fixture", { method: "POST", headers, body, duplex: "half" } as RequestInit);
  return { request, seen };
}

const bytes = (length: number, fill = 0x61) => new Uint8Array(length).fill(fill);
const LIMIT: BodyLimits = { maxBytes: 1000, timeoutMs: null };
const JSON_LIMIT: JsonLimits = { ...LIMIT, maxJsonValues: null };

describe("readBody: the byte limit", () => {
  it("reads a body of exactly maxBytes", async () => {
    const result = await readBody(chunked([bytes(400), bytes(600)]), LIMIT);
    expect(result.ok && result.bytes.byteLength).toBe(1000);
  });

  it("refuses a body of maxBytes + 1 that has no Content-Length (counted while it arrives)", async () => {
    expect(await readBody(chunked([bytes(400), bytes(601)]), LIMIT)).toEqual({ ok: false, why: "too_big", receivedBytes: 1001 });
  });

  it("joins the chunks of a chunked body in order", async () => {
    const parts = [Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4, 5, 6)];
    const result = await readBody(chunked(parts), LIMIT);
    expect(result.ok && [...result.bytes]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses a declared Content-Length over maxBytes at once: no byte of the body is read", async () => {
    const { request, seen } = endless(64, { "content-length": "1001" });
    expect(await readBody(request, LIMIT)).toEqual({ ok: false, why: "too_big", receivedBytes: 0 });
    expect(seen.pulled).toBe(0);
  });

  it("refuses a Content-Length that is too large to be a safe number", async () => {
    const { request } = endless(64, { "content-length": "99999999999999999999999" });
    expect(await readBody(request, LIMIT)).toEqual({ ok: false, why: "too_big", receivedBytes: 0 });
  });

  it("does not trust a Content-Length that says less than the body (a lying header): it counts", async () => {
    const { request, seen } = endless(300, { "content-length": "10" });
    expect(await readBody(request, LIMIT)).toEqual({ ok: false, why: "too_big", receivedBytes: 1200 });
    expect(seen.pulled).toBe(1200); // stopped at the first chunk over the limit
    expect(seen.cancelled).toBe(true);
  });

  it("does not trust a Content-Length that is not a number: it counts", async () => {
    const result = await readBody(chunked([bytes(10)], { "content-length": "ten" }), LIMIT);
    expect(result.ok && result.bytes.byteLength).toBe(10);
  });

  it("stops at the first chunk over the limit and cancels the stream (it holds at most the limit and one chunk)", async () => {
    const { request, seen } = endless(16 * 1024);
    expect(await readBody(request, { maxBytes: 64 * 1024, timeoutMs: null })).toEqual({
      ok: false,
      why: "too_big",
      receivedBytes: 64 * 1024 + 16 * 1024,
    });
    expect(seen.pulled).toBe(64 * 1024 + 16 * 1024);
    expect(seen.cancelled).toBe(true);
  });

  it("reads a request with no body as zero bytes", async () => {
    const result = await readBody(new Request("http://localhost/fixture"), LIMIT);
    expect(result.ok && result.bytes.byteLength).toBe(0);
  });

  it("answers broken for a body that was already read, and for a stream that fails (the client went away)", async () => {
    const used = new Request("http://localhost/fixture", { method: "POST", body: "{}" });
    await used.text();
    expect(await readBody(used, LIMIT)).toEqual({ ok: false, why: "broken", receivedBytes: 0 });

    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket hang up"));
      },
    });
    const request = new Request("http://localhost/fixture", { method: "POST", body: failing, duplex: "half" } as RequestInit);
    expect(await readBody(request, LIMIT)).toEqual({ ok: false, why: "broken", receivedBytes: 0 });
  });
});

describe("readBody: the time limit", () => {
  /** A body that sends one byte, pauses for pauseMs, then sends one byte and ends. */
  function pausing(pauseMs: number) {
    const seen = { cancelled: false };
    let step = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          step++;
          if (step === 1) controller.enqueue(Uint8Array.of(0x7b));
          else if (step === 2) {
            await new Promise((resolve) => setTimeout(resolve, pauseMs));
            controller.enqueue(Uint8Array.of(0x7d));
          } else controller.close();
        },
        cancel() {
          seen.cancelled = true;
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request("http://localhost/fixture", { method: "POST", body, duplex: "half" } as RequestInit);
    return { request, seen };
  }

  it("with timeoutMs null, waits through a 35 s pause and reads the whole body", async () => {
    vi.useFakeTimers();
    const { request } = pausing(35_000);
    const pending = readBody(request, { maxBytes: 1000, timeoutMs: null });
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await pending;
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe("{}");
  });

  it("with timeoutMs 30 s, ends a body that pauses for 35 s with timeout, and cancels the stream", async () => {
    vi.useFakeTimers();
    const { request, seen } = pausing(35_000);
    const pending = readBody(request, SMALL_JSON_BODY);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toEqual({ ok: false, why: "timeout", receivedBytes: 1 });
    expect(seen.cancelled).toBe(true);
  });

  it("with timeoutMs 30 s, reads a body that pauses for 20 s", async () => {
    vi.useFakeTimers();
    const { request } = pausing(20_000);
    const pending = readBody(request, SMALL_JSON_BODY);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result.ok && result.bytes.byteLength).toBe(2);
  });

  it("no save has a time limit of its own (Node's requestTimeout still ends a request); only the routes with no sign-in have 30 s", () => {
    expect(PROGRESS_SAVE_BODY).toEqual({ maxBytes: 100 * 1024 * 1024, timeoutMs: null, maxJsonValues: 12_000_000, maxJsonAllocations: 1_000_000 });
    expect(SMALL_SAVE_BODY).toEqual({ maxBytes: 64 * 1024, timeoutMs: null, maxJsonValues: null });
    expect(SMALL_JSON_BODY).toEqual({ maxBytes: 64 * 1024, timeoutMs: 30_000, maxJsonValues: null });
  });

  it("SMALL_SAVE_BODY waits through a 35 s pause (a signed-in player's name or leaderboard switch)", async () => {
    vi.useFakeTimers();
    const { request } = pausing(35_000);
    const pending = readJson(request, SMALL_SAVE_BODY);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await pending).toEqual({ ok: true, value: {} });
  });
});

describe("readBody: limits that a caller wrote wrong throw (no default turns a limit on or off)", () => {
  it.each([
    ["no limits", undefined],
    ["timeoutMs left out", { maxBytes: 10 }],
    ["timeoutMs undefined", { maxBytes: 10, timeoutMs: undefined }],
    ["timeoutMs 0", { maxBytes: 10, timeoutMs: 0 }],
    ["timeoutMs Infinity", { maxBytes: 10, timeoutMs: Number.POSITIVE_INFINITY }],
    ["timeoutMs NaN", { maxBytes: 10, timeoutMs: Number.NaN }],
    ["timeoutMs as text", { maxBytes: 10, timeoutMs: "30000" }],
    ["maxBytes 0", { maxBytes: 0, timeoutMs: null }],
    ["maxBytes negative", { maxBytes: -1, timeoutMs: null }],
    ["maxBytes a fraction", { maxBytes: 1.5, timeoutMs: null }],
  ])("%s", async (_name, limits) => {
    await expect(readBody(chunked([bytes(1)]), limits as unknown as BodyLimits)).rejects.toThrow(TypeError);
  });
});

describe("readJson", () => {
  const json = (text: string) => chunked([new TextEncoder().encode(text)]);

  it("parses a JSON body, with the same decoding as request.json() (UTF-8, a byte order mark is dropped)", async () => {
    expect(await readJson(json('{"name":"Hank 🏎️"}'), JSON_LIMIT)).toEqual({ ok: true, value: { name: "Hank 🏎️" } });
    expect(await readJson(json('﻿{"a":1}'), JSON_LIMIT)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("answers bad_json for an empty body and for text that is not JSON, and never keeps the text", async () => {
    expect(await readJson(json(""), JSON_LIMIT)).toEqual({ ok: false, why: "bad_json", receivedBytes: 0 });
    const result = await readJson(json('{"password":hunter22secret}'), JSON_LIMIT);
    expect(result).toEqual({ ok: false, why: "bad_json", receivedBytes: 27 });
    expect(JSON.stringify(result)).not.toContain("hunter22");
  });

  it("passes on the read failures (too big)", async () => {
    expect(await readJson(json(`"${"x".repeat(2000)}"`), JSON_LIMIT)).toEqual({ ok: false, why: "too_big", receivedBytes: 2002 });
  });

  it.each([
    ["maxJsonValues left out", { maxBytes: 10, timeoutMs: null }],
    ["maxJsonValues undefined", { maxBytes: 10, timeoutMs: null, maxJsonValues: undefined }],
    ["maxJsonValues 0", { maxBytes: 10, timeoutMs: null, maxJsonValues: 0 }],
    ["maxJsonValues a fraction", { maxBytes: 10, timeoutMs: null, maxJsonValues: 1.5 }],
  ])("throws for %s (no default turns the count on or off)", async (_name, limits) => {
    await expect(readJson(json("{}"), limits as unknown as JsonLimits)).rejects.toThrow(TypeError);
  });
});

describe("readJson: the JSON value count (maxJsonValues)", () => {
  const json = (text: string) => chunked([new TextEncoder().encode(text)]);
  /** A JSON array of n empty objects: 2n marks ([ and n - 1 commas and n braces). */
  const objects = (n: number) => `[${Array.from({ length: n }, () => "{}").join(",")}]`;
  const marksOf = (text: string) => {
    const counter = new JsonValueCounter();
    counter.add(new TextEncoder().encode(text));
    return counter.count;
  };

  it("counts { [ , : outside strings, and nothing in a string (also an escaped quote)", () => {
    expect(marksOf(objects(3))).toBe(6);
    expect(marksOf('{"a":1,"b":[2,3]}')).toBe(6);
    expect(marksOf('"{[,:]}"')).toBe(0);
    expect(marksOf('["a\\"b,c", "d\\\\", 1]')).toBe(3);
    expect(marksOf('{"🏎️,{":"€:["}')).toBe(2);
  });

  it("gives the same count for every split of the body into two chunks (a string or an escape across a chunk end)", () => {
    const text = '{"k":"a\\"b,{c\\\\","d":[1,{"e":"🏎️:"}],"f":"x"}';
    const encoded = new TextEncoder().encode(text);
    const whole = marksOf(text);
    for (let at = 0; at <= encoded.length; at++) {
      const counter = new JsonValueCounter();
      counter.add(encoded.slice(0, at));
      counter.add(encoded.slice(at));
      expect(counter.count, `split at ${at}`).toBe(whole);
    }
    // One byte a chunk.
    const counter = new JsonValueCounter();
    for (const byte of encoded) counter.add(Uint8Array.of(byte));
    expect(counter.count).toBe(whole);
  });

  it("reads a body of exactly maxJsonValues marks, and refuses one mark more (413, before the parse)", async () => {
    const limits: JsonLimits = { maxBytes: 1_000_000, timeoutMs: null, maxJsonValues: 200 };
    const exact = await readJson(json(objects(100)), limits);
    expect(exact.ok && (exact.value as unknown[]).length).toBe(100);
    const over = await readJson(json(`${objects(100).slice(0, -1)},0]`), limits);
    expect(over).toEqual({ ok: false, why: "too_many_values", receivedBytes: 303 });
    expect(bodyFailureStatus("too_many_values")).toBe(413);
  });

  it("stops a body of many small values early: it reads only the chunks up to the count, and cancels the stream", async () => {
    // 1 MiB chunks of ",0,0,0": about 524,288 marks each, and no end.
    const seen = { pulled: 0, cancelled: false };
    const chunk = new TextEncoder().encode(",0".repeat(512 * 1024));
    let first = true;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          seen.pulled += first ? 1 : chunk.byteLength;
          controller.enqueue(first ? new TextEncoder().encode("[") : chunk);
          first = false;
        },
        cancel() {
          seen.cancelled = true;
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request("http://localhost/fixture", { method: "POST", body, duplex: "half" } as RequestInit);
    const result = await readJson(request, PROGRESS_SAVE_BODY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.why).toBe("too_many_values");
    // The 12,000,000-mark budget is reached in the 23rd 1 MiB chunk.
    expect(seen.pulled).toBe(1 + 23 * chunk.byteLength);
    expect(seen.cancelled).toBe(true);
  });

  it("does not count when maxJsonValues is null", async () => {
    expect(await readJson(json(objects(5000)), { maxBytes: 1_000_000, timeoutMs: null, maxJsonValues: null })).toEqual(
      expect.objectContaining({ ok: true })
    );
  });
});

describe("the failure answers (refuseBody)", () => {
  it("are 413 for too big or too many values, 408 for late, 400 for the rest, never cached, and never quote the body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(bodyFailureStatus("too_big")).toBe(413);
    expect(bodyFailureStatus("too_many_values")).toBe(413);
    expect(bodyFailureStatus("timeout")).toBe(408);
    expect(bodyFailureStatus("bad_json")).toBe(400);
    expect(bodyFailureStatus("broken")).toBe(400);
    const response = refuseBody("POST /fixture", { ok: false, why: "too_big", receivedBytes: 0 }, new Request("http://localhost/fixture"));
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "The request is too big." });
    vi.restoreAllMocks();
  });

  it("write one log line for each refused body, with the route, the reason and the counts, and no value of the body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new Request("http://localhost/fixture", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "27" },
      body: '{"password":hunter22secret}',
    });
    const read = await readJson(request, JSON_LIMIT);
    expect(read.ok).toBe(false);
    refuseBody("POST /api/fixture", read as Extract<typeof read, { ok: false }>, request);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line).toBe("[read-body] POST /api/fixture: refused a request body (bad_json; declared 27 bytes, received 27 bytes)");
    expect(line).not.toContain("hunter22");

    warn.mockClear();
    refuseBody("POST /api/fixture", { ok: false, why: "broken", receivedBytes: 512 }, new Request("http://localhost/fixture"));
    expect(warn.mock.calls[0].join(" ")).toBe(
      "[read-body] POST /api/fixture: refused a request body (broken; declared no bytes, received 512 bytes)"
    );
    vi.restoreAllMocks();
  });
});


describe("readJson: allocation units", () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const units = (value: unknown): number => {
    if (typeof value === "string") return 1;
    if (Array.isArray(value)) return 1 + value.reduce((n, child) => n + units(child), 0);
    if (value && typeof value === "object") return 1 + Object.entries(value).reduce((n, [, child]) => n + 1 + units(child), 0);
    return 0;
  };

  it("matches a parsed-tree oracle at every byte split, including escaped quotes and UTF-8", () => {
    const value = { 'key\"\\': [true, false, null, 12, "é🛻\\\"{[,:", { child: "value" }], empty: [] };
    const input = encode(JSON.stringify(value));
    for (let i = 0; i <= input.length; i++) {
      const counter = new JsonValueCounter();
      counter.add(input.subarray(0, i));
      counter.add(input.subarray(i));
      expect(counter.allocations).toBe(units(value));
    }
  });

  it.each([
    [{ a: 1, b: 2, c: 3 }],
    [["first", "second", "third"]],
    [[{}, {}, {}]],
  ])("accepts the exact allocation boundary and cancels one unit beyond it (%#)", async (value) => {
    const input = encode(JSON.stringify(value));
    const count = units(value);
    const limits = { maxBytes: 1000, timeoutMs: null, maxJsonValues: null, maxJsonAllocations: count };
    expect(await readJson(chunked([input]), limits)).toEqual({ ok: true, value });
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(input); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const request = new Request("http://localhost/fixture", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const parsed = vi.spyOn(JSON, "parse");
    const result = await readJson(request, { ...limits, maxJsonAllocations: count - 1 });
    expect(result).toMatchObject({ ok: false, why: "too_many_values" });
    expect(parsed).not.toHaveBeenCalled();
    parsed.mockRestore();
    expect(pulls).toBe(1);
    expect(cancelled).toBe(true);
  });

  it("permits many booleans without treating them as separate allocations", async () => {
    const value = Array.from({ length: 500 }, (_, i) => i % 2 === 0);
    expect(await readJson(chunked([encode(JSON.stringify(value))]), {
      maxBytes: 4000, timeoutMs: null, maxJsonValues: 600, maxJsonAllocations: 1,
    })).toEqual({ ok: true, value });
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects an invalid allocation budget %s even without a total-mark limit", async (limit) => {
    await expect(readJson(chunked([]), { ...JSON_LIMIT, maxJsonAllocations: limit })).rejects.toThrow("maxJsonAllocations");
  });
});
