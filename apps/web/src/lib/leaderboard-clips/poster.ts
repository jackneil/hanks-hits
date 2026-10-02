/**
 * The poster check of a leaderboard clip upload (design/LEADERBOARD_CLIPS.html,
 * section 6): a JPEG of at most 64 KB. The server removes every APP1 to
 * APP15 and COM segment (EXIF, XMP, ICC, comments) and keeps only a complete
 * JPEG from SOI to EOI. The cleaned bytes are what the bucket stores.
 */
import { jpegFrameSize, stripJpegMetadata } from "@/shared/lib/jpeg";

import { LEADERBOARD_CLIP_LIMITS } from "./contract";

/** Why a poster was rejected. Values-free, safe to log and to send back. */
export type PosterRejectReason = "empty" | "too_big" | "not_jpeg" | "size";

export type PosterCheck = { ok: true; jpeg: Uint8Array } | { ok: false; reason: PosterRejectReason };

/** Check and clean an uploaded poster. Never throws. */
export function cleanPoster(bytes: Uint8Array): PosterCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > LEADERBOARD_CLIP_LIMITS.maxPosterBytes) return { ok: false, reason: "too_big" };
  const clean = stripJpegMetadata(bytes);
  if (!clean) return { ok: false, reason: "not_jpeg" };
  const size = jpegFrameSize(clean);
  if (!size) return { ok: false, reason: "not_jpeg" };
  const maxSide = LEADERBOARD_CLIP_LIMITS.maxPosterSide;
  if (size.width > maxSide || size.height > maxSide) return { ok: false, reason: "size" };
  return { ok: true, jpeg: clean };
}
