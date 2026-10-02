/**
 * True when the typed words are the gamer name. "Delete this account" asks
 * a grown-up to type the gamer name (app/api/account/route.ts). Spaces at
 * the ends and capital letters do not count, so the check stops a stray
 * tap but does not catch a grown-up out on a typing detail. The profile
 * page and the API use this same rule.
 */
export function matchesGamerName(typed: unknown, handle: string | null | undefined): boolean {
  if (typeof typed !== "string" || !handle) return false;
  return typed.trim().toLowerCase() === handle.trim().toLowerCase();
}
