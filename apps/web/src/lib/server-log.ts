/**
 * Server error logs that keep player data out of the logs.
 *
 * Do not give an error object to console.error or console.warn in server
 * code. Railway keeps our server logs, and an error message can hold player
 * data:
 *
 * - A drizzle DrizzleQueryError puts the query values in its message. For a
 *   new account, these values are the name, the email address and the
 *   password hash.
 * - A Postgres error puts row values in its "detail" text, for example
 *   "Key (email)=(...) already exists".
 * - A JSON parse error puts part of the request body in its message.
 *
 * Use logServerError or logServerWarning. They write only fields that hold
 * no player data: the error name, the error code, the database constraint,
 * table and column names, and the code locations from the stack. They never
 * write the message, the query values, the database detail or the request.
 *
 * The privacy notice (/privacy) says what our error messages contain. Keep
 * that text true when you change this file.
 */

/** The fields of an error that are safe to write to a server log. */
export type SafeErrorFields = {
  name: string;
  type?: string;
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  at?: string[];
  cause?: SafeErrorFields;
};

// An error name or an Auth.js error type, for example "DrizzleQueryError".
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// A Postgres SQLSTATE ("23505") or a Node code ("ECONNREFUSED").
const CODE = /^[A-Za-z0-9_]{1,64}$/;
// A Postgres identifier (a name of 63 bytes or less).
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
// A stack frame line ("    at fn (file:line:col)"). The first stack line
// holds the message, so it never matches.
const STACK_FRAME = /^\s+at\s/;

function match(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function field(source: object, key: string): unknown {
  return (source as Record<string, unknown>)[key];
}

/** The next error in the chain: an Error cause, or the Auth.js { err } shape. */
function nextCause(error: object): unknown {
  const cause = field(error, "cause");
  if (cause instanceof Error) return cause;
  if (cause && typeof cause === "object" && field(cause, "err") instanceof Error) {
    return field(cause, "err");
  }
  return undefined;
}

function describe(error: unknown, seen: Set<unknown>): SafeErrorFields {
  if (!(error instanceof Error)) {
    // A thrown string or object can be player data. Record only its type.
    return { name: error === null ? "null" : typeof error };
  }
  seen.add(error);

  const fields: SafeErrorFields = { name: match(error.name, NAME) ?? "Error" };
  const type = match(field(error, "type"), NAME);
  if (type) fields.type = type;
  const code = match(field(error, "code"), CODE);
  if (code) fields.code = code;
  for (const key of ["constraint", "table", "column"] as const) {
    const value = match(field(error, key), IDENTIFIER);
    if (value) fields[key] = value;
  }

  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => STACK_FRAME.test(line))
    .map((line) => line.trim());
  if (frames.length > 0) fields.at = frames;

  const cause = nextCause(error);
  if (cause !== undefined && !seen.has(cause)) {
    fields.cause = describe(cause, seen);
  }
  return fields;
}

/** Return only the fields of an error that hold no player data. */
export function describeErrorSafely(error: unknown): SafeErrorFields {
  return describe(error, new Set());
}

/**
 * Write an error to the server log without its message or data.
 *
 * @param label - A fixed text that names the place, for example
 *   "POST /api/progress error". Do not put player data in the label.
 */
export function logServerError(label: string, error: unknown): void {
  console.error(`${label}: ${JSON.stringify(describeErrorSafely(error))}`);
}

/** The same as logServerError, at the warning level. */
export function logServerWarning(label: string, error: unknown): void {
  console.warn(`${label}: ${JSON.stringify(describeErrorSafely(error))}`);
}
