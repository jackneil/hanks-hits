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

/**
 * The "Save to ..." button that is on screen. It is the platform's button,
 * except on an iPhone or iPad where the share sheet cannot take the clip:
 * then the button is "Save to Files" and it copies the file to the device
 * (plan 12). Replies and notes name this button, never a button that is
 * not on screen.
 */
export type SaveButton = SavePlatform | "files";

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

const REASON_CODE_SET: ReadonlySet<string> = new Set(CLIP_REASON_CODES);

/**
 * True when the value is a ClipReasonCode. A service can also answer with
 * codes that are not reasons ("busy", "cancelled"); those have no kid words.
 */
export function isClipReasonCode(value: string): value is ClipReasonCode {
  return REASON_CODE_SET.has(value);
}

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
    // A tap on a resting button opens the Capture menu (plan 11.3), now or
    // at the end of a run that cannot pause. A hold in such a run clips.
    next: "Tap the clip button, then tap Turn the clip button back on.",
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
  // A paused game still clips the footage from before the pause (plan 11.3),
  // so this reason never says that clips stop. It answers a video or a
  // picture that needs the game to run.
  hidden: {
    say: "The game is paused right now.",
    next: "Go back to the game, then try again.",
  },
};

/**
 * The full reason text: what happened, then the next step. A code with no
 * kid words (a newer service) gets the general "hit a bump" words.
 */
export function reasonText(code: ClipReasonCode): string {
  const copy = isClipReasonCode(code) ? REASON_COPY[code] : REASON_COPY["encoder-error"];
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
  // A tap opens the Capture menu with these two rows (plan 11.3).
  "record-only": "Clip button. Tap for Record a video and Take a picture.",
  disabled: "Clip button. Clips are off for this game.",
  error: "Clip button. That did not work.",
};

/** The tooltip on a mouse hover. Apple keyboards say Option, not Alt. */
export function buttonTooltip(apple: boolean): string {
  return apple ? "Clip it! (Option+C)" : "Clip it! (Alt+C)";
}

/** The name of the in-play read-aloud button (the same words as ReadAloudButton). */
export const READ_ALOUD_NAME = "Read it to me";

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
  /** The close control when closing gives play back (the menu paused the game). */
  close: "Back to the game",
  /** The close control when the menu opened at a break (the pause menu, a start or result card): it goes back there. */
  back: "Back",
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
  /** A menu request in a run that cannot pause: the Capture menu waits for the break. */
  menuAtRunEnd: "The Clips menu opens when this run ends!",
  /** The star button while a video records. */
  addStar: "Add a star",
  /** The one-time tip after the third clip (plan 11.4). */
  holdTip: "Tip: hold the clip button to see more ways to clip!",
  holdTipDone: "Got it",
} as const;

/**
 * A Record video that a tab saved when it closed or crashed while it
 * recorded (plan 8.4 crash recovery). Plan 11.6 keeps "save" for the
 * "Save to ..." buttons, so the words say "safe".
 */
export const RECOVERED_COPY = {
  say: "Your video from last time is safe!",
  /** The reply under the header: the new-clip chip opens the video. */
  chipNext: "Tap New clip to watch it.",
  /** The button in My clips that opens the video. */
  watch: "Watch it",
} as const;

/** The reply when a video from last time comes back (the chip opens it). */
export function recoveredReplyText(): string {
  return `${RECOVERED_COPY.say} ${RECOVERED_COPY.chipNext}`;
}

/**
 * The reply when the Capture menu must wait for the end of a run that
 * cannot pause. A resting or record-only button first says why.
 */
export function deferredMenuText(reason: ClipReasonCode | null): string {
  return reason ? `${REASON_COPY[reason].say} ${TOAST_COPY.menuAtRunEnd}` : TOAST_COPY.menuAtRunEnd;
}

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

/**
 * Only on an iPhone or iPad, and only when the share sheet cannot take the
 * clip (too big, or a browser with no share sheet, plan 12). The file goes
 * to the Files app.
 */
export const SAVE_TO_FILES = "Save to Files";

/** The words of each "Save to ..." button. */
export const SAVE_BUTTON_LABELS: Record<SaveButton, string> = {
  ...SAVE_LABELS,
  files: SAVE_TO_FILES,
};

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
  /** A clip whose row is there but whose file cannot be read. */
  brokenSay: "This clip cannot play.",
  brokenNext: "Tap Delete to clear it away, or tap Close to go back.",
  /** The library did not delete the clip. */
  deleteFailed: "That did not work. Tap Delete to try again.",
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
 * plan 8.1). It names only the buttons that are on screen: the "Save to ..."
 * button, and Share when this browser can share.
 */
export function memoryNote(save: SaveButton, canShare: boolean): string {
  const label = SAVE_BUTTON_LABELS[save];
  return canShare
    ? `This clip goes away when you close this window. Share it, or tap ${label} now!`
    : `This clip goes away when you close this window. Tap ${label} now!`;
}

/** The accessible name of a clip tile. */
export function tileName(gameName: string, kind: ClipKind, length: string | null): string {
  const what = kind === "picture" ? "Picture" : kind === "record" ? "Video" : "Clip";
  return length ? `${what} from ${gameName}, ${length} long` : `${what} from ${gameName}`;
}

