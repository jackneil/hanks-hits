/**
 * Build the largest save that a progress schema accepts, from the schema
 * itself (Zod 4 definitions), for the test "the largest valid save of every
 * game passes" (route.test.ts).
 *
 * Every bounded field is at its largest:
 * - a string at its maximum length;
 * - an array at its maximum length, of the largest element;
 * - a record with the most keys that its checks accept (found by asking
 *   the schema), each key at its maximum length;
 * - a number with the longest JSON text that the schema accepts;
 * - an optional or nullable field present and not null;
 * - an enum, a literal or a union at its largest option.
 *
 * Characters: a field that a player types or a game writes as text is
 * filled with "€" (3 bytes in UTF-8, the most that a typed character takes
 * per UTF-16 unit). The fields in `asciiPaths` hold machine text (a
 * drawing's data URL is base64), so they are filled with "A" (1 byte).
 *
 * A field with no bound in the schema (z.any(), a string with no maximum and
 * no pattern, an array with no maximum, a record whose checks accept any
 * number of keys) is listed in `unbounded`, so the test names it.
 *
 * `measure` decides which choice is the largest (a union option, an enum
 * value, a number). By default it is the length of the JSON text (the
 * largest body in bytes). The test also builds the save with the most JSON
 * values: it gives a measure that counts the JSON marks.
 */
import type { z } from "zod";

type Node = {
  _zod: {
    def: {
      type: string;
      innerType?: Node;
      shape?: Record<string, Node>;
      element?: Node;
      keyType?: Node;
      valueType?: Node;
      options?: Node[];
      entries?: Record<string, unknown>;
      values?: unknown[];
      in?: Node;
      out?: Node;
    };
    bag: { maximum?: number; minimum?: number; format?: string; patterns?: Set<RegExp> };
  };
  safeParse(value: unknown): { success: boolean };
};

export interface LargestSave {
  value: unknown;
  /** The paths of fields that the schema does not bound (for example "currentEvent (z.any)"). */
  unbounded: string[];
}

/** Samples for strings that only a pattern bounds, by the pattern's source. */
const PATTERN_SAMPLES: Record<string, string> = {
  "^#[0-9a-fA-F]{6}$": "#ABCDEF",
};

/** The most keys that the search tries before it calls a record unbounded. */
const RECORD_KEY_CEILING = 1 << 16;

const TEXT_CHAR = "€"; // € : 3 bytes in UTF-8
const ASCII_CHAR = "A";

const jsonLength = (value: unknown) => JSON.stringify(value)?.length ?? 0;

