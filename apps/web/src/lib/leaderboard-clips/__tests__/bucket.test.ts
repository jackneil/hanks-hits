// @vitest-environment node
/**
 * The clips bucket client: the URL of each request in both URL styles, the
 * signed GET link (10 minutes), the paged listing, the retries, and errors
 * that never carry a key, a URL or a response body.
 * (leaderboard-clips.integration.test.ts runs the same client on MinIO.)
 */
import { describe, expect, it } from "vitest";

import {
  BucketError,
  clipIdOfKey,
  createClipBucket,
  legalHoldKey,
  parseListPage,
  posterKey,
  videoKey,
  type BucketDeps,
} from "../bucket";
import type { BucketSettings } from "../config";

const VIRTUAL: BucketSettings = {
  endpoint: "https://t3.storageapi.dev",
  bucket: "hanks-hits-clips-abc123",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "auto",
  urlStyle: "virtual",
};
const PATH: BucketSettings = { ...VIRTUAL, urlStyle: "path" };
const ID = "AbCdEfGhIjKlMnOpQrStUv_-";

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: Uint8Array | null;
  /** What fetch() got: a URL string and a body of bytes (never a Request or a stream). */
  inputKind: string;
  bodyKind: string;
}

function fakeFetch(responses: Array<Response | Error | ((call: Call) => Response)>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const inputKind = input instanceof Request ? "Request" : input instanceof URL ? "URL" : typeof input;
    const raw = init?.body ?? null;
    const bodyKind = raw === null ? "none" : raw instanceof Uint8Array ? "bytes" : Object.prototype.toString.call(raw);
    const request = new Request(input, init);
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : null;
    const call = { method: request.method, url: request.url, headers: request.headers, body, inputKind, bodyKind };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(call) : next;
  }) as typeof fetch;
  return { calls, impl };
}

function bucketWith(settings: BucketSettings, responses: Parameters<typeof fakeFetch>[0], extra: BucketDeps = {}) {
  const fake = fakeFetch(responses);
  return { bucket: createClipBucket(settings, { fetch: fake.impl, retries: 2, ...extra }), calls: fake.calls };
}

describe("keys", () => {
  it("names the objects of a clip and of the legal hold", () => {
    expect(videoKey(ID)).toBe(`lb/${ID}.mp4`);
    expect(posterKey(ID)).toBe(`lb/${ID}.jpg`);
    expect(legalHoldKey(ID, "json")).toBe(`legal-hold/${ID}.json`);
  });

  it("finds the clip id in an lb/ key, and nothing in a foreign key", () => {
    expect(clipIdOfKey(videoKey(ID))).toBe(ID);
    expect(clipIdOfKey(posterKey(ID))).toBe(ID);
    expect(clipIdOfKey(legalHoldKey(ID, "mp4"))).toBeNull();
    expect(clipIdOfKey("lb/short.mp4")).toBeNull();
    expect(clipIdOfKey(`lb/${ID}.webm`)).toBeNull();
  });
});

