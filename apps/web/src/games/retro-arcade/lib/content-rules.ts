// Retro Arcade content rules (all of them, with the data of each rule).
//
// Guardrail 1 keeps this site kid-safe. Each rule in content-rules.json has
// an action (Jack, 2026-10-02):
// - "block" is for sexual content. These readers refuse a block rule:
//   - the catalog test (__tests__/catalog-content.test.ts) fails when a
//     catalog lists the title, so a new catalog entry cannot bring it back;
//   - the ROM proxy (app/api/roms/[...path]/route.ts) returns 404 for its
//     ROM file, so the title cannot be played from an old URL;
//   - the catalog generators (scripts/retro_content_rules.py) do not upload
//     or list it, so a regenerated catalog stays clean.
// - "notice" is for mainstream violent classics. The title stays in the
//   catalog with no label in the list, and the arcade shows a heads-up card
//   each time a player opens it (components/ContentNoticeCard.tsx). No
//   reader refuses a notice rule.
//
// Import this module only in server code and tests: the JSON has the block
// rules, and they are not for the browser bundle. The browser gets the
// notice rules only, through contentNotice.ts. The matcher is in
// content-match.ts, so both use the same code.

import rulesData from "./content-rules.json";
import {
  matchContentRule,
  toContentAction,
  type ContentAction,
  type ContentRuleMatch,
  type TitleCandidate,
} from "./content-match";

export { normalizeTitle, type ContentAction, type TitleCandidate } from "./content-match";

export type ContentCategory = "gore" | "sexual";

export interface ContentRule extends ContentRuleMatch {
  category: ContentCategory;
  reason: string;
  source: string;
  examples: readonly string[];
}

function toCategory(value: string, ruleId: string): ContentCategory {
  if (value === "gore" || value === "sexual") return value;
  throw new Error(`content rule "${ruleId}" has an unknown category "${value}"`);
}

/** The JSON form of a rule: the pattern is a string. */
export interface ContentRuleData {
  id: string;
  pattern: string;
  category: string;
  action: string;
  reason: string;
  source: string;
  examples: string[];
}

/** The rule data as it is in content-rules.json (the notice generator reads it). */
export const CONTENT_RULE_DATA: readonly ContentRuleData[] = rulesData.rules;

export const CONTENT_RULES: readonly ContentRule[] = CONTENT_RULE_DATA.map((rule) => ({
  id: rule.id,
  pattern: new RegExp(rule.pattern, "i"),
  category: toCategory(rule.category, rule.id),
  action: toContentAction(rule.action, rule.id),
  reason: rule.reason,
  source: rule.source,
  examples: rule.examples,
}));

/** Kid-safe titles that look like matched titles. No rule may match them. */
export const SAFE_LOOKALIKE_TITLES: readonly string[] = rulesData.safeTitles;

/** The rule that applies to this title (block before notice), or null. */
export function findContentRule(game: TitleCandidate): ContentRule | null {
  return matchContentRule(game, CONTENT_RULES);
}

function withAction(rule: ContentRule | null, action: ContentAction): ContentRule | null {
  return rule?.action === action ? rule : null;
}

/** The block rule of this title, or null. A catalog must not list a blocked title. */
export function findBlockRule(game: TitleCandidate): ContentRule | null {
  return withAction(findContentRule(game), "block");
}

/** The notice rule of this title, or null. A notice title opens behind the heads-up card. */
export function findNoticeRule(game: TitleCandidate): ContentRule | null {
  return withAction(findContentRule(game), "notice");
}

/**
 * The block rule of this ROM file name, or null. The ROM proxy (app/api/roms)
 * uses this function: it refuses a blocked ROM file and serves a notice one.
 */
export function findRomFileBlockRule(filename: string): ContentRule | null {
  return findBlockRule({ displayName: "", filename });
}
