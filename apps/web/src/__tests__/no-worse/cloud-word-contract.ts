/**
 * Test-side Part C boundary. These reviewed fields are independent of the
 * production projector: removing any other field remains a B1 data loss.
 * Frozen legacy inputs and the hashed cross-version harness stay unchanged.
 */

type Progress = Record<string, unknown>;
const wordApps = new Set(["oregon-trail", "weather", "toy-finder", "drawing-app", "drum-machine", "virtual-pet", "four-wheeler-3d"]);
const object = (value: unknown): value is Progress => !!value && typeof value === "object" && !Array.isArray(value);

export function cloudComparable(app: string, input: Progress): Progress {
  if (!wordApps.has(app)) return input;
  const value = structuredClone(input);
  const blank = (node: unknown, key: string, replacement: unknown) => {
    if (object(node) && Object.hasOwn(node, key)) node[key] = replacement;
  };
  const remove = (node: unknown, key: string) => { if (object(node)) delete node[key]; };
  const each = (items: unknown, apply: (item: unknown) => void) => { if (Array.isArray(items)) items.forEach(apply); };
  switch (app) {
    case "oregon-trail": blank(value, "leaderName", ""); each(value.party, member => blank(member, "name", "")); break;
    case "weather": blank(value, "savedLocations", []); blank(value, "lastLocation", null); break;
    case "toy-finder": each(value.wishlistItems, item => remove(item, "notes")); break;
    case "drawing-app": remove(value, "savedArtworks"); break;
    case "drum-machine": each(value.savedBeats, item => blank(item, "name", "")); break;
    case "virtual-pet": blank(value.pet, "name", ""); blank(value.settings, "petName", ""); break;
    case "four-wheeler-3d":
      if (object(value.adventure)) {
        blank(value.adventure.outfit, "text", "");
        each(value.adventure.feeders, item => blank(item, "label", ""));
      }
      break;
  }
  return value;
}
