/**
 * Untouched progress: progress that holds nothing that a player made.
 *
 * Each synced store defines its rule here (defineUntouchedProgress): the
 * default progress (as getProgress() returns it), the fields that change
 * with no player choice, and how its save holds the progress. Four parts of
 * the sync use the rule:
 *
 * 1. The persist `merge` of each store (settleOnLoad). A save that the code
 *    before the sync-time fix wrote can carry a time that is not a player's
 *    change: most stores put Date.now() into their default progress when the
 *    page loaded, and Hill Climb, Monster Truck and Oregon Trail saved no
 *    time at all (their getProgress() returned Date.now()). Such a save
 *    looked newer than the account and replaced the account's progress at
 *    sign-in. legacyTime() gives the save its real time:
 *    - untouched progress: 0, so it loses to the account;
 *    - progress with a numeric time: that time;
 *    - progress with no time that a player changed: Date.now(). The code
 *      before this change sent such a save as new on every sync, so the
 *      device keeps what it holds beyond the account.
 *    A save of the new code carries PROGRESS_TIME_MARKER (markSaved), and
 *    settleOnLoad leaves it as it is. The persist version does not change:
 *    the code before this change (a rollback, or a tab that still runs it)
 *    loads a new save, because it ignores the unknown marker key.
 *
 * 2. useAuthSync, at the first sync. The account can hold untouched
 *    progress with a new time: the code before this change uploaded the
 *    untouched defaults of a page with the page-load time (also a tab that
 *    still runs that code, or a rollback to it). isLegacyUntouchedRow()
 *    finds such a row, and the device's progress replaces it (foldProgress
 *    keeps the row's records). The new code never uploads progress that is
 *    untouched by the rule (useAuthSync), so every untouched row is a row of
 *    the old code, whatever its time.
 *
 * 3. useAuthSync, when it takes the account's progress over an untouched
 *    device: foldProgress keeps what time alone earned on the device (the
 *    pet species that daily visits unlock, the longest visit streak).
 *
 * 4. useAuthSync, when the device's progress was built on the defaults (a
 *    guest's play, a blank device) and the account holds real progress:
 *    foldGuestProgress keeps the account's progress, the device's records,
 *    and the items that the player made on the device (`lists`: a beat, a
 *    drawing, a wish).
 *
 * `ignore` lists the fields that change with no player choice (time passing,
 * a page load), and the settings whose setter did not stamp the time before
 * this change. A key in `ignore` is skipped at any depth of the progress.
 * `within` lists counters that one page load changes by itself (the first
 * joke of a page): the progress stays untouched while each one passes its
 * test. A key that the progress does not hold counts as its default (a row
 * of an older version that never held the field).
 */
import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { mergeProgress } from "@/lib/progress-merge";
import { sameProgress } from "./progressStamp";

export type ProgressTimeKey = "lastModified" | "updatedAt";

/**
 * The key that marks a save of the new code (its time is a player's time).
 * It sits at the top level of the saved state, beside the progress, and
 * never goes to the server.
 */
export const PROGRESS_TIME_MARKER = "progressTimeV";
export const PROGRESS_TIME_VERSION = 1;

/**
 * A save of the new code can carry a sum of its progress (markSavedWithSum),
 * for a store whose code before the sync-time fix keeps keys that it does not
 * know (Oregon Trail saves its whole state). That code, after a rollback,
 * keeps the marker and the time of the new code while the kid plays on, so
 * the time alone is not true. A sum that does not match the progress tells
 * such a save: settleSave() gives it the old rule's time.
 */
export const PROGRESS_SUM_KEY = "progressTimeSum";

type Saved = Record<string, unknown>;
type Fold = (base: Record<string, unknown>, other: Record<string, unknown>) => Record<string, unknown>;

export interface UntouchedProgressRule {
  readonly appId: ValidAppId;
  readonly timeKey: ProgressTimeKey;
  readonly layout: "nested" | "flat";
  /** True when the progress holds nothing that a player made. */
  isUntouched: (progress: unknown) => boolean;
  /** The time for progress from a save of the code before this change. */
  legacyTime: (progress: unknown) => number;
  /** The progress as getProgress() returns it, from a saved state (without the marker). */
  progressOf: (saved: Saved) => unknown;
  /**
   * Folds what time alone earned in `other` into `base`, for nested fields
   * that the server's merge does not reach. Returns `base` when nothing
   * changes.
   */
  foldNested: Fold;
  /** The time key and the `ignore` fields: what a sum of the progress skips (any depth). */
  readonly ignore: readonly string[];
  /** See Spec.lists. */
  readonly lists: Readonly<Record<string, ListSpec>>;
}

