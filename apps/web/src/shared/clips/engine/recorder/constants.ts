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
 * Tier M asks for a keyframe this often with videoKeyFrameIntervalDuration
 * (Chromium supports it; other browsers ignore the option). The same spacing
 * as tiers W and W+ (plan 5.1), so a clip starts at most 1 s early where the
 * browser honors it. The engine measures the real spacing anyway.
 */
export const KEYFRAME_INTERVAL_MS = 1000;

/**
 * Rotation period N: a new recorder starts every ROTATION_MS, so a segment
 * (and the ring) always starts with a keyframe at least this often.
 *
 * Reasons:
 * - Firefox's VP8 MediaRecorder puts a keyframe at most every 10 s, and no web
 *   API changes that (Bugzilla 1666487; plan review item 35). A clip starts at
 *   the last keyframe at or before its start (plan 6.6), so without rotation a
 *   tier V clip could start 10 s early. Less than half of that keeps the worst
 *   case under 5 s, costs one extra keyframe per rotation (a few percent of
 *   the bitrate), and restarts the encoder about 13 times a minute.
 * - It is half a keyframe interval off the 1 s keyframe grid of tier M. An
 *   encoder puts its keyframes at 0, 1, 2 s... after its first frame, so a
 *   period of a whole number of seconds would cut each segment just after a
 *   keyframe: that lone keyframe then goes at the splice (plan 5.1: every
 *   GOP at a splice has at least 2 frames), and the frame before it is shown
 *   twice. At 4.5 s the cut comes in the middle of a GOP.
 * The replay granularity that the kid sees is the measured keyframe spacing,
 * which is never more than this value.
 */
export const ROTATION_MS = 4500;

/**
 * How long the old recorder keeps recording after the new one started (the
 * hand-off). The new recorder must have frames before the old one stops, or
 * the clip has a gap. The engine paints the last picture again as soon as a
 * recorder starts (the new recorder gets a frame in the next display frame),
 * and a hardware encoder can take tens of milliseconds more. 250 ms covers
 * both with room, and it is the only time that two encoders run together.
 */
export const HANDOFF_OVERLAP_MS = 250;

/** A recorder that has not fired "start" after this long counts as failed. */
export const START_TIMEOUT_MS = 3000;

/** A stopped recorder that has not given its last data after this long counts as failed. */
export const STOP_TIMEOUT_MS = 5000;

/**
 * A new recorder that fails this soon after it took over counts as a hand-off
 * that could not run two recorders. Reason: Chromium reports an encoder that
 * cannot open as "start" first and then "error" (media_recorder.cc), so the
 * failure can come just after the overlap. SEQUENTIAL_AFTER_FAILURES of them
 * turn on the one-recorder-at-a-time hand-off.
 */
export const TAKEOVER_GRACE_MS = 1000;

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

/**
 * While a recorder records and the game drew nothing for this long (a game
 * that waits for a tap and queues no frame), the engine paints the last
 * picture again at its next tick. A recorder gets frames only when the
 * canvas is painted: the frames keep the segment's file moving, and each new
 * recorder gets its own first frame from the repaint at its start() call.
 */
export const KEEPALIVE_MS = 500;

/**
 * Display frames between a purge and its hand-off. The purge paints the empty
 * frame, and canvas capture takes it at the next display frame; Gecko starts
 * a recorder with the frame that the track holds at start(). Two frames
 * later, that held frame is the empty one, never a picture from before the
 * purge.
 */
export const PURGE_FRAMES = 2;

/** Segments whose keyframe spacing sets the reported replay granularity (the newest ones). */
export const GRANULARITY_WINDOW = 4;

/**
 * Paint times that the engine keeps to find each segment's first frame
 * (anchor.ts). A segment's index comes a few seconds after its start; 2400
 * paints are 80 s at 30 fps.
 */
export const PAINT_LOG_MAX = 2400;

/**
 * The first frame of a segment is matched to a paint when the segment's
 * packet times fit the paint times this closely (the median error). A
 * quarter of a frame at 30 fps: a looser fit could be one frame off.
 */
export const ANCHOR_MATCH_US = 8000;

/** Two anchor fits this close are equal; the order of preference decides. */
export const ANCHOR_TIE_US = 2000;

/**
 * The sound recorder gives its bytes this often (the MediaRecorder
 * timeslice). A clip asks for the newest bytes anyway (requestData), so this
 * sets how much sound a crash can lose, and the size of each message.
 */
export const SOUND_TIMESLICE_MS = 250;

/** Sound recorder failures in a row before the engine records no game sound for this session. */
export const SOUND_FAILURE_LIMIT = 4;

/** The MediaRecorder type of each tier (the capability probe checked these exact strings). */
export const RECORDER_TYPES: Readonly<Record<"M" | "V", string>> = { M: MP4_TYPE, V: WEBM_TYPE };

/**
 * The types that the sound recorder tries, in order. The last one is the
 * tier's video type (the probe checked it): with a stream that has only a
 * sound track, it makes a file with only a sound track. A tier M sound run is
 * AAC in MP4 and a tier V run is Opus in WebM, so the clip's container can
 * hold it.
 */
export const SOUND_TYPES: Readonly<Record<"M" | "V", readonly string[]>> = {
  M: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", MP4_TYPE],
  V: ["audio/webm;codecs=opus", WEBM_TYPE],
};

/** The container of each tier's files (plan 5: tier V files are labeled honestly as WebM). */
export const RECORDER_CONTAINERS: Readonly<Record<"M" | "V", SegmentContainer>> = { M: "mp4", V: "webm" };
