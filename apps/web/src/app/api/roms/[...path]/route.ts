import { NextRequest, NextResponse } from "next/server";

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

  // SECURITY: bound the upstream fetch — no redirect-following (so the hardcoded
  // host can't 3xx us elsewhere → SSRF) and a timeout so a slow/hung CDN can't
  // tie up the single instance.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(bucketUrl, {
      redirect: "manual",
      signal: controller.signal,
    });

    if (!response.ok) {
      return new NextResponse("ROM not found", { status: 404 });
    }

    // Defensive size cap (ROMs are small; reject absurd payloads)
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > 64 * 1024 * 1024) {
      return new NextResponse("ROM too large", { status: 413 });
    }

    // Stream the response body
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        // Cache for 1 year - ROMs don't change
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Failed to fetch ROM:", error);
    return new NextResponse("Failed to fetch ROM", { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
