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
