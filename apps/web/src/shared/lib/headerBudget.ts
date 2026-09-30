/**
 * GameShell header width budget.
 *
 * The header must fit on every phone width, in every state, with no
 * control pushed off the screen and no control smaller than 44 px. This
 * module is the one place that decides the layout. It is a pure function
 * of the viewport width and the controls that are present, so the header
 * matrix (320 to 480 px, guest and signed in, pausable or not, with and
 * without the clip slot) is testable without a browser.
 *
 * The steps apply in this order (design/clips plan, section 11.2):
 *   0. On a phone with a touch screen, during play (a run is live, so the
 *      pause menu is one tap away), Leaderboard and Sign In leave the
 *      header: the pause menu holds both, and the result chip holds
 *      Leaderboard at game over. A kid in the middle of a run does not
 *      sign in, and Sign In (96 px) was the largest control in the header
 *      (phone UX audit 2026-09-29, S14; main-loop decision 3). "Phone"
 *      means the short side of the screen is 480 px or less, so a phone
 *      held sideways (844 x 390) is a phone too. Between runs (the start
 *      card, game over) both stay in the header.
 *   1. Below 480 px, the gap between the right-hand controls goes to 0.
 *      Each control keeps its 44 px hit area.
 *   2. Below 480 px, the title becomes the game emoji. The full name stays
 *      in the accessible name, on the start card and in the pause menu.
 *   3. Below 400 px, Leaderboard and Restart leave the header. This applies
 *      only to a game that can pause AND that has set resultChipReady. That
 *      flag promises that the result chip holds both at game over and that
 *      the pause menu opens on every other screen between runs (the start
 *      card, a level card), so neither control becomes unreachable. A game
 *      whose start card or level card cannot pause does not set it.
 *   4. If the header is still too wide, the Sign In button drops its label.
 *   5. Below 340 px, Fullscreen moves into the pause menu for a game that
 *      can pause. A game that cannot pause keeps it in the header. Between
 *      runs (no pause menu yet), GameShell shows Fullscreen in the reserved
 *      pause slot, so it is always reachable.
 *   6. If the header is still too wide, the emoji title drops its padding
 *      and becomes a smaller glyph (24 px). This fits every case of the
 *      header matrix, with the plan's minimum title width of 16 px.
 *   7. A guard that the header matrix never reaches: if the header is
 *      still too wide, the title becomes a screen-reader-only name.
 *
 * "pausable" means that the kid can open the pause menu by touch: the
 * game can pause at some point AND the header shows its pause button.
 * Every step keys on this capability, never on the current pause state,
 * so the header does not reflow when a run starts or ends.
 */

/** The hit area of one header control, in CSS pixels. */
export const HEADER_CONTROL_PX = 44;
/** The px-3 padding on both sides of the header row. */
export const HEADER_PADDING_X_PX = 24;
/** The gap-1 gap between two right-hand controls at wide widths. */
export const HEADER_GAP_PX = 4;
/** The emoji title, with its own padding. */
export const HEADER_EMOJI_TITLE_PX = 44;
/**
 * The tight emoji title: a text-xl glyph with no padding. Measured at 22 px
 * in Chromium (2026-09-28); 2 px more covers other emoji fonts.
 */
export const HEADER_EMOJI_TIGHT_TITLE_PX = 24;
/** The smallest title width that the plan accepts (section 15.2). */
export const HEADER_TITLE_MIN_PX = 16;
/** The smallest width at which a text title is still readable. */
export const HEADER_TEXT_TITLE_MIN_PX = 96;
/**
 * The Sign In button with its label (icon, gap and "Sign In"). Measured at
 * 92 px in Nunito (2026-09-28); 4 px more covers the fallback font that
 * shows before Nunito loads.
 */
export const HEADER_SIGN_IN_LABEL_PX = 96;
/** The Sign In button without its label (icon and padding only). Measured at 46 px. */
export const HEADER_SIGN_IN_ICON_PX = 46;

/** Below this width the gap goes to 0 and the title becomes the emoji. */
export const HEADER_COMPACT_BELOW_PX = 480;
/** Below this width Leaderboard and Restart can move to the pause menu. */
export const HEADER_RESULT_CHIP_BELOW_PX = 400;
/** Below this width Fullscreen moves into the pause menu. */
export const HEADER_FULLSCREEN_TO_MENU_BELOW_PX = 340;
/**
 * A screen whose short side is this or less is a phone, in both
 * orientations. It matches the short: variant (max-height 480 px) of a
 * phone held sideways.
 */
