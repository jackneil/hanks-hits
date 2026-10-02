import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { describeError } from "../describe-error";

// The shape of a drizzle 0.45 query failure: the message is the SQL text plus
// every parameter, and the pg driver error (with SQLSTATE and the names of
// schema objects) is the cause.
class DrizzleQueryError extends Error {}
class DatabaseError extends Error {}

function drizzleFailure() {
  const driver = Object.assign(
    new DatabaseError('duplicate key value violates unique constraint "users_email_unique"'),
    {
      code: "23505",
      detail: "Key (email)=(kid@example.com) already exists.",
      table: "users",
      constraint: "users_email_unique",
      schema: "public",
    }
  );
  return new DrizzleQueryError(
    'Failed query: insert into "users" ("id", "name", "email", "password") values ($1, $2, $3, $4)\n' +
      "params: u-123,Speedy Kid,kid@example.com,$2b$12$abcdefghijklmnopqrstuv",
    { cause: driver }
  );
}

describe("describeError", () => {
  it("drops message lines that imitate stack frames", () => {
    const error = new SyntaxError("invalid input\n    at private-body-marker");
    const described = describeError(error);
    expect(JSON.stringify(described)).not.toContain("private-body-marker");
    expect(described.at?.length).toBeGreaterThan(0);
  });

  it("keeps the error classes, the SQLSTATE and the schema object names", () => {
    expect(describeError(drizzleFailure())).toEqual(
      expect.objectContaining({
        error: "DrizzleQueryError",
        cause: "DatabaseError",
        code: "23505",
        table: "users",
        constraint: "users_email_unique",
      })
    );
  });

  it("never prints a message, a detail, or a query parameter", () => {
    const printed = inspect(describeError(drizzleFailure()), { depth: 8 });
    for (const secret of [
      "kid@example.com",
      "Speedy Kid",
      "u-123",
      "$2b$12$",
      "Failed query",
      "params",
      "duplicate key",
      "already exists",
    ]) {
      expect(printed, secret).not.toContain(secret);
    }
  });

  it("keeps stack frames but drops every message line, even a multi-line one", () => {
    const described = describeError(drizzleFailure());
    expect(described.at?.length).toBeGreaterThan(0);
    for (const frame of described.at ?? []) {
      expect(frame).toMatch(/^at /);
    }
    expect(described.at?.length).toBeLessThanOrEqual(5);
  });

  it("drops the request body that a JSON SyntaxError quotes", () => {
    let thrown: unknown;
    try {
      JSON.parse("hunter22 kid@example.com");
    } catch (error) {
      thrown = error;
    }
    // V8 quotes the input in the message, so a raw log would leak it.
    expect((thrown as Error).message).toContain("hunter22");
    const printed = inspect(describeError(thrown), { depth: 8 });
    expect(describeError(thrown).error).toBe("SyntaxError");
    expect(printed).not.toContain("hunter22");
    expect(printed).not.toContain("kid@example.com");
  });

  it("describes a value that is not an Error", () => {
    expect(describeError("kid@example.com")).toEqual({ error: "string" });
    expect(describeError(null)).toEqual({ error: "null" });
    expect(describeError({ code: "ECONNREFUSED", cause: 42 })).toEqual({
      error: "object",
      cause: "number",
      code: "ECONNREFUSED",
    });
  });
});