// ---------------------------------------------------------------------------
// Share and Save replies (plan 12)
// ---------------------------------------------------------------------------

/** The word for each kind of clip, in a sentence. */
export const KIND_NOUNS: Record<ClipKind, string> = {
  clip: "clip",
  auto: "clip",
  record: "video",
  picture: "picture",
};

/**
 * The reply for each share outcome. null means stay quiet (a double tap).
 * `save` is the "Save to ..." button that is on screen AFTER this outcome,
 * so the reply never names a button the kid cannot see.
 */
export function shareReply(outcome: ShareOutcome["kind"], save: SaveButton, kind: ClipKind = "clip"): string | null {
  const noun = KIND_NOUNS[kind];
  const saveLabel = SAVE_BUTTON_LABELS[save];
  switch (outcome) {
    case "shared":
      return "Shared!";
    case "cancelled":
      return `No problem. Your ${noun} is safe in My Clips.`;
    case "retry":
      return "Tap Share one more time.";
    case "ignored":
      return null;
    case "fallback-save":
      return `This ${noun} cannot be shared here. Tap ${saveLabel}.`;
    case "blocked":
      return "A grown-up setting stops sharing on this device. Ask a grown-up for help.";
    case "unsupported":
      return `This browser cannot share clips. Tap ${saveLabel}.`;
  }
}

/** Where a copied file lands, in kid words, for each "Save to ..." button. */
const SAVE_PLACES: Record<SaveButton, string> = {
  photos: "on this device",
  phone: "on your phone",
  computer: "on your computer",
  files: "in the Files app",
};

/**
 * The reply after a "Save to ..." button. The browser can only START a copy
 * (some ask first, some put it in a folder), so a good outcome tells the kid
 * where to look. It never claims the copy is finished.
 */
export function saveReply(
  outcome: { kind: "saved" } | { kind: "failed"; reason: "blocked" | "unknown" },
  save: SaveButton,
  kind: ClipKind = "clip",
): string {
  if (outcome.kind === "saved") return `Look for your ${KIND_NOUNS[kind]} ${SAVE_PLACES[save]}!`;
  if (outcome.reason === "blocked") {
    return "A grown-up setting stops this on this device. Ask a grown-up for help.";
  }
  return `That did not work. Tap ${SAVE_BUTTON_LABELS[save]} again.`;
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
  /** Not shown in games whose controller buttons all belong to the game (Retro Arcade). */
  padTip: "On a game controller, press the share button, or hold the back button.",
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

const SAVE_BUTTONS: SaveButton[] = ["photos", "phone", "computer", "files"];
const SHARE_KINDS: ShareOutcome["kind"][] = [
  "shared",
  "cancelled",
  "retry",
  "ignored",
  "fallback-save",
  "blocked",
  "unsupported",
];
const CLIP_KINDS: ClipKind[] = ["clip", "auto", "record", "picture"];

/** Every kid-facing string, with sample values for the templates. */
export function allCopyStrings(): string[] {
  const out: string[] = [];
  for (const reason of Object.values(REASON_COPY)) out.push(reason.say, reason.next);
  for (const code of CLIP_REASON_CODES) out.push(reasonText(code));
  out.push(...Object.values(BUTTON_NAMES), buttonTooltip(false), buttonTooltip(true), READ_ALOUD_NAME);
  out.push(...Object.values(RESULT_COPY));
  out.push(...Object.values(MENU_COPY));
  out.push(...Object.values(TOAST_COPY), recordTimerName("1:05", 0), recordTimerName("1:05", 1), recordTimerName("1:05", 3));
  out.push(deferredMenuText(null), deferredMenuText("resting"), deferredMenuText("record-only"));
  out.push(...Object.values(RECOVERED_COPY), recoveredReplyText());
  out.push(...Object.values(VIEWER_TITLES), ...Object.values(SAVE_BUTTON_LABELS));
  out.push(...Object.values(VIEWER_COPY), ...Object.values(DELETE_QUESTIONS));
  out.push(tileName("Snake", "clip", "0:30"), tileName("Snake", "picture", null), tileName("Snake", "record", "2:10"));
  for (const save of SAVE_BUTTONS) {
    out.push(memoryNote(save, true), memoryNote(save, false));
    for (const kind of CLIP_KINDS) {
      for (const outcome of SHARE_KINDS) {
        const reply = shareReply(outcome, save, kind);
        if (reply) out.push(reply);
      }
      out.push(saveReply({ kind: "saved" }, save, kind));
    }
    out.push(saveReply({ kind: "failed", reason: "blocked" }, save));
    out.push(saveReply({ kind: "failed", reason: "unknown" }, save));
  }
  out.push(PAUSE_ENTRY_LABEL, ...Object.values(RESULT_ACTION_COPY), wholeRunLabel("0:42"));
  out.push(...Object.values(SETTINGS_COPY), storageLine(0, "0 MB"), storageLine(1, "3 MB"), storageLine(12, "40 MB"));
  return out;
}
