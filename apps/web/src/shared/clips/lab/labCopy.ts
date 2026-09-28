/**
 * Every word that the clips lab shows (plan 11.6 copy rules).
 *
 * The lab page is for grown-ups who test clips. It exists only when the
 * server has CLIPS_LAB=1, so a kid does not see it. The words still follow
 * the plan 11.6 table and the kid-word rules, because the lab shows the same
 * actions as the real clip surfaces:
 * - "Clip it!", "Clip made!", "Record a video", "Video made!".
 * - "save" only inside a "Save to ..." phrase (the lab has none).
 * - Never: export, download, upload, screenshot, photo, URL, post, clapper,
 *   camera, record button, recording file.
 * - No em-dashes. Every error has a reason and a next step.
 * labCopy.test.ts checks this table against those rules.
 */
import type { ClipReasonCode } from "../service/contract";

export const LAB_COPY = Object.freeze({
  title: "Clips lab",
  intro:
    "This page checks that clips keep the picture and the sound together. Tap Start. Once each second, the picture flashes white and a beep plays.",
  start: "Start",
  stop: "Stop",
  clip: "Clip it! (10 s)",
  recordStart: "Record a video",
  recordStop: "Stop the video",
  clipMade: "Clip made!",
  videoMade: "Video made!",
  working: "Making your clip. Wait a moment.",
  noClipTitle: "No clip yet",
  noClip: "Tap Start and play for a few seconds. Then tap Clip it! or Record a video.",
  serviceLoading: "Getting clips ready. Wait a moment.",
  serviceMissing: "Clips are not on for this page. Turn clips on, then load the page again.",
  serviceError: "Clips could not start. Load the page again.",
  noPicture: "This browser cannot draw this picture. Open the page without gl=2, then try again.",
  soundOff: "The sound is off. Tap Start to turn it on.",
  soundMissing: "This browser has no game sound. Try another browser.",
  lastClipTitle: "Last clip",
  statusTitle: "What the lab sees",
});

/** Plain words for each reason code, with a next step (plan 11.6: every error has a reason and a next step). */
export const LAB_REASON_TEXT: Readonly<Record<ClipReasonCode | "busy" | "cancelled", string>> = Object.freeze({
  warming: "Clips need a few more seconds of play. Keep playing, then try again.",
  "flag-off": "Clips are off right now. Turn clips on, then load the page again.",
  "no-tier": "This browser cannot make videos. Try another browser.",
  "other-tab": "Clips are on in another tab. Close that tab, then try again.",
  breaker: "Clips stopped because something went wrong while recording. Load the page again.",
  resting: "Clips are resting so the game stays fast. Tap Start again to wake them.",
  "record-only": "This device can only record videos. Tap Record a video.",
  quota: "There is no more room for clips. Remove some clips, then try again.",
  "storage-unavailable": "This browser cannot keep clips. Try another browser.",
  "encoder-error": "The video maker had a problem. Wait a moment, then try again.",
  "mux-failed": "The clip could not be made. Try again.",
  "source-lost": "The game picture went away. Tap Start, then try again.",
  hidden: "Clips wait while the game is paused or hidden. Play, then try again.",
  busy: "A clip is still being made. Wait a moment, then try again.",
  cancelled: "The tap did not finish. Try again.",
});

/** The words for a failed action. */
export function reasonText(reason: ClipReasonCode | "busy" | "cancelled" | null | undefined): string {
  return (reason && LAB_REASON_TEXT[reason]) || LAB_REASON_TEXT["mux-failed"];
}
