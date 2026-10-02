// @vitest-environment node
import { inspect } from "node:util";
import { AuthError, CredentialsSignin } from "next-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authLogger, describeAuthError } from "@/lib/auth-logger";

// The Auth.js logger of the app logs an error with no value in it. The
// default Auth.js logger printed error.message: for a JSON sign-in body that
// does not parse, V8's message quotes the body near the bad token (part of a
// password).

afterEach(() => {
  vi.restoreAllMocks();
});

/** A SyntaxError of JSON.parse on a body with a password in it (V8 quotes the text near the bad token). */
function parseError(): Error {
  try {
    JSON.parse('{"email":"kid@example.com","password":hunter22secret}');
  } catch (error) {
    return error as Error;
  }
  throw new Error("the text must not parse");
}

describe("describeAuthError", () => {
  it("keeps the class and the frames of a JSON SyntaxError, not its message", () => {
    const error = parseError();
    expect(error.message).toContain("hunter22"); // the leak that the default logger printed
    const described = describeAuthError(error);
    expect(described.error).toBe("SyntaxError");
    expect(JSON.stringify(described)).not.toContain("hunter22");
    expect(JSON.stringify(described)).not.toContain("kid@example.com");
  });

  it("keeps the type and kind of an Auth.js error", () => {
    const described = describeAuthError(new CredentialsSignin());
    expect(described).toEqual(expect.objectContaining({ type: "CredentialsSignin", kind: "signIn" }));
  });

  it("describes the error in cause.err, and keeps none of its text", () => {
    const inner = new TypeError("no user kid@example.com with password hunter22");
    // The shape that Auth.js gives its errors: the inner error in cause.err.
    const described = describeAuthError(new AuthError("Sign-in failed for kid@example.com", { cause: { err: inner } }));
    expect(described.causeError).toEqual(expect.objectContaining({ error: "TypeError" }));
    expect(JSON.stringify(described)).not.toMatch(/kid@example\.com|hunter22/);
  });

  it("drops a type or kind field that is not a fixed name", () => {
    const error = Object.assign(new Error("x"), { type: "kid@example.com", kind: "hunter 22" });
    const described = describeAuthError(error);
    expect(described.type).toBeUndefined();
    expect(described.kind).toBeUndefined();
  });
});

describe("authLogger.error", () => {
  it("does not log body text that looks like a stack frame", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      JSON.parse('["ok",\n    at private-body-marker]');
    } catch (error) {
      authLogger.error(error as Error);
    }
    expect(errors).toHaveBeenCalledOnce();
    expect(inspect(errors.mock.calls, { depth: 8 })).not.toContain("at private");
  });

  it("prints the description, never the message", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    authLogger.error(parseError());
    const printed = errors.mock.calls.map((args) => args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 8 }))).join(" ")).join("\n");
    expect(printed).toContain("[auth][error]");
    expect(printed).toContain("SyntaxError");
    expect(printed).not.toContain("hunter22");
  });
});