/**
 * A list of items that a player makes (a beat, a drawing, a wish). `id`
 * names the key that tells two items apart (a function for an item with no
 * id key; none for a list of strings or numbers). `max` is the length that
 * the server's schema allows.
 */
export type ListSpec = { readonly id?: string | ((item: unknown) => string); readonly max: number };

type Spec = {
  /** The default progress, as getProgress() returns it. Its time is not compared. */
  defaults: object;
  timeKey?: ProgressTimeKey;
  /** Fields that change with no player choice (see the module comment). */
  ignore?: readonly string[];
  /** Counters that a page load changes by itself, with the values that one load can reach. */
  within?: Readonly<Record<string, (value: unknown) => boolean>>;
  /**
   * How the save holds the progress: "nested" (under `progress`, the
   * default) or "flat" (the progress fields at the top level).
   */
  layout?: "nested" | "flat";
  /**
   * The progress as getProgress() builds it from the saved state, for a
   * store whose getProgress() adds fields from outside `progress` (Chess:
   * the difficulty, the mode and the color) or whose save holds more than
   * the progress (Oregon Trail). It must keep the time key.
   */
  progressOf?: (saved: Saved) => unknown;
  /** See UntouchedProgressRule.foldNested (Virtual Pet: the visit streak). */
  foldNested?: Fold;
  /**
   * Top-level lists of the progress whose items a player makes. When the
   * device's progress was built on the defaults, foldGuestProgress adds the
   * device's items to the account's list (useAuthSync).
   */
  lists?: Readonly<Record<string, ListSpec>>;
};

const rules = new Map<string, UntouchedProgressRule>();

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `progress` with every key that it does not hold taken from `defaults`, at
 * every depth of plain objects (an array is a value: it is not filled).
 */
function fillFromDefaults(progress: unknown, defaults: unknown): unknown {
  if (!isRecord(progress) || !isRecord(defaults)) return progress;
  const out: Record<string, unknown> = { ...progress };
  for (const [key, fallback] of Object.entries(defaults)) {
    out[key] = out[key] === undefined ? fallback : fillFromDefaults(out[key], fallback);
  }
  return out;
}

/** Deep equality, with `ignore` keys skipped and `within` keys tested by their own rule (any depth). */
function untouchedBy(
  progress: unknown,
  defaults: unknown,
  ignore: readonly string[],
  within: Readonly<Record<string, (value: unknown) => boolean>>
): boolean {
  if (!isRecord(progress) || !isRecord(defaults)) return sameProgress(progress, defaults, ignore);
  const keys = new Set([...Object.keys(progress), ...Object.keys(defaults)]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const test = within[key];
    if (test) {
      if (!test(progress[key])) return false;
      continue;
    }
    if (!untouchedBy(progress[key], defaults[key], ignore, within)) return false;
  }
  return true;
}

/** The saved state without the marker (and its sum). */
export function withoutMarker(saved: Saved): Saved {
  if (!(PROGRESS_TIME_MARKER in saved) && !(PROGRESS_SUM_KEY in saved)) return saved;
  const rest = { ...saved };
  delete rest[PROGRESS_TIME_MARKER];
  delete rest[PROGRESS_SUM_KEY];
  return rest;
}

export function defineUntouchedProgress(appId: ValidAppId, spec: Spec): UntouchedProgressRule {
  const timeKey = spec.timeKey ?? "lastModified";
  const ignore = [timeKey, ...(spec.ignore ?? [])];
  const within = spec.within ?? {};
  const layout = spec.layout ?? "nested";
  const isUntouched = (progress: unknown) =>
    isRecord(progress) && untouchedBy(fillFromDefaults(progress, spec.defaults), spec.defaults, ignore, within);
  const rule: UntouchedProgressRule = {
    appId,
    timeKey,
    layout,
    isUntouched,
    legacyTime(progress) {
      if (!isRecord(progress) || isUntouched(progress)) return 0;
      const time = progress[timeKey];
      return typeof time === "number" ? time : Date.now();
    },
    progressOf: spec.progressOf ?? (layout === "flat" ? (saved) => saved : (saved) => saved.progress),
    foldNested: spec.foldNested ?? ((base) => base),
    ignore,
    lists: spec.lists ?? {},
  };
  rules.set(appId, rule);
  return rule;
}

