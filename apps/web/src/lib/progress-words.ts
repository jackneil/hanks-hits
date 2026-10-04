/**
 * Reviewed player-entered fields. Shared by the cloud handoff and, later,
 * device-only storage. This is a preservation contract, not a legal claim.
 */
export const WORD_EXTRACTION_VERSION = 1;

type ObjectValue = Record<string, unknown>;
type Field = { path: string; blank: unknown; remove?: boolean };

export const PROGRESS_WORD_FIELDS: Readonly<Record<string, readonly Field[]>> = {
  "oregon-trail": [{ path: "leaderName", blank: "" }, { path: "party[].name", blank: "" }],
  weather: [{ path: "savedLocations", blank: [] }, { path: "lastLocation", blank: null }],
  "toy-finder": [{ path: "wishlistItems[].notes", blank: undefined, remove: true }],
  "drawing-app": [{ path: "savedArtworks", blank: undefined, remove: true }],
  "drum-machine": [{ path: "savedBeats[].name", blank: "" }],
  "virtual-pet": [{ path: "pet.name", blank: "" }, { path: "settings.petName", blank: "" }],
  "four-wheeler-3d": [{ path: "adventure.outfit.text", blank: "" }, { path: "adventure.feeders[].label", blank: "" }],
};

export type WordField = {
  path: string;
  value: unknown;
  /** Existing identity only. A missing journey ID remains an unmatched candidate. */
  identity: Record<string, string | number>;
};
export type ProgressWords = { fields: WordField[] };

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function visit(
  node: unknown, parts: string[], path: string,
  callback: (parent: ObjectValue, key: string, path: string, identity: WordField["identity"]) => void,
  identity: WordField["identity"] = {},
): void {
  if (!object(node)) return;
  const [part, ...rest] = parts;
  if (!rest.length) {
    if (Object.hasOwn(node, part)) callback(node, part, path + part, identity);
    return;
  }
  if (part.endsWith("[]")) {
    const key = part.slice(0, -2), list = node[key];
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      const entity = { ...identity, index };
      if (object(item)) for (const id of ["id", "toyId"]) {
        if (typeof item[id] === "string") Object.assign(entity, { [id]: item[id] });
      }
      visit(item, rest, `${path}${key}[${index}].`, callback, entity);
    });
  } else visit(node[part], rest, `${path}${part}.`, callback, identity);
}

/** Never mutates the save or derives identity from similar gameplay settings. */
export function extractProgressWords(appId: string, data: unknown): ProgressWords {
  const fields: WordField[] = [];
  const identity: WordField["identity"] = {};
  if (object(data)) {
    if (appId === "oregon-trail" && typeof data.journeyId === "string") identity.journeyId = data.journeyId;
    if (appId === "virtual-pet" && object(data.pet)) {
      for (const key of ["speciesId", "bornAt"]) if (typeof data.pet[key] === "string") identity[key] = data.pet[key];
    }
  }
  for (const field of PROGRESS_WORD_FIELDS[appId] ?? []) {
    visit(data, field.path.split("."), "", (parent, key, path, entity) => {
      const value = parent[key];
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return;
      fields.push({ path, value: structuredClone(value), identity: { ...entity } });
    }, identity);
  }
  return { fields };
}

/** Schema-compatible blanks keep all non-word gameplay fields unchanged. */
export function stripProgressWords<T>(appId: string, data: T): T {
  const fields = PROGRESS_WORD_FIELDS[appId];
  if (!fields || !object(data)) return data;
  const result = structuredClone(data);
  for (const field of fields) {
    visit(result, field.path.split("."), "", (parent, key) => {
      if (field.remove) delete parent[key];
      else parent[key] = structuredClone(field.blank);
    });
  }
  return result;
}

/**
 * Local/cloud projection for immutable store values. Compare the complete input
 * before walking word fields, and copy only ancestors of a changed field. A new
 * getProgress wrapper around unchanged fields retains the previous projection.
 */
export function createWordProjection<T>(appId: string): (progress: T) => T {
  const fields = PROGRESS_WORD_FIELDS[appId];
  if (!fields?.length) return progress => progress;
  const projectors = fields.map(field => {
    const parts = field.path.split(".");
    const caches = parts.map(() => new WeakMap<object, unknown>());
    const listCaches = parts.map(() => new WeakMap<object, unknown[]>());
    const visitField = (value: unknown, depth: number): unknown => {
      if (!object(value)) return value;
      const cache = caches[depth];
      if (cache.has(value)) return cache.get(value);
      const part = parts[depth];
      let result: ObjectValue = value;
      if (depth === parts.length - 1) {
        if (Object.hasOwn(value, part)) {
          const before = value[part];
          const alreadyBlank = Object.is(before, field.blank)
            || Array.isArray(before) && !before.length && Array.isArray(field.blank) && !field.blank.length;
          if (field.remove || !alreadyBlank) {
            result = { ...value };
            if (field.remove) delete result[part];
            else result[part] = Array.isArray(field.blank) ? [] : field.blank;
          }
        }
      } else if (part.endsWith("[]")) {
        const key = part.slice(0, -2), list = value[key];
        if (Array.isArray(list)) {
          let next = listCaches[depth].get(list);
          if (!next) {
            next = list.map(item => visitField(item, depth + 1));
            if (next.every((item, index) => item === list[index])) next = list;
            listCaches[depth].set(list, next);
          }
          if (next.some((item, index) => item !== list[index])) result = { ...value, [key]: next };
        }
      } else {
        const next = visitField(value[part], depth + 1);
        if (next !== value[part]) result = { ...value, [part]: next };
      }
      cache.set(value, result);
      return result;
    };
    return (value: unknown) => visitField(value, 0);
  });
  let previousFields: ObjectValue | null = null;
  let previousOutput: T;
  const sameFields = (left: ObjectValue, right: ObjectValue) => {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
      && keys.every(key => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
  };
  return progress => {
    if (!object(progress)) return progress;
    if (previousFields && sameFields(previousFields, progress)) return previousOutput;
    let result: unknown = progress;
    for (const project of projectors) result = project(result);
    previousFields = { ...progress };
    if (object(previousOutput) && object(result) && sameFields(previousOutput, result)) return previousOutput;
    previousOutput = result as T;
    return previousOutput;
  };
}
