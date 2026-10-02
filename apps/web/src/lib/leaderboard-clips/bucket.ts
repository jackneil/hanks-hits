/**
 * The clips bucket: put, delete, copy and list objects, and make signed GET
 * links (design/LEADERBOARD_CLIPS.html, sections 4, 7 and 10).
 *
 * The bucket is private. Only the server holds its keys. A viewer gets a
 * GET link that is signed with AWS Signature V4 in the query string and
 * works for 10 minutes. aws4fetch (pinned, no dependencies) does the
 * signing; this module sends the requests with its own fetch, a time limit
 * and a short retry, so a slow bucket can never hold a request for minutes.
 *
 * Object keys:
 * - lb/<id>.mp4 and lb/<id>.jpg: a clip on the leaderboard.
 * - legal-hold/<id>.mp4, .jpg and .json: a clip that an admin kept for a
 *   legal report (section 7). The sweeper never lists or deletes this prefix.
 *
 * Errors are BucketError: the operation and the HTTP status, never a key,
 * a URL or a response body.
 */
import { AwsClient } from "aws4fetch";

import type { BucketSettings } from "./config";

export const CLIP_PREFIX = "lb/";
export const LEGAL_HOLD_PREFIX = "legal-hold/";

export const videoKey = (id: string) => `${CLIP_PREFIX}${id}.mp4`;
export const posterKey = (id: string) => `${CLIP_PREFIX}${id}.jpg`;
export const legalHoldKey = (id: string, ext: "mp4" | "jpg" | "json") => `${LEGAL_HOLD_PREFIX}${id}.${ext}`;

/** The clip id in an lb/ object key, or null for a key that this feature did not write. */
export function clipIdOfKey(key: string): string | null {
  const match = /^lb\/([A-Za-z0-9_-]{24})\.(mp4|jpg)$/.exec(key);
  return match ? match[1] : null;
}

export type BucketOp = "put" | "delete" | "copy" | "list" | "sign";

/**
 * A bucket request failed. Values-free: the operation and the status only.
 *
 * `code` (for example "bucket_put_411" or "bucket_list_timeout") is what a
 * log shows: describeError() copies a string `code`, and a production build
 * minifies the class name, so the name alone says nothing.
 */
export class BucketError extends Error {
  readonly op: BucketOp;
  readonly status: number | null;
  readonly code: string;
  constructor(op: BucketOp, status: number | null, kind = "request") {
    super(`bucket ${op} failed (${status === null ? kind : `status ${status}`})`);
    this.name = "BucketError";
    this.op = op;
    this.status = status;
    this.code = `bucket_${op}_${status === null ? kind.replace(/\W+/g, "_") : status}`;
  }
}

export interface ListedObject {
  key: string;
  lastModified: Date | null;
}

export interface ClipBucket {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  copy(fromKey: string, toKey: string): Promise<void>;
  /** A GET link signed in the query string, valid for `expiresSec` seconds. */
  signedGetUrl(key: string, expiresSec: number): Promise<string>;
  /** Every object under the prefix. Pages through the listing (1000 keys a page). */
  list(prefix: string): AsyncGenerator<ListedObject>;
}

export interface BucketDeps {
  fetch?: typeof fetch;
  /** Time limit for one request, in milliseconds. */
  timeoutMs?: number;
  /** Extra tries after a 5xx, a 429 or a network error. */
  retries?: number;
  /** For tests: the signing time (aws4fetch "datetime", yyyymmddThhmmssZ). */
  datetime?: () => string | undefined;
  /** Keys in one listing page (1 to 1000; S3 sends at most 1000). Tests use a small page to prove the paging. */
  listPageSize?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Read and drop a body, so the connection goes back to the pool. */
async function drain(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => undefined);
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function tagValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

/** Parse one ListObjectsV2 result page. Exported for tests. */
export function parseListPage(xml: string): { objects: ListedObject[]; nextToken: string | null } {
  if (!xml.includes("<ListBucketResult")) throw new BucketError("list", null, "not a listing");
  const objects: ListedObject[] = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = tagValue(match[1], "Key");
    if (key === null) continue;
    const modified = tagValue(match[1], "LastModified");
    const date = modified ? new Date(modified) : null;
    objects.push({ key, lastModified: date && !Number.isNaN(date.getTime()) ? date : null });
  }
  const truncated = tagValue(xml, "IsTruncated") === "true";
  const nextToken = truncated ? tagValue(xml, "NextContinuationToken") : null;
  if (truncated && !nextToken) throw new BucketError("list", null, "truncated listing with no token");
  return { objects, nextToken };
}