/**
 * True when the store of `appId` holds a rule and the progress is untouched
 * by it. A page loads its store before useAuthSync runs, so the rule of the
 * page's store is here. Unknown app: false.
 */
export function isUntouchedProgress(appId: string, progress: unknown): boolean {
  return rules.get(appId)?.isUntouched(progress) ?? false;
}

/**
 * True when an account row is untouched progress that the code before the
 * sync-time fix uploaded (untouched by the store's rule). The new code never
 * uploads untouched progress (useAuthSync), so the row's time does not
 * matter: the old code wrote it with a page-load time, also after the deploy
 * (a tab that still runs it, a rollback) and from a device whose clock is
 * wrong.
 */
export function isLegacyUntouchedRow(appId: string, row: unknown): boolean {
  const rule = rules.get(appId);
  return !!rule && isRecord(row) && rule.isUntouched(row);
}

/**
 * `base` with the records of `other` folded in: first the server's merge
 * rules for the top level (a counter that only grows keeps the larger value,
 * an unlocked list keeps every item, lib/progress-merge.ts), then the
 * store's nested fold. `base` keeps its own fields and its own time.
 */
export function foldProgress<T extends AppProgressData>(appId: string, base: T, other: AppProgressData): T {
  const rule = rules.get(appId);
  const timeKey = rule?.timeKey ?? "lastModified";
  // mergeProgress: the side with the larger time is the base.
  const merged = mergeProgress(base, other, Number.MAX_SAFE_INTEGER, 0).data as Record<string, unknown>;
  const out = { ...(rule ? rule.foldNested(merged, other) : merged) };
  if (base[timeKey] === undefined) delete out[timeKey];
  else out[timeKey] = base[timeKey];
  return out as T;
}

/** The key of a list item (see ListSpec). */
function itemKey(item: unknown, id: ListSpec["id"]): string {
  if (typeof id === "function") return id(item);
  if (id === undefined) return JSON.stringify(item);
  return isRecord(item) ? JSON.stringify(item[id]) : JSON.stringify(item);
}

/**
 * The account's progress with the device's records folded in, for a device
 * whose progress was built on the defaults (a guest's play, a blank device):
 * foldProgress(account, device), and each list of the rule (`lists`) keeps
 * the account's items and adds the device's items that the account does not
 * hold, up to the length that the server's schema allows. The account's
 * progress stays the base: the device's own non-record fields (a wallet, a
 * journey) do not replace it. The time is the account's.
 */
export function foldGuestProgress<T extends AppProgressData>(appId: string, account: T, device: AppProgressData): T {
  const out = foldProgress(appId, account, device) as Record<string, unknown>;
  const rule = rules.get(appId);
  if (!rule) return out as T;
  for (const [field, list] of Object.entries(rule.lists)) {
    const mine = out[field];
    const theirs = device[field];
    if (!Array.isArray(theirs) || theirs.length === 0) continue;
    const base = Array.isArray(mine) ? mine : [];
    const seen = new Set(base.map((item) => itemKey(item, list.id)));
    const added = theirs.filter((item) => {
      const key = itemKey(item, list.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (added.length === 0) continue;
    out[field] = [...base, ...added].slice(0, Math.max(list.max, base.length));
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Saves: the marker, and the settle step on load
// ---------------------------------------------------------------------------

/** persist `partialize`: the saved state, marked as a save of the new code. */
export function markSaved<T extends object>(saved: T): T {
  return { ...saved, [PROGRESS_TIME_MARKER]: PROGRESS_TIME_VERSION };
}

/** JSON with sorted keys, and without the keys in `skip` (any depth). */
function stableJson(value: unknown, skip: readonly string[]): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, skip)).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined && typeof value[key] !== "function" && !skip.includes(key))
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key], skip)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A sum of the progress in a saved state (FNV-1a of its JSON), without the
 * time and the `ignore` fields: a change that the old code makes to them
 * (a phase, a setting) does not count.
 */
