/**
 * Every kid-facing string of the clip surfaces (plan 11.6).
 *
 * Rules (the copy test in __tests__/copy.test.ts runs against this table):
 * - "Save" appears ONLY in the phrases for copies that leave the site:
 *   "Save to Photos", "Save to phone", "Save to computer", "Save to Files".
 *   Marking a clip to keep it says "Keep" and "Kept".
 * - None of the "Never" words of plan 11.6 appear (clapper, camera, record
 *   button, export, recording file, photo outside "Save to Photos",
 *   screenshot, Download, post, URL, upload).
 * - No em-dash and no en-dash. No sign-in prompt on any clip surface.
 * - Every reason code has kid words AND a next step.
 * - Headings are plain text (no emoji). Emoji pair with a word only.
 *
 * Put a new string here, never inline in a component, so the copy test
 * sees it. A string with a value in it is a function; list a sample call
 * of it in allCopyStrings() at the end of this file.
 */

import type { ClipActionResult, ClipButtonState, ClipReasonCode, ShareOutcome } from "../service/contract";
import type { ClipKind } from "../protocol";

// ---------------------------------------------------------------------------
// Platforms for the "Save to ..." buttons (plan 12)
// ---------------------------------------------------------------------------

/**
 * Where a copy that leaves the site goes.
 * - "photos": iPhone and iPad. The share sheet has "Save Video".
 * - "phone": Android phones and tablets.
 * - "computer": everything else (desktop, Chromebook).
 */
export type SavePlatform = "photos" | "phone" | "computer";

// ---------------------------------------------------------------------------
// Reasons (every ClipReasonCode: kid words and a next step)
// ---------------------------------------------------------------------------

export interface ReasonCopy {
  /** What happened, in kid words. */
  say: string;
  /** What to do next. Always a separate sentence. */
  next: string;
}

/** Every ClipReasonCode, for the copy test and for exhaustive loops. */
export const CLIP_REASON_CODES = [
  "warming",
  "flag-off",
  "no-tier",
  "other-tab",
  "breaker",
  "resting",
  "record-only",
  "quota",
  "storage-unavailable",
  "encoder-error",
  "mux-failed",
  "source-lost",
  "hidden",
] as const satisfies readonly ClipReasonCode[];

// A compile error here means a new ClipReasonCode is missing from the list.
type MissingReasonCode = Exclude<ClipReasonCode, (typeof CLIP_REASON_CODES)[number]>;
const reasonListIsComplete: [MissingReasonCode] extends [never] ? true : never = true;
void reasonListIsComplete;

export const REASON_COPY: Record<ClipReasonCode, ReasonCopy> = {
  warming: { say: "Play a little first!", next: "Then tap the clip button again." },
  "source-lost": { say: "Play a little first!", next: "Then tap the clip button again." },
  "flag-off": { say: "Clips are not on here yet.", next: "Keep playing and have fun!" },
  "no-tier": {
    say: "This browser cannot make clips.",
    next: "Ask a grown-up to open the game in Chrome or Safari.",
  },
  "other-tab": {
    say: "Clips are on in another tab.",
    next: "Close the other tab, then tap the clip button again.",
  },
  breaker: {
    say: "Clips are off for this game on this device: it crashed while recording.",
    next: "They come back after a few good games.",
  },
  resting: {
    say: "The clip button is resting so your game stays fast.",
    next: "Hold the clip button, then tap Turn the clip button back on.",
  },
  "record-only": {
    say: "This game is too big for instant clips on this phone.",
    next: "You can still record!",
  },
  quota: { say: "Your clip space is full.", next: "Delete some old clips, then try again." },
  "storage-unavailable": {
    say: "This browser has no room for clips right now.",
    next: "Close some tabs, then try again.",
  },
  "encoder-error": {
    say: "The clip maker hit a bump.",
    next: "Keep playing, then try again in a few seconds.",
  },
  "mux-failed": { say: "That clip did not work.", next: "Tap the clip button to try again." },
  hidden: {
    say: "Clips wait while the game is paused.",
    next: "Go back to the game, then tap the clip button.",
  },
};

/** The full reason text: what happened, then the next step. */
export function reasonText(code: ClipReasonCode): string {
  const copy = REASON_COPY[code];
  return `${copy.say} ${copy.next}`;
}

// ---------------------------------------------------------------------------
// The clip button (plan 11.3)
// ---------------------------------------------------------------------------

/** The accessible name of the clip button in each state. */
export const BUTTON_NAMES: Record<Exclude<ClipButtonState, "hidden">, string> = {
  warming: "Clip button. Getting ready.",
  ready: "Clip button. Tap to clip the last 30 seconds. Hold for more.",
  saving: "Clip button. Making your clip.",
  made: "Clip button. Clip made! Tap to clip again.",
  recording: "Stop the video",
  resting: "Clip button. Resting. Tap for more.",
  suspended: "Clip button. Tap to clip the last 30 seconds.",
  "source-lost": "Clip button. Getting ready.",
  recovering: "Clip button. Getting ready.",
  exporting: "Clip button. Making your video.",
  "record-only": "Clip button. Tap to record a video.",
  disabled: "Clip button. Clips are off for this game.",
  error: "Clip button. That did not work.",
};

