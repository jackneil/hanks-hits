import { lostValues } from "./harness";
import { cloudComparable } from "./cloud-word-contract";
export { cloudComparable } from "./cloud-word-contract";
type Progress = Record<string, unknown>;
const wordApps = new Set(["oregon-trail", "weather", "toy-finder", "drawing-app", "drum-machine", "virtual-pet", "four-wheeler-3d"]);

/** Map one original oracle leaf without discarding its remaining list fields. */
function comparableLeaf(app: string, id: string, defaults: Progress): string | null {
  if (!wordApps.has(app)) return id;
  const colon = id.indexOf(":"), equals = id.indexOf("=", colon);
  const source = id.slice(0, colon), path = id.slice(colon + 1, equals);
  let value: unknown;
  try { value = JSON.parse(id.slice(equals + 1)); }
  catch { return id; } // The oracle's scalar <time> sentinel is not JSON.
  for (const part of path.split(".").reverse()) {
    value = part.endsWith("[]") ? { [part.slice(0, -2)]: [value] } : { [part]: value };
  }
  return lostValues(app, { [source]: cloudComparable(app, value as Progress) }, null, cloudComparable(app, defaults))[0] ?? null;
}


/**
 * A rename-only default pet stays on this device; its automatically created
 * birth anchor travels to the account only once there is gameplay to upload.
 * This independently bounded check ignores no needs, stats, wallets or lists.
 */
function deviceOnlyBirth(id: string, sources: Record<string, Progress>, defaults: Progress): boolean {
  const colon = id.indexOf(":");
  if (!id.slice(colon + 1).startsWith("pet.bornAt=")) return false;
  const source = sources[id.slice(0, colon)];
  const pet = source?.pet as Record<string, unknown> | undefined;
  const defaultPet = defaults.pet as Record<string, unknown> | undefined;
  const settings = source?.settings as Record<string, unknown> | undefined;
  const defaultSettings = defaults.settings as Record<string, unknown> | undefined;
  if (!pet || !defaultPet || (pet.name === defaultPet.name && settings?.petName === defaultSettings?.petName)) return false;
  const withoutAutomaticTimes = (input: Progress) => {
    const result = cloudComparable("virtual-pet", input);
    delete result.lastModified;
    if (result.pet && typeof result.pet === "object") {
      delete (result.pet as Record<string, unknown>).bornAt;
      delete (result.pet as Record<string, unknown>).lastChecked;
    }
    return result;
  };
  // Key ordering in frozen JSON is immaterial; every remaining leaf must match.
  const expected = withoutAutomaticTimes(defaults), actual = withoutAutomaticTimes(source);
  const equal = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  };
  return equal(actual, expected);
}

/** Personal words move to durable device records/candidates, proven separately. */
export function remainingCloudLosses(app: string, original: readonly string[], debug: {
  sources: Record<string, Progress>; final: Progress | null;
}, defaults: Progress, older: readonly Progress[] = []): string[] {
  if (!wordApps.has(app)) return [...original];
  const projected = new Set(lostValues(app,
    Object.fromEntries(Object.entries(debug.sources).map(([key, value]) => [key, cloudComparable(app, value)])),
    debug.final ? cloudComparable(app, debug.final) : null,
    cloudComparable(app, defaults), older.map(value => cloudComparable(app, value))));
  return original.filter(id => {
    if (app === "virtual-pet" && deviceOnlyBirth(id, debug.sources, defaults)) return false;
    const comparable = comparableLeaf(app, id, defaults);
    return comparable !== null && projected.has(comparable);
  });
}

/** Keep the exact approved original IDs for every field still cloud-owned. */
export function cloudApprovedLosses(app: string, original: readonly string[], defaults: Progress): string[] {
  return original.filter(id => comparableLeaf(app, id, defaults) !== null);
}
