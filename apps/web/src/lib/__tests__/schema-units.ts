/**
 * Test helper: the fields of a progress schema, read from the zod schema
 * itself, and a sample blob in the schema's shape.
 *
 * A "unit" is one entry of the direction table (progress-field-rules.ts):
 * a number, a true/false value, a text value, or a whole list. "*" stands
 * for any key of a record. A path in `subtrees` is one unit with all the
 * fields under it.
 */
import type { z } from "zod";

export type UnitKind =
  | "number"
  | "boolean"
  | "text"
  | "any"
  | "numberList"
  | "primitiveList"
  | "list"
  | "subtree";

export type Unit = { path: string; kind: UnitKind };

type Def = {
  type: string;
  innerType?: z.ZodType;
  out?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  valueType?: z.ZodType;
  element?: z.ZodType;
  options?: z.ZodType[];
  entries?: Record<string, string>;
  values?: unknown[];
};

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** The schema under optional/nullable/default/pipe wrappers. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    const def = defOf(current);
    if (def.innerType && ["optional", "nullable", "default", "readonly", "catch", "nonoptional", "prefault"].includes(def.type)) {
      current = def.innerType;
    } else if (def.type === "pipe" && def.out) {
      current = def.out;
    } else {
      return current;
    }
  }
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

function listKind(element: z.ZodType): UnitKind {
  const type = defOf(unwrap(element)).type;
  if (type === "number") return "numberList";
  if (type === "string" || type === "enum" || type === "literal") return "primitiveList";
  return "list";
}

/** Every unit of a schema. */
export function schemaUnits(schema: z.ZodType, subtrees: ReadonlySet<string> = new Set()): Unit[] {
  const out: Unit[] = [];
  const walk = (node: z.ZodType, path: string) => {
    if (subtrees.has(path)) {
      out.push({ path, kind: "subtree" });
      return;
    }
    const inner = unwrap(node);
    const def = defOf(inner);
    switch (def.type) {
      case "object":
        for (const [key, child] of Object.entries(def.shape ?? {})) walk(child, join(path, key));
        return;
      case "record":
        walk(def.valueType!, join(path, "*"));
        return;
      case "array":
        out.push({ path, kind: listKind(def.element!) });
        return;
      case "number":
        out.push({ path, kind: "number" });
        return;
      case "boolean":
        out.push({ path, kind: "boolean" });
        return;
      case "string":
      case "enum":
      case "literal":
        out.push({ path, kind: "text" });
        return;
      default:
        out.push({ path, kind: "any" });
    }
  };
  walk(schema, "");
  return out;
}

/**
 * A blob in the schema's shape: each number is 7, each flag true, each
 * text "x" (an enum takes its first value), each record has one key "k",
 * each list one item. It is a shape for a test, not a valid save.
 */
export function sampleBlob(schema: z.ZodType): unknown {
  const inner = unwrap(schema);
  const def = defOf(inner);
  switch (def.type) {
    case "object":
      return Object.fromEntries(Object.entries(def.shape ?? {}).map(([key, child]) => [key, sampleBlob(child)]));
    case "record":
      return { k: sampleBlob(def.valueType!) };
    case "array":
      return [sampleBlob(def.element!)];
    case "number":
      return 7;
    case "boolean":
      return true;
    case "enum":
      return Object.values(def.entries ?? {})[0] ?? "x";
    case "literal":
      return def.values?.[0] ?? "x";
    case "union":
      return sampleBlob(def.options![0]);
    case "string":
      return "x";
    default:
      return null;
  }
}

/** The unit that a concrete path (a record key in place of "*") falls in. */
export function unitOf(units: readonly Unit[], concrete: string): Unit | undefined {
  const parts = concrete.split(".");
  return units.find((unit) => {
    const segs = unit.path.split(".");
    if (unit.kind === "subtree" || unit.kind === "list" || unit.kind === "numberList" || unit.kind === "primitiveList") {
      // A read inside a list or a saved world falls in that unit.
      if (parts.length < segs.length) return false;
    } else if (segs.length !== parts.length) {
      return false;
    }
    return segs.every((seg, i) => seg === "*" || seg === parts[i]);
  });
}