export const PHONE_SHORT_SIDE_MAX_PX = 480;

/** True for a phone screen in either orientation (the short side is 480 px or less). */
export function isPhoneScreen(width: number, height: number): boolean {
  return Math.min(width, height) <= PHONE_SHORT_SIDE_MAX_PX;
}

/** Which sign-in control the header shows. */
export type HeaderLogin = "guest" | "signedIn" | "none";

/** The controls that a GameShell header can show. */
export interface HeaderControls {
  /** The home button, or the spacer that replaces it (both are 44 px). */
  home: boolean;
  leaderboard: boolean;
  fullscreen: boolean;
  restart: boolean;
  /** The pause button slot. The shell keeps the slot while a run is not active. */
  pause: boolean;
  clipSlot: boolean;
  login: HeaderLogin;
  /**
   * The kid can open the pause menu by touch: the game can pause at some
   * point AND the header shows a pause button. A capability, not the
   * current state.
   */
  pausable: boolean;
  /**
   * The game shows the shared result chip at game over, and every other
   * screen between runs opens the pause menu (GameShellProps.resultChipReady).
   */
  resultChipReady: boolean;
  /** An emoji is known for the title. */
  hasEmoji: boolean;
  /**
   * A phone with a touch screen, during play: a run is live and the pause
   * menu is one tap away (step 0). Default false.
   */
  phonePlay?: boolean;
  /**
   * The game has its own pause screen on the shared GameSheet (it passes
   * shellActions), so during play that sheet can hold Leaderboard and Sign
   * In even with no shell pause menu (step 0). Default false.
   */
  ownPauseSheet?: boolean;
}

/** Where a movable control is shown. */
export type HeaderPlacement = "header" | "moved" | "none";

/** The layout decision for one viewport width. */
export interface HeaderLayout {
  /** Gap 0 between the right-hand controls. */
  compactGap: boolean;
  /**
   * "emojiTight" is the emoji with no padding and a smaller glyph.
   * "screenReaderOnly" is a guard that the header matrix never reaches.
   */
  title: HeaderTitle;
  /** "moved" means the pause menu and the result chip hold it. */
  leaderboard: HeaderPlacement;
  /** "moved" means the pause menu and the result chip hold it. */
  restart: HeaderPlacement;
  /** "moved" means the pause menu holds it. */
  fullscreen: HeaderPlacement;
  /**
   * The guest Sign In control. "moved" means the pause menu holds it
   * (step 0). "none" when the login control is not the guest button (the
   * signed-in avatar stays in the header, it is 44 px).
   */
  signIn: HeaderPlacement;
  /** The Sign In button shows its label. Always false when login is not "guest". */
  signInLabel: boolean;
  /** The width that the layout needs, in CSS pixels. */
  requiredPx: number;
  /** The width that is left for the title, in CSS pixels. */
  titleRoomPx: number;
  /** The layout fits inside the viewport width. */
  fits: boolean;
}

/** How the header shows the game's name. */
export type HeaderTitle = "text" | "emoji" | "emojiTight" | "screenReaderOnly";

type Decision = Omit<HeaderLayout, "requiredPx" | "titleRoomPx" | "fits">;

const TITLE_PX: Record<HeaderTitle, number> = {
  text: HEADER_TEXT_TITLE_MIN_PX,
  emoji: HEADER_EMOJI_TITLE_PX,
  emojiTight: HEADER_EMOJI_TIGHT_TITLE_PX,
  screenReaderOnly: 0,
};

function clusterWidths(controls: HeaderControls, d: Decision): number[] {
  const widths: number[] = [];
  if (d.leaderboard === "header") widths.push(HEADER_CONTROL_PX);
  if (d.fullscreen === "header") widths.push(HEADER_CONTROL_PX);
  if (d.restart === "header") widths.push(HEADER_CONTROL_PX);
  if (controls.clipSlot) widths.push(HEADER_CONTROL_PX);
  if (controls.pause) widths.push(HEADER_CONTROL_PX);
  if (controls.login === "guest") {
    if (d.signIn === "header") {
      widths.push(d.signInLabel ? HEADER_SIGN_IN_LABEL_PX : HEADER_SIGN_IN_ICON_PX);
    }
  } else if (controls.login === "signedIn") {
    widths.push(HEADER_CONTROL_PX);
  }
  return widths;
}