export function progressSum(rule: UntouchedProgressRule, saved: Saved): string {
  const text = stableJson(rule.progressOf(withoutMarker(saved)), rule.ignore);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * persist `partialize` for a store whose code before the sync-time fix keeps
 * keys that it does not know (Oregon Trail): markSaved, and the sum of the
 * progress (PROGRESS_SUM_KEY).
 */
export function markSavedWithSum<T extends object>(rule: UntouchedProgressRule, saved: T): T {
  return { ...markSaved(saved), [PROGRESS_SUM_KEY]: progressSum(rule, saved as Saved) };
}

/** True when a saved state is a save of the new code. */
export function isMarkedSave(saved: unknown): boolean {
  return isRecord(saved) && saved[PROGRESS_TIME_MARKER] === PROGRESS_TIME_VERSION;
}

/**
 * True when a marked save carries a sum that its progress does not match:
 * the code before the sync-time fix changed the progress after the new code
 * saved it (a rollback), and kept the new code's time as it was.
 */
function changedByOldCode(saved: Saved, rule: UntouchedProgressRule): boolean {
  return PROGRESS_SUM_KEY in saved && saved[PROGRESS_SUM_KEY] !== progressSum(rule, saved);
}

/** True when the store loads `saved` with a time that it must write back once (persistSettledSave). */
function settlesOnLoad(saved: unknown, rule: UntouchedProgressRule): boolean {
  return isRecord(saved) && (!isMarkedSave(saved) || changedByOldCode(saved, rule));
}

/** The saved state with `time` as the time of its progress. */
function withTime(saved: Saved, rule: UntouchedProgressRule, time: number): Saved {
  if (rule.layout === "flat") return { ...saved, [rule.timeKey]: time };
  if (!isRecord(saved.progress)) return saved;
  return { ...saved, progress: { ...saved.progress, [rule.timeKey]: time } };
}

/**
 * The saved state with the real time of its progress. A save of the new
 * code keeps its time (the marker goes); an older save gets legacyTime(). A
 * marked save that the old code changed (changedByOldCode) gets the old
 * rule's time: 0 when it is untouched, else Date.now(), as for a save of
 * that code with no time.
 */
export function settleSave(saved: unknown, rule: UntouchedProgressRule): unknown {
  if (!isRecord(saved)) return saved;
  if (isMarkedSave(saved)) {
    const rest = withoutMarker(saved);
    if (!changedByOldCode(saved, rule)) return rest;
    return withTime(rest, rule, rule.isUntouched(rule.progressOf(rest)) ? 0 : Date.now());
  }
  return withTime(saved, rule, rule.legacyTime(rule.progressOf(saved)));
}

type SettledStore = {
  setState: (partial: object) => void;
  persist?: {
    getOptions: () => { name?: string };
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
  };
};

/**
 * Writes the save back once, after a load that settled it to a new time
 * (settleOnLoad). The persist middleware writes after a load only when it
 * migrated the save, and Date.now() for a save with no time changes at each
 * load: without the write, every load of a page that changes nothing made
 * the device's old progress newer again. Call it once, after create(), in a
 * store whose old saves can have no time (Hill Climb, Monster Truck, Oregon
 * Trail), or whose old code keeps unknown keys (markSavedWithSum).
 */
export function persistSettledSave(store: SettledStore, rule: UntouchedProgressRule): void {
  const api = store.persist;
  if (!api) return; // No storage (the server): nothing was loaded.
  const write = () => {
    try {
      const name = api.getOptions().name;
      const raw = name ? localStorage.getItem(name) : null;
      if (raw === null) return;
      const parsed = JSON.parse(raw) as unknown;
      if (settlesOnLoad(isRecord(parsed) ? parsed.state : null, rule)) store.setState({});
    } catch {
      // Storage that cannot be read, or a save that is not JSON: nothing to write.
    }
  };
  api.onFinishHydration(write);
  if (api.hasHydrated()) write();
}

const shallowMerge = <S,>(persisted: unknown, current: S): S => ({ ...current, ...(persisted as object) });

/**
 * persist `merge`: settles the save (settleSave), then runs the store's own
 * merge (default: the shallow merge of the persist middleware).
 */
export function settleOnLoad<S>(
  rule: UntouchedProgressRule,
  merge: (persisted: unknown, current: S) => S = shallowMerge
): (persisted: unknown, current: S) => S {
  return (persisted, current) => merge(settleSave(persisted, rule), current);
}

/**
 * The progress (as getProgress() returns it) in the saved `state` of a
 * localStorage save of `appId`, with its real time. Null for an app with no
 * rule, or a save with no progress.
 */
export function progressFromSave(appId: string, saved: unknown): Record<string, unknown> | null {
  const rule = rules.get(appId);
  if (!rule || !isRecord(saved)) return null;
  const settled = settleSave(saved, rule);
  if (!isRecord(settled)) return null;
  const progress = rule.progressOf(settled);
  return isRecord(progress) ? progress : null;
}

/** The time key of the progress of `appId`. */
export function progressTimeKey(appId: string): ProgressTimeKey {
  return rules.get(appId)?.timeKey ?? "lastModified";
}