/** The tooltip on a mouse hover. */
export const BUTTON_TOOLTIP = "Clip it! (Alt+C)";

// ---------------------------------------------------------------------------
// Results (in-play confirmation and the live announcement)
// ---------------------------------------------------------------------------

export const RESULT_COPY: Record<ClipActionResult["action"], string> = {
  clip: "Clip made!",
  extend: "Clip made! (longer)",
  record: "Video made!",
  picture: "Picture made!",
};

/** The words for an action result: the made text, or the reason. */
export function resultText(result: ClipActionResult): string {
  return result.ok ? RESULT_COPY[result.action] : reasonText(result.reason);
}

// ---------------------------------------------------------------------------
// Capture menu (plan 11.4)
// ---------------------------------------------------------------------------

export const MENU_COPY = {
  title: "Clips",
  clipLast: "Clip the last 30 seconds",
  record: "Record a video",
  stopRecording: "Stop the video",
  picture: "Take a picture",
  myClips: "My clips from this game",
  settings: "Clip settings",
  wake: "Turn the clip button back on",
  close: "Back to the game",
} as const;

// ---------------------------------------------------------------------------
// In-play toast slot (plan 11.1, 11.3, 8.4)
// ---------------------------------------------------------------------------

export const TOAST_COPY = {
  /** The new-clip chip under the header. */
  newClip: "New clip",
  newClipName: "New clip. Tap to watch it.",
  /** The chip reply in a run that cannot pause. */
  readyAtRunEnd: "Your clip is ready when this run ends!",
  /** The star button while a video records. */
  addStar: "Add a star",
  /** The one-time tip after the third clip (plan 11.4). */
  holdTip: "Tip: hold the clip button to see more ways to clip!",
  holdTipDone: "Got it",
} as const;

/** The accessible name of the video timer pill. */
export function recordTimerName(time: string, stars: number): string {
  if (stars === 0) return `Video time ${time}`;
  return `Video time ${time}. ${stars === 1 ? "1 star" : `${stars} stars`}.`;
}

// ---------------------------------------------------------------------------
// Viewer (plan 11.4, 12)
// ---------------------------------------------------------------------------

export const VIEWER_TITLES: Record<ClipKind, string> = {
  clip: "Your clip",
  auto: "Your clip",
  record: "Your video",
  picture: "Your picture",
};

export const SAVE_LABELS: Record<SavePlatform, string> = {
  photos: "Save to Photos",
  phone: "Save to phone",
  computer: "Save to computer",
};

/** Only for a clip too big to share on an iPhone (plan 12). Not used before Phase 5. */
export const SAVE_TO_FILES = "Save to Files";

export const VIEWER_COPY = {
  share: "Share",
  keep: "Keep",
  kept: "Kept",
  delete: "Delete",
  close: "Close",
  deleteYes: "Yes, delete it",
  deleteNo: "No, go back",
  /** The name of a clip whose game the library does not know (a re-indexed file). */
  unknownGame: "A game you played",
  loading: "Getting your clip ready...",
  missingSay: "We cannot find this clip.",
  missingNext: "Tap Close to go back.",
  /** The coach line next to Save to Photos, with a picture of the Save Video icon (plan 8.2). */
  photosCoach: "In the list that opens, look for this button and tap it.",
  gameListTitle: "My clips from this game",
  gameListEmptySay: "No clips from this game yet.",
  gameListEmptyNext: "Tap the clip button while you play!",
  backToList: "Back to my clips",
  /** The mark on a clip tile the kid has not watched. */
  newMark: "New",
} as const;

/** The delete question for each kind of clip. */
export const DELETE_QUESTIONS: Record<ClipKind, string> = {
  clip: "Delete this clip? You cannot get it back.",
  auto: "Delete this clip? You cannot get it back.",
  record: "Delete this video? You cannot get it back.",
  picture: "Delete this picture? You cannot get it back.",
};

/**
 * The sticky note for a clip that lives only in memory (a private window,
 * plan 8.1). It names the real button on this platform.
 */
export const MEMORY_NOTE: Record<SavePlatform, string> = {
  photos: "This clip goes away when you close this window. Share it, or tap Save to Photos now!",
  phone: "This clip goes away when you close this window. Share it, or tap Save to phone now!",
  computer: "This clip goes away when you close this window. Share it, or tap Save to computer now!",
};

/** The accessible name of a clip tile. */
export function tileName(gameName: string, kind: ClipKind, length: string | null): string {
  const what = kind === "picture" ? "Picture" : kind === "record" ? "Video" : "Clip";
  return length ? `${what} from ${gameName}, ${length} long` : `${what} from ${gameName}`;
}

// ---------------------------------------------------------------------------
// Share and Save replies (plan 12)
// ---------------------------------------------------------------------------

