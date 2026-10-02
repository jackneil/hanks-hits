// The heads-up card of Retro Arcade (Jack, 2026-10-02).
//
// The catalogs list mainstream violent classics (Mortal Kombat, Doom) like
// every other game: no label, no badge, no color in the list. When a player
// opens one, a short card shows before the emulator loads. The card shows
// each time, so a younger child on the same device sees it too.
//
// This module is safe for the browser: it has the notice rules only (the
// generated file), never the block rules (content-rules.json).

import { NOTICE_RULE_PATTERNS } from "./content-notice.generated";
import { matchContentRule, type ContentRuleMatch, type TitleCandidate } from "./content-match";

const NOTICE_RULES: readonly ContentRuleMatch[] = NOTICE_RULE_PATTERNS.map((rule) => ({
  id: rule.id,
  pattern: new RegExp(rule.pattern, "i"),
  action: "notice",
}));

/**
 * The notice rule of a game that a player opens, or null. Read the catalog
 * entry (name, file name and id), or the name of an uploaded file.
 */
export function findOpenNoticeRule(game: TitleCandidate): ContentRuleMatch | null {
  return matchContentRule(game, NOTICE_RULES);
}

/** The words of the card. Keep them short: many players are 6 to 8 years old. */
export const CONTENT_NOTICE_TEXT = {
  heading: "Heads up!",
  body: "This is an old game made for teens and grown-ups. It has fighting and blood.",
  advice: "Ask a grown-up if you are not sure.",
  play: "Play",
  pickAnother: "Pick another game",
  /** What the voice says about the two buttons. */
  spokenChoices: "Tap Play to play the game. Tap Pick another game to go back.",
} as const;
