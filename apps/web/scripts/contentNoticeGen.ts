/**
 * Writes the browser's copy of the Retro Arcade notice rules
 * (src/games/retro-arcade/lib/content-notice.generated.ts) from
 * src/games/retro-arcade/lib/content-rules.json.
 *
 * Why a generated file: the JSON also has the block rules (sexual content),
 * and those stay out of the browser bundle. The arcade needs only the notice
 * rules in the browser, to show the heads-up card when a player opens a
 * mainstream violent classic (Jack, 2026-10-02).
 *
 * The runner is generate-content-notice.ts (pnpm generate:content-notice;
 * pnpm build runs it too). The test content-notice.test.ts fails when the
 * committed file is not the output of this function.
 */

/** The fields of a JSON rule that this generator reads. */
export interface NoticeRuleSource {
  id: string;
  pattern: string;
  action: string;
}

export function renderNoticeModule(rules: readonly NoticeRuleSource[]): string {
  const notice = rules.filter((rule) => rule.action === "notice");
  const lines = notice.map(
    (rule) => `  { id: ${JSON.stringify(rule.id)}, pattern: ${JSON.stringify(rule.pattern)} },`
  );
  return [
    "// GENERATED from content-rules.json by apps/web/scripts/generate-content-notice.ts.",
    "// Do not edit. After you change a rule, run: pnpm --filter web generate:content-notice",
    "//",
    "// The notice rules only (Jack, 2026-10-02). The arcade shows the heads-up",
    "// card when a player opens a title that one of these rules matches. The",
    "// block rules are not in this file: they stay out of the browser bundle.",
    "",
    "export const NOTICE_RULE_PATTERNS: readonly { id: string; pattern: string }[] = [",
    ...lines,
    "];",
    "",
  ].join("\n");
}