/** The reply for each share outcome. null means stay quiet (a double tap). */
export function shareReply(outcome: ShareOutcome["kind"], platform: SavePlatform): string | null {
  const saveLabel = platform === "computer" ? SAVE_LABELS.computer : SAVE_LABELS.phone;
  switch (outcome) {
    case "shared":
      return "Shared!";
    case "cancelled":
      return "No problem. Your clip is safe in My Clips.";
    case "retry":
      return "Tap Share one more time.";
    case "ignored":
      return null;
    case "fallback-save":
      return `This clip cannot be shared here. Tap ${saveLabel}.`;
    case "blocked":
      return "A grown-up setting stops sharing on this device. Ask a grown-up for help.";
    case "unsupported":
      return `This browser cannot share clips. Tap ${saveLabel}.`;
  }
}

/** The reply after a Save to ... button. */
export function saveReply(
  outcome: { kind: "saved" } | { kind: "failed"; reason: "blocked" | "unknown" },
  platform: SavePlatform,
): string {
  if (outcome.kind === "saved") {
    return platform === "computer" ? "It is on your computer now!" : "It is on your phone now!";
  }
  if (outcome.reason === "blocked") {
    return "A grown-up setting stops this on this device. Ask a grown-up for help.";
  }
  return `That did not work. Tap ${SAVE_LABELS[platform]} again.`;
}

// ---------------------------------------------------------------------------
// Pause menu and result chip parts (plan 11.4)
// ---------------------------------------------------------------------------

export const PAUSE_ENTRY_LABEL = "Clips";

export const RESULT_ACTION_COPY = {
  watch: "Watch",
  wholeRun: "Make the whole run a video",
  record: "Record a video",
  picture: "Take a picture",
} as const;

/** "Make the whole run a video (0:42)". */
export function wholeRunLabel(length: string): string {
  return `${RESULT_ACTION_COPY.wholeRun} (${length})`;
}

// ---------------------------------------------------------------------------
// Clip settings sheet
// ---------------------------------------------------------------------------

export const SETTINGS_COPY = {
  title: "Clip settings",
  howTitle: "How to clip",
  tapTip: "Tap the clip button to clip the last 30 seconds.",
  holdTip: "Hold the clip button to see more.",
  keyTip: "On a keyboard, press Alt and C. On a Mac, press Option and C.",
  padTip: "On a game controller, press the share button.",
  whereTip: "Your clips stay on this device.",
  storageLoading: "Counting your clips...",
} as const;

/** "You have 5 clips on this device. They use 42 MB." */
export function storageLine(count: number, used: string): string {
  if (count === 0) return "You have no clips on this device yet.";
  const clips = count === 1 ? "1 clip" : `${count} clips`;
  return `You have ${clips} on this device. They use ${used}.`;
}

// ---------------------------------------------------------------------------
// The copy test reads every string through this list
// ---------------------------------------------------------------------------

const PLATFORMS: SavePlatform[] = ["photos", "phone", "computer"];
const SHARE_KINDS: ShareOutcome["kind"][] = [
  "shared",
  "cancelled",
  "retry",
  "ignored",
  "fallback-save",
  "blocked",
  "unsupported",
];

/** Every kid-facing string, with sample values for the templates. */
export function allCopyStrings(): string[] {
  const out: string[] = [];
  for (const reason of Object.values(REASON_COPY)) out.push(reason.say, reason.next);
  for (const code of CLIP_REASON_CODES) out.push(reasonText(code));
  out.push(...Object.values(BUTTON_NAMES), BUTTON_TOOLTIP);
  out.push(...Object.values(RESULT_COPY));
  out.push(...Object.values(MENU_COPY));
  out.push(...Object.values(TOAST_COPY), recordTimerName("1:05", 0), recordTimerName("1:05", 1), recordTimerName("1:05", 3));
  out.push(...Object.values(VIEWER_TITLES), ...Object.values(SAVE_LABELS), SAVE_TO_FILES);
  out.push(...Object.values(VIEWER_COPY), ...Object.values(DELETE_QUESTIONS), ...Object.values(MEMORY_NOTE));
  out.push(tileName("Snake", "clip", "0:30"), tileName("Snake", "picture", null), tileName("Snake", "record", "2:10"));
  for (const platform of PLATFORMS) {
    for (const kind of SHARE_KINDS) {
      const reply = shareReply(kind, platform);
      if (reply) out.push(reply);
    }
    out.push(saveReply({ kind: "saved" }, platform));
    out.push(saveReply({ kind: "failed", reason: "blocked" }, platform));
    out.push(saveReply({ kind: "failed", reason: "unknown" }, platform));
  }
  out.push(PAUSE_ENTRY_LABEL, ...Object.values(RESULT_ACTION_COPY), wholeRunLabel("0:42"));
  out.push(...Object.values(SETTINGS_COPY), storageLine(0, "0 MB"), storageLine(1, "3 MB"), storageLine(12, "40 MB"));
  return out;
}
