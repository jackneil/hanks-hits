import { NextRequest, NextResponse } from "next/server";

import { safeRedirectTarget } from "@/lib/rom-redirect";

// Railway CDN URL for ROMs
const ROM_CDN_URL = "https://cdn-hankshits.up.railway.app/roms";

/**
 * Proxy ROM requests to Railway S3 bucket.
 * This avoids CORS issues by serving ROMs from same origin.
 * The CDN service doesn't pass CORS headers through, so we proxy instead.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // SECURITY: this is an unauthenticated same-origin proxy. Reject path
  // traversal and anything outside a strict per-segment allowlist so it can't be
  // coerced into reading objects outside the intended /roms/ prefix on the CDN.
  const SEGMENT = /^[A-Za-z0-9_.-]+$/;
  if (
    path.length === 0 ||
    path.some((seg) => seg.includes("..") || !SEGMENT.test(seg))
  ) {
    return new NextResponse("Invalid ROM path", { status: 400 });
  }
  const romPath = path.join("/");
  const bucketUrl = `${ROM_CDN_URL}/${romPath}`;

  // SECURITY: bound the upstream fetch — no blind redirect-following (so the
  // hardcoded host can't 3xx us anywhere → SSRF) and a timeout so a slow/hung
  // CDN can't tie up the single instance. The Railway CDN serves bucket objects
  // via a 302 to a signed storage.railway.app URL, so we follow EXACTLY ONE
  // redirect hop, and only after validating the target host against a pinned
  // allowlist.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let response = await fetch(bucketUrl, {
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const target = location ? safeRedirectTarget(location) : null;
      if (!target) {
        // OBSERVABILITY: this branch fires when the CDN changes its redirect
        // target (host rotation, relative Location, http downgrade). Without a
        // log it is indistinguishable from a missing ROM, and the whole
        // library can die silently for days (exactly how the pre-2026-07-11
        // outage went unnoticed). Log the rejected HOST only - never the full
        // signed URL, which carries credentials.
        let rejectedHost = "unparseable-location";
        try {
          if (location) rejectedHost = new URL(location).host;
        } catch {}
        console.error(
          `ROM proxy: CDN redirect rejected (host: ${rejectedHost}) for /${romPath} - if the CDN moved, update ALLOWED_REDIRECT_HOST in lib/rom-redirect.ts`
        );
        return new NextResponse("ROM not found", { status: 404 });
      }
      response = await fetch(target, {
        redirect: "manual", // one hop only — a second redirect is a failure
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      // OBSERVABILITY: distinguishes upstream failures (expired signed URL ->
      // 403, second redirect -> 3xx, genuinely missing ROM -> 404) in Railway
      // logs so a library-wide outage is a one-line grep, not a mystery.
      console.error(
        `ROM proxy: upstream returned ${response.status} for /${romPath}`
      );
      return new NextResponse("ROM not found", { status: 404 });
    }

    // Defensive size cap (ROMs are small; reject absurd payloads). The header
    // check fast-rejects honest oversized responses, but content-length can be
    // absent - so the stream itself is also metered and aborted at the cap.
    const MAX_ROM_BYTES = 64 * 1024 * 1024;
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > MAX_ROM_BYTES) {
      return new NextResponse("ROM too large", { status: 413 });
    }

    // Stream the response body, enforcing the byte cap for real (an upstream
    // that omits content-length must not be able to stream unbounded data
    // through this single instance).
    let streamed = 0;
    const meter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        streamed += chunk.byteLength;
        if (streamed > MAX_ROM_BYTES) {
          console.error(
            `ROM proxy: aborted /${romPath} - stream exceeded ${MAX_ROM_BYTES} bytes (no/false content-length)`
          );
          ctrl.error(new Error("ROM stream exceeded size cap"));
          return;
        }
        ctrl.enqueue(chunk);
      },
    });

    return new NextResponse(response.body?.pipeThrough(meter) ?? null, {
      headers: {
        "Content-Type": "application/octet-stream",
        // Cache for 1 year - ROMs don't change
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error(`Failed to fetch ROM /${romPath}:`, error);
    return new NextResponse("Failed to fetch ROM", { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
