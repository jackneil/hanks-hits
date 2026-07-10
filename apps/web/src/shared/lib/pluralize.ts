// Tiny pluralization helpers shared across the app.
// Keeps copy grammatical so we never show "1 players" or "1 Achievements".

/**
 * Return just the noun, correctly pluralized for `count`.
 * Use when the count is formatted separately (e.g. `.toLocaleString()`):
 *   `${total.toLocaleString()} ${plural(total, "player")}`
 *
 * plural(1, "player")            => "player"
 * plural(3, "player")            => "players"
 * plural(1, "child", "children") => "child"
 * plural(2, "child", "children") => "children"
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : pluralForm ?? `${singular}s`;
}

/**
 * Return `count` followed by the correctly pluralized noun.
 * pluralize(1, "player") => "1 player"
 * pluralize(3, "player") => "3 players"
 */
export function pluralize(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}
