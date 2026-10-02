/**
 * The words of the sign-in page (page.tsx). A Next.js page file may export
 * only the page, so the words live here, where the tests can read them.
 * User-facing copy: short words for young players, no dashes.
 */

export const LOGIN_TITLE = "Save your games";
export const LOGIN_ASK_A_GROWN_UP = "Ask a grown-up to sign in with Google.";
export const LOGIN_WHAT_IT_DOES = "Then your games and scores save to your account.";
export const LOGIN_GUEST_PLAY = "No sign in? That is OK. You can always play without it.";
export const LOGIN_FAILED = "That did not work. Ask a grown-up to try again.";

/** The words that the read-aloud button speaks. */
export const LOGIN_SPOKEN = `${LOGIN_TITLE}. ${LOGIN_ASK_A_GROWN_UP} ${LOGIN_WHAT_IT_DOES} ${LOGIN_GUEST_PLAY}`;

/**
 * Shown instead of the Google button when this browser is already signed
 * in. Signing in with a second Google account here would link it to the
 * first player's account (Auth.js account linking), so the page offers
 * "Sign out" first.
 */
export const LOGIN_SIGNED_IN_TITLE = "You are signed in";
export const LOGIN_SIGNED_IN_AS = "Your gamer name is";
export const LOGIN_SIGNED_IN_SWITCH = "To use a different Google account, sign out first.";
export const LOGIN_SIGNED_IN_SPOKEN = `${LOGIN_SIGNED_IN_TITLE}. ${LOGIN_SIGNED_IN_SWITCH}`;

/**
 * The notice for grown-ups, at the place where the site collects the
 * sign-in id (COPPA 16 CFR 312.4(d)(3) and 312.4(e), design/ACCOUNTS_COPPA.md
 * section 2.3). It says what an account keeps, the internal operations
 * that it is used for, and how we make sure that it is not used to contact
 * a player. The home page footer links here ("Privacy for grown-ups").
 */
export const LOGIN_NOTE_TITLE = "For grown-ups";
export const LOGIN_NOTE_KEEP =
  "When you sign in with Google, we keep one thing from Google: a sign-in number for the Google account. We also keep a gamer name that the site picks at random, the game progress and the scores.";
export const LOGIN_NOTE_NOT_KEPT =
  "We do not keep an email address, a name or a photo. Names, notes, drawings and places that a player types or makes in a game stay on the device.";
export const LOGIN_NOTE_USE =
  "We use the sign-in number only to sign the player in, to keep the games and scores with the correct account, to stop attacks and to find and fix errors.";
export const LOGIN_NOTE_NEVER =
  "We do not use it to contact a player, to show ads or to make a profile of a player. The account has no email address, so we cannot contact a player. The site has no ads and no code that follows a person to other websites.";
export const LOGIN_NOTE_DELETE =
  "You can delete the account at any time: sign in, open Profile and tap \"Delete this account\".";
