/**
 * The Auth.js logger of the app (the `logger` option in src/lib/auth.ts).
 * It logs an error with no value that the error carries.
 *
 * Why: the default Auth.js logger prints error.message, the stack of the
 * cause (its first line is the message again), and a JSON copy of the data
 * in the cause. Auth.js reads a JSON sign-in body with req.json(). When the
 * JSON does not parse, the error is a V8 SyntaxError, and its message quotes
 * the body near the bad token: that text can be part of a password. Other
 * Auth.js errors can carry an email, a URL or a provider answer in the same
 * fields.
 *
 * This logger keeps only the parts that identify the fault: the Auth.js
 * error type and kind (fixed names such as "CredentialsSignin"), and the
 * description of describeError() (class names, codes, stack frames) for the
 * error and for the error in its cause. Only `error` is replaced. The
 * default `warn` prints a fixed warning code only, and `debug` is off
 * (the config does not set `debug`).
 */
import { describeError, type ErrorDescription } from "@/lib/describe-error";

export type AuthErrorDescription = ErrorDescription & {
  /** The Auth.js error type, for example "CredentialsSignin". */
  type?: string;
  /** The Auth.js error kind: "signIn" or "error". */
  kind?: string;
  /** The description of the error that Auth.js keeps in cause.err. */
  causeError?: ErrorDescription;
};

/** A fixed name: the type and kind of an Auth.js error look like this, a value never does. */
const FIXED_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

function nameField(value: unknown, key: "type" | "kind"): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && FIXED_NAME.test(field) ? field : undefined;
}

/** Describe an error that Auth.js gives to its logger, with no value that it carries. */
export function describeAuthError(error: unknown): AuthErrorDescription {
  const described: AuthErrorDescription = describeError(error);
  const type = nameField(error, "type");
  if (type) described.type = type;
  const kind = nameField(error, "kind");
  if (kind) described.kind = kind;
  // Auth.js keeps the error under the AuthError in cause.err.
  const cause =
    error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  const inner =
    cause && typeof cause === "object" ? (cause as { err?: unknown }).err : undefined;
  if (inner instanceof Error) described.causeError = describeError(inner);
  return described;
}

/** The logger for the NextAuth config. */
export const authLogger = Object.freeze({
  error(error: Error): void {
    console.error("[auth][error]", describeAuthError(error));
  },
});
