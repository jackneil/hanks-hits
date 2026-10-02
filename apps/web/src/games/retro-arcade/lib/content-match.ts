// The one matcher of the Retro Arcade content rules.
//
// This module holds no rules. Two modules give it rules:
// - content-rules.ts gives all the rules (from content-rules.json). The ROM
//   proxy, the catalog test and the Python generators use that data. Import
//   content-rules.ts only in server code and tests.
// - contentNotice.ts gives only the notice rules (from the generated file
//   content-notice.generated.ts). The arcade uses it in the browser to find
//   the titles that get the heads-up card.
// Keep normalizeTitle(), withoutDumpTags() and candidateTexts() the same as
// normalize(), without_dump_tags() and candidate_texts() in
// scripts/retro_content_rules.py.

/**
 * What a rule does (Jack, 2026-10-02).
 * - "block": sexual content. No catalog lists the title, the ROM proxy
 *   refuses its ROM, and the generators do not upload it.
 * - "notice": a mainstream violent classic. The title stays in the catalog
 *   with no label in the list, and a heads-up card shows when a player
 *   opens it.
 */
export type ContentAction = "block" | "notice";

/** The fields of a rule that the matcher reads. */
export interface ContentRuleMatch {
  id: string;
  pattern: RegExp;
  action: ContentAction;
}

/** The fields of a catalog entry (or of an uploaded file) that the rules read. */
export interface TitleCandidate {
  displayName: string;
  filename?: string;
  id?: string;
}

/** Lowercase, change "_" and "-" to spaces, and collapse the spaces. */
export function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function withoutExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Removes the tags at the end of a ROM dump name: from the first "(" or "["
 * to the end. No-Intro "Halloween (USA)" and GoodTools "Halloween (1983)
 * (Wizard Video Games) [!]" both give "Halloween". Keep this the same as
 * without_dump_tags() in scripts/retro_content_rules.py.
 */
export function withoutDumpTags(text: string): string {
  return text.replace(/\s*[([].*$/, "");
}

/**
 * The texts that a rule reads: the display name, the ROM file name without
 * its extension, and the id. Each one is normalized as it is, and again
 * with no dump tags. Old ROM dumps often have short file names (for example
 * "custerev"), so a display name alone is not enough. A player's own file
 * often has a dump name with tags, and a rule anchored at the end
 * ("^halloween$") must still match it.
 */
export function candidateTexts(game: TitleCandidate): string[] {
  const texts: string[] = [];
  for (const text of [game.displayName, game.filename ? withoutExtension(game.filename) : undefined, game.id]) {
    if (!text) continue;
    for (const candidate of [normalizeTitle(text), normalizeTitle(withoutDumpTags(text))]) {
      if (candidate && !texts.includes(candidate)) texts.push(candidate);
    }
  }
  return texts;
}

/**
 * Returns the rule that applies to this title, or null when no rule matches.
 * A block rule applies before a notice rule: a title that matches both is
 * blocked. Among the rules of one action, the first rule in the list applies.
 */
export function matchContentRule<R extends ContentRuleMatch>(
  game: TitleCandidate,
  rules: readonly R[]
): R | null {
  const texts = candidateTexts(game);
  let notice: R | null = null;
  for (const rule of rules) {
    if (!texts.some((text) => rule.pattern.test(text))) continue;
    if (rule.action === "block") return rule;
    notice ??= rule;
  }
  return notice;
}

/** Reads an action from rule data. Unknown text is an error, never a silent allow. */
export function toContentAction(value: string, ruleId: string): ContentAction {
  if (value === "block" || value === "notice") return value;
  throw new Error(`content rule "${ruleId}" has an unknown action "${value}"`);
}