describe("put and delete", () => {
  it("puts to the virtual-hosted URL with a signed payload hash", async () => {
    const { bucket, calls } = bucketWith(VIRTUAL, [new Response(null, { status: 200 })]);
    await bucket.put(videoKey(ID), new Uint8Array([1, 2, 3]), "video/mp4");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe(`https://hanks-hits-clips-abc123.t3.storageapi.dev/lb/${ID}.mp4`);
    expect(calls[0].headers.get("content-type")).toBe("video/mp4");
    // sha256 of 01 02 03
    expect(calls[0].headers.get("x-amz-content-sha256")).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"
    );
    expect(calls[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
    expect(Array.from(calls[0].body!)).toEqual([1, 2, 3]);
  });

  it("hands fetch() a URL and the bytes, never a Request (Next.js copies a Request body into a stream with no length)", async () => {
    const { bucket, calls } = bucketWith(PATH, [new Response(null, { status: 200 }), new Response(null, { status: 204 })]);
    await bucket.put(videoKey(ID), new Uint8Array([1, 2, 3]), "video/mp4");
    await bucket.delete(videoKey(ID));
    expect(calls.map((call) => [call.inputKind, call.bodyKind])).toEqual([
      ["string", "bytes"],
      ["string", "none"],
    ]);
  });

  it("puts to the path-style URL", async () => {
    const { bucket, calls } = bucketWith(PATH, [new Response(null, { status: 200 })]);
    await bucket.put(posterKey(ID), new Uint8Array([9]), "image/jpeg");
    expect(calls[0].url).toBe(`https://t3.storageapi.dev/hanks-hits-clips-abc123/lb/${ID}.jpg`);
  });

  it("retries a 5xx and a network error, then succeeds", async () => {
    const { bucket, calls } = bucketWith(VIRTUAL, [
      new Response("busy", { status: 503 }),
      new TypeError("fetch failed"),
      new Response(null, { status: 200 }),
    ]);
    await bucket.put(videoKey(ID), new Uint8Array([1]), "video/mp4");
    expect(calls).toHaveLength(3);
  });

  it("does not retry a 4xx, and the error names only the operation and the status", async () => {
    const { bucket, calls } = bucketWith(VIRTUAL, [new Response("<Error><Key>secret-key</Key></Error>", { status: 403 })]);
    const error = await bucket.put(videoKey(ID), new Uint8Array([1]), "video/mp4").catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(BucketError);
    expect((error as BucketError).message).toBe("bucket put failed (status 403)");
    expect((error as BucketError).message).not.toContain(ID);
    // The code is what describeError() logs (a production build minifies the class name).
    expect((error as BucketError).code).toBe("bucket_put_403");
  });

  it("gives up after the retries", async () => {
    const { bucket, calls } = bucketWith(VIRTUAL, [
      new Response(null, { status: 500 }),
      new Response(null, { status: 502 }),
      new Response(null, { status: 503 }),
    ]);
    await expect(bucket.delete(videoKey(ID))).rejects.toThrow("bucket delete failed (status 503)");
    expect(calls).toHaveLength(3);
  });

  it("treats a delete of a missing key as done (204 or 404)", async () => {
    const { bucket } = bucketWith(VIRTUAL, [new Response(null, { status: 204 }), new Response(null, { status: 404 })]);
    await bucket.delete(videoKey(ID));
    await bucket.delete(videoKey(ID));
  });

  it("names a time-out as a timeout", async () => {
    const slow = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const bucket = createClipBucket(VIRTUAL, { fetch: slow, retries: 0, timeoutMs: 20 });
    const error = await bucket.delete(videoKey(ID)).catch((e: unknown) => e);
    expect((error as BucketError).message).toBe("bucket delete failed (timeout)");
    expect((error as BucketError).code).toBe("bucket_delete_timeout");
  });
});

describe("copy (the legal hold)", () => {
  it("copies with x-amz-copy-source and checks the result body", async () => {
    const { bucket, calls } = bucketWith(VIRTUAL, [
      new Response("<CopyObjectResult><ETag>x</ETag></CopyObjectResult>", { status: 200 }),
    ]);
    await bucket.copy(videoKey(ID), legalHoldKey(ID, "mp4"));
    expect(calls[0].url).toBe(`https://hanks-hits-clips-abc123.t3.storageapi.dev/legal-hold/${ID}.mp4`);
    expect(calls[0].headers.get("x-amz-copy-source")).toBe(`/hanks-hits-clips-abc123/lb/${ID}.mp4`);
  });

  it("fails a copy whose 200 body is an error", async () => {
    const { bucket } = bucketWith(VIRTUAL, [new Response("<Error><Code>InternalError</Code></Error>", { status: 200 })]);
    await expect(bucket.copy(videoKey(ID), legalHoldKey(ID, "mp4"))).rejects.toThrow(BucketError);
  });
});

describe("signedGetUrl", () => {
  it("signs a GET link in the query string that works for 10 minutes", async () => {
    const { bucket, calls } = bucketWith(VIRTUAL, [], { datetime: () => "20261002T120000Z" });
    const link = new URL(await bucket.signedGetUrl(videoKey(ID), 600));
    expect(calls).toHaveLength(0);
    expect(link.origin).toBe("https://hanks-hits-clips-abc123.t3.storageapi.dev");
    expect(link.pathname).toBe(`/lb/${ID}.mp4`);
    expect(link.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(link.searchParams.get("X-Amz-Date")).toBe("20261002T120000Z");
    expect(link.searchParams.get("X-Amz-Credential")).toBe("AKIDEXAMPLE/20261002/auto/s3/aws4_request");
    expect(link.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(link.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // The secret never appears in the link.
    expect(link.toString()).not.toContain(VIRTUAL.secretAccessKey);
  });

  it("signs a path-style link", async () => {
    const { bucket } = bucketWith(PATH, []);
    const link = new URL(await bucket.signedGetUrl(posterKey(ID), 600));
    expect(link.origin).toBe("https://t3.storageapi.dev");
    expect(link.pathname).toBe(`/hanks-hits-clips-abc123/lb/${ID}.jpg`);
  });
});

function listPage(keys: string[], next: string | null): string {
  const contents = keys
    .map((key) => `<Contents><Key>${key}</Key><LastModified>2026-01-02T03:04:05.000Z</LastModified></Contents>`)
    .join("");
  return `<?xml version="1.0"?><ListBucketResult><IsTruncated>${next ? "true" : "false"}</IsTruncated>${contents}${
    next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""
  }</ListBucketResult>`;
}

describe("list", () => {
  it("pages through every result with the continuation token", async () => {
    const { bucket, calls } = bucketWith(PATH, [
      new Response(listPage(["lb/a.mp4", "lb/a.jpg"], "token&1"), { status: 200 }),
      new Response(listPage(["lb/b.mp4"], "token2"), { status: 200 }),
      new Response(listPage(["lb/c.mp4"], null), { status: 200 }),
    ]);
    const keys: string[] = [];
    for await (const object of bucket.list("lb/")) keys.push(object.key);
    expect(keys).toEqual(["lb/a.mp4", "lb/a.jpg", "lb/b.mp4", "lb/c.mp4"]);
    expect(calls).toHaveLength(3);
    const first = new URL(calls[0].url);
    expect(first.pathname).toBe("/hanks-hits-clips-abc123");
    expect(first.searchParams.get("list-type")).toBe("2");
    expect(first.searchParams.get("prefix")).toBe("lb/");
    expect(first.searchParams.get("continuation-token")).toBeNull();
    // The token is decoded from the XML and sent back as it was.
    expect(new URL(calls[1].url).searchParams.get("continuation-token")).toBe("token&1");
    expect(new URL(calls[2].url).searchParams.get("continuation-token")).toBe("token2");
  });

  it("stops with an error when the bucket sends the same token again (no endless loop)", async () => {
    const { bucket, calls } = bucketWith(PATH, [
      new Response(listPage(["lb/a.mp4"], "same"), { status: 200 }),
      new Response(listPage(["lb/b.mp4"], "same"), { status: 200 }),
    ]);
    const keys: string[] = [];
    const error = await (async () => {
      for await (const object of bucket.list("lb/")) keys.push(object.key);
    })().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BucketError);
    expect((error as BucketError).op).toBe("list");
    expect(keys).toEqual(["lb/a.mp4", "lb/b.mp4"]);
    expect(calls).toHaveLength(2);
  });

  it("lists a virtual-hosted bucket at its own host", async () => {
    const { bucket, calls } = bucketWith(VIRTUAL, [new Response(listPage([], null), { status: 200 })]);
    for await (const object of bucket.list("lb/")) void object;
    expect(new URL(calls[0].url).host).toBe("hanks-hits-clips-abc123.t3.storageapi.dev");
  });

  it("parses the time of each object, and refuses a page that is not a listing", () => {
    const page = parseListPage(listPage(["lb/x.mp4"], null));
    expect(page.objects[0]).toEqual({ key: "lb/x.mp4", lastModified: new Date("2026-01-02T03:04:05.000Z") });
    expect(() => parseListPage("<Error/>")).toThrow(BucketError);
    expect(() => parseListPage("<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>")).toThrow(BucketError);
  });
});
