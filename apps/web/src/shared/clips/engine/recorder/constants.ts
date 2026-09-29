/**
 * Tuning values of the MediaRecorder engine (tiers M and V, plan 5).
 *
 * Each value gives its reason. Plan 16 (PR 0.6) measures the rotation period
 * and the keyframe spacing on a real Firefox Android phone; put the measured
 * values here when they are known.
 */

import { MP4_TYPE, WEBM_TYPE } from "../../runtime/capabilities";
import type { SegmentContainer } from "../../protocol";

/**
 * Rotation period N: a new recorder starts every ROTATION_MS, so a segment
 * (and the ring) always starts with a keyframe at least this often.
 *
 * Reason: Firefox's VP8 MediaRecorder puts a keyframe at most every 10 s, and
 * no web API changes that (Bugzilla 1666487; plan review item 35). A clip
 * starts at the last keyframe at or before its start (plan 6.6), so without
 * rotation a tier V clip could start 10 s early. Half of that, 5 s, keeps
 * the worst case at 5 s, costs one extra keyframe every 5 s (a few percent
 * of the bitrate), and restarts the encoder only 12 times a minute. The
 * replay granularity that the kid sees is the measured keyframe spacing,
 * which is never more than this value.
 */
export const ROTATION_MS = 5000;

/**
 * How long the old recorder keeps recording after the new one started (the
 * hand-off). The new recorder must have frames before the old one stops, or
 * the clip has a gap. Its first frame comes at the next capture draw: up to
 * one frame at the lowest capture rung (15 fps is 67 ms), plus the encoder's
 * start-up. 250 ms covers both with room, and it is the only time that two
 * encoders run together.
 */
export const HANDOFF_OVERLAP_MS = 250;

/** A recorder that has not fired "start" after this long counts as failed. */
export const START_TIMEOUT_MS = 3000;

/** A stopped recorder that has not given its last data after this long counts as failed. */
export const STOP_TIMEOUT_MS = 5000;

/**
 * Keyframe spacing that tier M asks for with videoKeyFrameIntervalDuration
 * (Chromium supports it; other browsers ignore the option). The same
 * spacing as tiers W and W+ (plan 5.1), so a clip starts at most 1 s early
 * where the browser honors it. The engine measures the real spacing anyway.
 */
export const KEYFRAME_INTERVAL_MS = 1000;

/** Recorder capture rate: MediaRecorder encoders are not probed for 60 fps. */
export const RECORDER_FPS = 30;

/** Audio bitrate for AAC (tier M) and Opus (tier V). The same as tiers W and W+ (plan 5.1). */
export const RECORDER_AUDIO_BITRATE = 128_000;

/** Failures of one recorder after output, in a row, before the engine stops and says so. */
export const RECORDER_FAILURE_LIMIT = 4;

/** Wait before a failed hand-off is tried again. */
export const HANDOFF_RETRY_MS = 1000;

/**
 * Hand-offs in a row whose new recorder could not start while the old one
 * recorded. After this many, the rotator stops the old recorder first and
 * then starts the new one (no overlap). Reason: some phones allow only one
 * hardware encoder session (plan 7: Phase 0 probes the concurrent sessions
 * on Android), so a second recorder always fails there. Without rotation the
 * one segment grows with no limit and the ring cannot let old footage go;
 * a hand-off with no overlap leaves only the new recorder's start-up (tens
 * of milliseconds) out of the footage.
 */
export const SEQUENTIAL_AFTER_FAILURES = 2;

/** How often the engine reports the ring length and checks its timers. */
export const RECORDER_TICK_MS = 500;

/** Segments whose keyframe spacing sets the reported replay granularity (the newest ones). */
export const GRANULARITY_WINDOW = 4;

/** The MediaRecorder type of each tier (the capability probe checked these exact strings). */
export const RECORDER_TYPES: Readonly<Record<"M" | "V", string>> = { M: MP4_TYPE, V: WEBM_TYPE };

/** The container of each tier's files (plan 5: tier V files are labeled honestly as WebM). */
export const RECORDER_CONTAINERS: Readonly<Record<"M" | "V", SegmentContainer>> = { M: "mp4", V: "webm" };
