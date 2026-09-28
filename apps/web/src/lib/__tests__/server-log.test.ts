import { afterEach, describe, expect, it, vi } from "vitest";

import { describeErrorSafely, logServerError, logServerWarning } from "../server-log";

/**
 * Server logs must never hold player data. These tests build the errors
 * that really reach our catch blocks and check that no value survives.
 */

const EMAIL = "kid@example.com";
const NAME = "Jimmie Smith";
const HASH = "$2a$12$abcdefghijklmnopqrstuv";

/** The same shape as drizzle-orm's DrizzleQueryError (errors.js). */
class DrizzleQueryError extends Error {
  query: string;
  params: unknown[];
  constructor(query: string, params: unknown[], cause?: unknown) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.name = "DrizzleQueryError";
    this.query = query;
    this.params = params;
    this.cause = cause;
  }
}

/** The fields that node-postgres puts on a database error. */
function pgUniqueViolation(): Error {
  const error = new Error('duplicate key value violates unique constraint "users_email_unique"');
  Object.assign(error, {
    name: "error",
    code: "23505",
    constraint: "users_email_unique",
    table: "users",
    detail: `Key (email)=(${EMAIL}) already exists.`,
  });
  return error;
}

function signupInsertError(): Error {
  return new DrizzleQueryError(
    'insert into "users" ("id", "name", "email", "password") values ($1, $2, $3, $4)',
    ["id-1", NAME, EMAIL, HASH],
    pgUniqueViolation()
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeErrorSafely", () => {
  it("keeps the error name, the database code and the constraint", () => {
    const fields = describeErrorSafely(signupInsertError());
    expect(fields.name).toBe("DrizzleQueryError");
    expect(fields.cause).toMatchObject({
      name: "error",
      code: "23505",
      constraint: "users_email_unique",
      table: "users",
    });
  });

  it("drops the query values, the message and the database detail", () => {
    const text = JSON.stringify(describeErrorSafely(signupInsertError()));
    for (const secret of [EMAIL, NAME, HASH, "params", "Failed query", "already exists"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps the stack frames, but never the message line at the top", () => {
    const fields = describeErrorSafely(signupInsertError());
    expect(fields.at?.length).toBeGreaterThan(0);
    for (const frame of fields.at ?? []) {
      expect(frame.startsWith("at ")).toBe(true);
    }
  });

  it("drops the request text in a JSON parse error", () => {
    let parseError: unknown;
    try {
      JSON.parse(`{"name": "${NAME}", oops`);
    } catch (error) {
      parseError = error;
    }
    const text = JSON.stringify(describeErrorSafely(parseError));
    expect(text).toContain("SyntaxError");
    expect(text).not.toContain(NAME);
  });

  it("records only the type of a thrown value that is not an Error", () => {
    expect(describeErrorSafely(EMAIL)).toEqual({ name: "string" });
    expect(describeErrorSafely({ email: EMAIL })).toEqual({ name: "object" });
    expect(describeErrorSafely(null)).toEqual({ name: "null" });
  });

  it("follows the Auth.js cause shape ({ err }) and skips its other data", () => {
    const authError = new Error("Read more at https://errors.authjs.dev#adaptererror");
    Object.assign(authError, {
      name: "AdapterError",
      type: "AdapterError",
      cause: { err: signupInsertError(), email: EMAIL },
    });
    const fields = describeErrorSafely(authError);
    expect(fields).toMatchObject({ name: "AdapterError", type: "AdapterError" });
    expect(fields.cause?.name).toBe("DrizzleQueryError");
    expect(JSON.stringify(fields)).not.toContain(EMAIL);
  });

  it("drops a code or a name that is not a plain identifier", () => {
    const error = new Error("x");
    Object.assign(error, { name: `bad ${EMAIL}`, code: `${EMAIL}`, constraint: "a b" });
    expect(describeErrorSafely(error)).toEqual(
      expect.objectContaining({ name: "Error" })
    );
    const text = JSON.stringify(describeErrorSafely(error));
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("constraint");
  });

  it("stops on a cause loop", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;
    const fields = describeErrorSafely(first);
    expect(fields.cause?.cause).toBeUndefined();
  });
});

describe("logServerError and logServerWarning", () => {
  it("write one line with the label and the safe fields only", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logServerError("Signup error", signupInsertError());
    logServerWarning("[LEADERBOARD] extract failed", signupInsertError());

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const [errorLine] = error.mock.calls[0];
    const [warnLine] = warn.mock.calls[0];
    for (const line of [errorLine, warnLine]) {
      expect(typeof line).toBe("string");
      expect(line).toContain("23505");
      expect(line).not.toContain(EMAIL);
      expect(line).not.toContain(HASH);
    }
    expect(errorLine.startsWith("Signup error: {")).toBe(true);
  });
});
