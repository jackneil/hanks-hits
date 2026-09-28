// Retro Arcade content blocklist.
//
// Guardrail 1 keeps this site kid-safe for ages 6-14: no blood, no gore and
// no sexual content. The rules live in content-blocklist.json so that two
// readers use the same data:
// - the catalog test (__tests__/catalog-content.test.ts) fails when a
//   catalog lists a blocked title, so a new catalog entry cannot bring one
//   back;
// - the catalog generators (scripts/retro_blocklist.py) skip blocked ROMs,
//   so a regenerated catalog stays clean.
// Keep normalizeTitle() the same as normalize() in scripts/retro_blocklist.py.

import blocklist from "./content-blocklist.json";

export type BlockedContentCategory = "gore" | "sexual";

export interface BlockedTitleRule {
  id: string;
  pattern: RegExp;
  category: BlockedContentCategory;
  reason: string;
  source: string;
  examples: readonly string[];
}

/** The fields of a catalog entry that the rules read. */
export interface TitleCandidate {
  displayName: string;
  filename?: string;
  id?: string;
}

function toCategory(value: string, ruleId: string): BlockedContentCategory {
  if (value === "gore" || value === "sexual") return value;
  throw new Error(`content-blocklist rule "${ruleId}" has an unknown category "${value}"`);
}

export const BLOCKED_TITLE_RULES: readonly BlockedTitleRule[] = blocklist.rules.map(
  (rule) => ({
    id: rule.id,
    pattern: new RegExp(rule.pattern, "i"),
    category: toCategory(rule.category, rule.id),
    reason: rule.reason,
    source: rule.source,
    examples: rule.examples,
  })
);

/** Kid-safe titles that look like blocked titles. No rule may match them. */
export const SAFE_LOOKALIKE_TITLES: readonly string[] = blocklist.safeTitles;

/** Lowercase, change "_" and "-" to spaces, and collapse the spaces. */
export function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function withoutExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Returns the first rule that blocks this title, or null when the title is
 * allowed. The rules read the display name, the ROM file name without its
 * extension, and the id. Old ROM dumps often have short file names (for
 * example "custerev"), so a display name alone is not enough.
 */
export function findBlockedRule(game: TitleCandidate): BlockedTitleRule | null {
  const texts = [
    game.displayName,
    game.filename ? withoutExtension(game.filename) : undefined,
    game.id,
  ]
    .filter((text): text is string => Boolean(text))
    .map(normalizeTitle);
  return (
    BLOCKED_TITLE_RULES.find((rule) => texts.some((text) => rule.pattern.test(text))) ??
    null
  );
}