/** The width in CSS pixels that everything except the title needs. */
function widthWithoutTitle(controls: HeaderControls, d: Decision): number {
  const cluster = clusterWidths(controls, d);
  const gap = d.compactGap ? 0 : HEADER_GAP_PX;
  const clusterPx =
    cluster.reduce((sum, w) => sum + w, 0) + Math.max(0, cluster.length - 1) * gap;
  // The home button and its spacer are the same 44 px, so the title
  // stays centered whether the home button shows or not.
  return HEADER_PADDING_X_PX + HEADER_CONTROL_PX + clusterPx;
}

/** The width in CSS pixels that a layout decision needs. */
function requiredWidth(controls: HeaderControls, d: Decision): number {
  return widthWithoutTitle(controls, d) + TITLE_PX[d.title];
}

/**
 * Decide the header layout for one viewport width.
 *
 * @param width The viewport width in CSS pixels.
 * @param controls The controls that the header can show.
 */
export function planHeader(width: number, controls: HeaderControls): HeaderLayout {
  const compact = width < HEADER_COMPACT_BELOW_PX;

  const d: Decision = {
    // Step 1
    compactGap: compact,
    // Step 2
    title: compact && controls.hasEmoji ? "emoji" : "text",
    leaderboard: controls.leaderboard ? "header" : "none",
    restart: controls.restart ? "header" : "none",
    fullscreen: controls.fullscreen ? "header" : "none",
    signIn: controls.login === "guest" ? "header" : "none",
    signInLabel: controls.login === "guest",
  };

  // Step 0: a phone during play. The pause menu (or the game's own pause
  // sheet) holds Leaderboard and Sign In (and the result chip holds
  // Leaderboard at game over).
  if (controls.phonePlay && (controls.pausable || controls.ownPauseSheet)) {
    if (d.leaderboard === "header") d.leaderboard = "moved";
    if (d.signIn === "header") {
      d.signIn = "moved";
      d.signInLabel = false;
    }
  }

  // Step 3: only when the pause menu AND the result chip can hold them.
  if (
    width < HEADER_RESULT_CHIP_BELOW_PX &&
    controls.pausable &&
    controls.resultChipReady
  ) {
    if (d.leaderboard === "header") d.leaderboard = "moved";
    if (d.restart === "header") d.restart = "moved";
  }

  // Step 4
  if (d.signInLabel && requiredWidth(controls, d) > width) {
    d.signInLabel = false;
  }

  // Step 5: a game that cannot pause has no menu to hold Fullscreen.
  if (
    width < HEADER_FULLSCREEN_TO_MENU_BELOW_PX &&
    controls.pausable &&
    d.fullscreen === "header"
  ) {
    d.fullscreen = "moved";
  }

  // Step 6: a smaller emoji with no padding.
  if (d.title === "emoji" && requiredWidth(controls, d) > width) {
    d.title = "emojiTight";
  }

  // Step 7: a guard that the header matrix never reaches. The name stays
  // for screen readers.
  if (d.title === "emojiTight" && requiredWidth(controls, d) > width) {
    d.title = "screenReaderOnly";
  }

  const requiredPx = requiredWidth(controls, d);
  return {
    ...d,
    requiredPx,
    titleRoomPx: width - widthWithoutTitle(controls, d),
    fits: requiredPx <= width,
  };
}

type EmojiLookup = Record<string, { name: string; icon: string }>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Find the title emoji for a GameShell.
 *
 * Order: the emoji prop, then the metadata for the appId, then the
 * metadata for the route's own id (a game or app folder name is its
 * metadata id), then a metadata entry whose name or id matches the game
 * name. Returns null when no emoji is known. The header then keeps the
 * text title, which is safer than a generic picture that tells the kid
 * nothing.
 */
export function resolveHeaderEmoji(
  lookup: EmojiLookup,
  options: { emoji?: string; appId?: string; routeId?: string | null; gameName: string }
): string | null {
  const { emoji, appId, routeId, gameName } = options;
  if (emoji && emoji.trim()) return emoji;

  const has = (key: string) => Object.hasOwn(lookup, key);
  if (appId && has(appId)) return lookup[appId].icon;
  if (routeId && has(routeId)) return lookup[routeId].icon;

  const wanted = gameName.trim().toLowerCase();
  for (const key of Object.keys(lookup)) {
    if (lookup[key].name.toLowerCase() === wanted) return lookup[key].icon;
  }

  const slug = slugify(gameName);
  if (slug && has(slug)) return lookup[slug].icon;

  return null;
}

/**
 * The game or app id in a route path, or null. "/apps/weather" gives
 * "weather"; "/" and "/profile" give null.
 */
export function routeIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const match = /^\/(?:games|apps)\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