export function largestSave(
  schema: z.ZodType,
  asciiPaths: string[] = [],
  measure: (value: unknown) => number = jsonLength
): LargestSave {
  const unbounded: string[] = [];
  const ascii = new Set(asciiPaths);

  const build = (node: Node, path: string[]): unknown => {
    const def = node._zod.def;
    const bag = node._zod.bag;
    const at = path.join(".") || "(root)";
    switch (def.type) {
      case "optional":
      case "nullable":
      case "default":
      case "prefault":
      case "readonly":
      case "nonoptional":
      case "catch": {
        const inner = def.innerType!;
        if (def.type === "nullable" && ["any", "unknown"].includes(inner._zod.def.type)) {
          unbounded.push(`${at} (z.${inner._zod.def.type})`);
          return null;
        }
        return build(inner, path);
      }
      case "pipe":
        // z.preprocess(fn, schema) is a pipe from a transform (any input) to the schema.
        return build(def.in!._zod.def.type === "transform" ? def.out! : def.in!, path);
      case "any":
      case "unknown":
        unbounded.push(`${at} (z.${def.type})`);
        return null;
      case "null":
        return null;
      case "boolean":
        return false;
      case "object": {
        const value: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(def.shape!)) {
          const built = build(child, [...path, key]);
          if (built !== undefined) value[key] = built;
        }
        return value;
      }
      case "string": {
        if (bag.patterns && bag.patterns.size > 0) {
          const sources = [...bag.patterns].map((pattern) => pattern.source);
          const sample = sources.map((source) => PATTERN_SAMPLES[source]).find((s) => s !== undefined);
          if (sample === undefined) throw new Error(`largestSave: add a sample for the pattern ${sources.join(", ")} at ${at}`);
          return sample;
        }
        if (bag.maximum === undefined) {
          unbounded.push(`${at} (a string with no maximum)`);
          return "";
        }
        return (ascii.has(at) ? ASCII_CHAR : TEXT_CHAR).repeat(bag.maximum);
      }
      case "number": {
        const lo = bag.minimum ?? -Number.MAX_VALUE;
        const hi = bag.maximum ?? Number.MAX_VALUE;
        const isInt = bag.format === "safeint" || bag.format === "int32" || bag.format === "uint32";
        const candidates = isInt
          ? [hi, lo, Math.max(lo, Math.min(hi, Number.MIN_SAFE_INTEGER)), Math.max(lo, Math.min(hi, -1))]
          : [hi, lo, hi - (hi - lo) / 3, lo + (hi - lo) / 7, -Number.MAX_VALUE, Number.MAX_VALUE, Date.now() + 1 / 3, -(1 / 3), 1 / 3];
        const accepted = candidates.filter((n) => Number.isFinite(n) && node.safeParse(n).success);
        if (accepted.length === 0) throw new Error(`largestSave: no number candidate passes at ${at}`);
        return accepted.reduce((best, n) => (measure(n) > measure(best) ? n : best));
      }
      case "enum": {
        const options = Object.values(def.entries!);
        return options.reduce((best, option) => (measure(option) > measure(best) ? option : best));
      }
      case "literal":
        return def.values!.reduce((best, option) => (measure(option) > measure(best) ? option : best));
      case "union": {
        const options = def.options!.map((option) => build(option, path)).filter((value) => node.safeParse(value).success);
        if (options.length === 0) throw new Error(`largestSave: no union option passes at ${at}`);
        return options.reduce((best, option) => (measure(option) > measure(best) ? option : best));
      }
      case "array": {
        if (bag.maximum === undefined) {
          unbounded.push(`${at} (an array with no maximum)`);
          return [];
        }
        const element = build(def.element!, [...path, "*"]);
        // One element, many times: the JSON is the same as of separate copies, and the
        // test does not hold 20 copies of a drawing.
        return Array.from({ length: bag.maximum }, () => element);
      }
      case "record": {
        const keyType = def.keyType!;
        const element = build(def.valueType!, [...path, "*"]);
        const keyDef = keyType._zod.def;
        let keys: string[];
        if (keyDef.type === "enum") {
          keys = Object.values(keyDef.entries!).map(String);
        } else {
          const keyLength = keyType._zod.bag.maximum;
          if (keyLength === undefined) throw new Error(`largestSave: a record key with no maximum at ${at}`);
          const keyAt = (i: number) => {
            const suffix = String(i);
            return TEXT_CHAR.repeat(Math.max(0, keyLength - suffix.length)) + suffix;
          };
          const recordOf = (count: number) =>
            Object.fromEntries(Array.from({ length: count }, (_, i) => [keyAt(i), element]));
          // The checks of a record (a refine on the key count) are not in its bag: ask the schema.
          let pass = 0;
          let fail = 1;
          while (fail <= RECORD_KEY_CEILING && node.safeParse(recordOf(fail)).success) {
            pass = fail;
            fail *= 2;
          }
          if (fail > RECORD_KEY_CEILING) {
            unbounded.push(`${at} (a record with no key limit)`);
            return {};
          }
          while (fail - pass > 1) {
            const mid = Math.floor((pass + fail) / 2);
            if (node.safeParse(recordOf(mid)).success) pass = mid;
            else fail = mid;
          }
          keys = Array.from({ length: pass }, (_, i) => keyAt(i));
        }
        return Object.fromEntries(keys.map((key) => [key, element]));
      }
      default:
        throw new Error(`largestSave: the schema type "${def.type}" at ${at} is not handled; teach largestSave.ts about it`);
    }
  };

  const value = build(schema as unknown as Node, []);
  return { value, unbounded };
}
