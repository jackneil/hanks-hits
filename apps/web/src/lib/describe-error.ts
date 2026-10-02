/**
 * Describe a thrown error for a server log, without the values it carries.
 *
 * Do not log a raw error from a database call. drizzle wraps each driver
 * error in a DrizzleQueryError, and its message is the SQL text plus every
 * query parameter: user ids, emails, password hashes, and whole progress
 * blobs with the names that kids type. The driver message can hold a value
 * too (for example `invalid input syntax for type bigint: "4189.29"`), and a
 * request.json() SyntaxError quotes part of the request body.
 *
 * This function keeps only the parts that identify the fault:
 * - the class names of the error and of its cause (the driver error);
 * - the Postgres SQLSTATE and the schema object names that the driver
 *   attaches (table, column, constraint, data type, routine);
 * - the top stack frames, without the message lines.
 * It never copies a message, a detail, a hint, or a query parameter.
 */
export type ErrorDescription = {
  error: string;
  cause?: string;
  code?: string;
  table?: string;
  column?: string;
  constraint?: string;
  dataType?: string;
  routine?: string;
  at?: string[];
};

/** Driver fields that hold the names of schema objects, never row values. */
const NAME_FIELDS = [
  "table",
  "column",
  "constraint",
  "dataType",
  "routine",
] as const;

const MAX_FRAMES = 5;
const MAX_CHAIN = 5;

function kindOf(value: unknown): string {
  if (value instanceof Error) return value.constructor?.name || value.name;
  return value === null ? "null" : typeof value;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

/** Stack frame lines only: a message can span lines, so filter, not slice. */
function framesOf(value: unknown): string[] | undefined {
  const stack = value instanceof Error ? value.stack : undefined;
  if (typeof stack !== "string") return undefined;
  const frames = stack
    .split("\n")
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => line.trim());
  return frames.length > 0 ? frames : undefined;
}

export function describeError(error: unknown): ErrorDescription {
  const described: ErrorDescription = { error: kindOf(error) };
  const cause =
    error && typeof error === "object"
      ? (error as { cause?: unknown }).cause
      : undefined;
  if (cause !== undefined) described.cause = kindOf(cause);

  // The driver fields can sit on the error or on any cause under it.
  let link: unknown = error;
  for (let depth = 0; depth < MAX_CHAIN && link && typeof link === "object"; depth++) {
    described.code ??= stringField(link, "code");
    for (const key of NAME_FIELDS) {
      described[key] ??= stringField(link, key);
    }
    link = (link as { cause?: unknown }).cause;
  }
  for (const key of ["code", ...NAME_FIELDS] as const) {
    if (described[key] === undefined) delete described[key];
  }

  const at = framesOf(error);
  if (at) described.at = at;
  return described;
}