/** The S3 client for the clips bucket. */
export function createClipBucket(settings: BucketSettings, deps: BucketDeps = {}): ClipBucket {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = deps.retries ?? DEFAULT_RETRIES;
  const pageSize = Math.min(1000, Math.max(1, Math.floor(deps.listPageSize ?? 1000)));
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: "s3",
    region: settings.region,
    retries: 0,
  });

  const base = new URL(settings.endpoint);
  /** The URL of the bucket itself (for a listing). */
  function bucketUrl(): URL {
    if (settings.urlStyle === "path") return new URL(`${base.origin}/${settings.bucket}`);
    const url = new URL(base.origin);
    url.hostname = `${settings.bucket}.${url.hostname}`;
    return url;
  }
  /** The URL of one object. Keys are made by this module, so they need no escaping beyond the path rules. */
  function objectUrl(key: string): URL {
    const path = key.split("/").map(encodeURIComponent).join("/");
    if (settings.urlStyle === "path") return new URL(`${base.origin}/${settings.bucket}/${path}`);
    const url = new URL(`${base.origin}/${path}`);
    url.hostname = `${settings.bucket}.${url.hostname}`;
    return url;
  }

  /**
   * Sign and send one request. The request goes to fetch() as a URL and an
   * init whose body is the bytes themselves, never as a Request object. In
   * the Next.js server, fetch() is patched: a Request input is copied into a
   * new Request with its body as a stream, so the length is lost, the body
   * goes out chunked, and S3 refuses a PUT with no Content-Length (411).
   * Bytes in the init keep the Content-Length.
   */
  async function send(
    op: BucketOp,
    url: URL,
    init: { method: string; body?: Uint8Array; headers?: Record<string, string> },
    okStatuses: number[]
  ): Promise<Response> {
    let lastStatus: number | null = null;
    let lastKind = "request";
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(100 * 2 ** (attempt - 1));
      const signed = await client.sign(url.toString(), {
        method: init.method,
        headers: init.headers,
        body: init.body as BodyInit | undefined,
        aws: { datetime: deps.datetime?.() },
      });
      let response: Response;
      try {
        response = await doFetch(signed.url, {
          method: signed.method,
          headers: signed.headers,
          body: init.body as BodyInit | undefined,
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch (error) {
        lastStatus = null;
        lastKind = (error as { name?: string } | null)?.name === "TimeoutError" ? "timeout" : "network";
        continue;
      }
      if (okStatuses.includes(response.status)) return response;
      lastStatus = response.status;
      await drain(response);
      if (response.status < 500 && response.status !== 429) break;
    }
    throw new BucketError(op, lastStatus, lastKind);
  }

  return {
    async put(key, body, contentType) {
      const hash = await sha256Hex(body);
      const response = await send(
        "put",
        objectUrl(key),
        {
          method: "PUT",
          body,
          headers: {
            "Content-Type": contentType,
            // A signed payload hash: the bucket checks the bytes it gets.
            "X-Amz-Content-Sha256": hash,
          },
        },
        [200]
      );
      await drain(response);
    },

    async delete(key) {
      // S3 answers 204 for a key that does not exist (some S3 servers answer
      // 404), so a delete is safe to repeat.
      await drain(await send("delete", objectUrl(key), { method: "DELETE" }, [200, 204, 404]));
    },

    async copy(fromKey, toKey) {
      const source = `/${settings.bucket}/${fromKey.split("/").map(encodeURIComponent).join("/")}`;
      const response = await send(
        "copy",
        objectUrl(toKey),
        { method: "PUT", headers: { "x-amz-copy-source": source } },
        [200]
      );
      // A copy can fail after the 200 status line: the body then holds an Error.
      const text = await response.text();
      if (!text.includes("<CopyObjectResult")) throw new BucketError("copy", 200, "error body");
    },

    async signedGetUrl(key, expiresSec) {
      const url = objectUrl(key);
      url.searchParams.set("X-Amz-Expires", String(expiresSec));
      try {
        const signed = await client.sign(url.toString(), {
          method: "GET",
          aws: { signQuery: true, datetime: deps.datetime?.() },
        });
        return signed.url;
      } catch {
        throw new BucketError("sign", null, "signing");
      }
    },

    async *list(prefix) {
      let token: string | null = null;
      // The loop ends when the bucket says the listing is complete.
      for (;;) {
        const url = bucketUrl();
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        url.searchParams.set("max-keys", String(pageSize));
        if (token) url.searchParams.set("continuation-token", token);
        const response = await send("list", url, { method: "GET" }, [200]);
        const page = parseListPage(await response.text());
        for (const object of page.objects) yield object;
        if (!page.nextToken) return;
        // A server that sends the same token again would loop for ever.
        if (page.nextToken === token) throw new BucketError("list", null, "repeated continuation token");
        token = page.nextToken;
      }
    },
  };
}
