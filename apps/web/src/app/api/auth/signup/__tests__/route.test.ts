import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";

// The signup route is the server-side enforcement of the password minimum
// (SECURITY_BACKLOG item 2: 6 -> 8). Client-side minLength is decoration;
// this boundary is the one that counts.

const findFirst = vi.fn();
const returning = vi.fn();
const valuesSpy = vi.fn();

vi.mock("@hank-neil/db", () => ({
  db: {
    query: { users: { findFirst: (...args: unknown[]) => findFirst(...args) } },
    insert: () => ({
      values: (...args: unknown[]) => {
        valuesSpy(...args);
        return { returning: (...a: unknown[]) => returning(...a) };
      },
    }),
  },
  eq: vi.fn(),
}));

vi.mock("@hank-neil/db/schema", () => ({
  users: { email: "email" },
}));

vi.mock("@/lib/rate-limit", () => ({
  getClientIP: () => "127.0.0.1",
  checkSignupRateLimit: () => ({ success: true }),
}));

import { POST } from "../route";

function signupRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/signup password minimum", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(undefined);
    returning.mockReset().mockResolvedValue([
      { id: "u1", name: "Kid", email: "kid@example.com" },
    ]);
    valuesSpy.mockReset();
  });

  it("rejects a 7-character password with a 400", async () => {
    const res = await POST(
      signupRequest({ email: "kid@example.com", password: "short77" })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least 8 characters/i);
  });

  it("accepts an 8-character password", async () => {
    const res = await POST(
      signupRequest({ email: "kid@example.com", password: "eight888" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user.email).toBe("kid@example.com");
  });

  it("still requires email and password at all", async () => {
    const res = await POST(signupRequest({ email: "kid@example.com" }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-string password with a clean 400, not a bcrypt 500", async () => {
    const res = await POST(
      signupRequest({ email: "kid@example.com", password: 12345678 })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/signup display-name validation", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(undefined);
    returning.mockReset().mockResolvedValue([
      { id: "u1", name: "Kid", email: "kid@example.com" },
    ]);
    valuesSpy.mockReset();
  });

  const persistedName = () => valuesSpy.mock.calls[0]?.[0]?.name;

  it("rejects an over-long name with a 400 and never inserts", async () => {
    const res = await POST(
      signupRequest({
        email: "kid@example.com",
        password: "eight888",
        name: "x".repeat(51),
      })
    );
    expect(res.status).toBe(400);
    expect(valuesSpy).not.toHaveBeenCalled();
  });

  it("rejects a megabyte-sized name with a 400 (storage-abuse guard)", async () => {
    const res = await POST(
      signupRequest({
        email: "kid@example.com",
        password: "eight888",
        name: "x".repeat(1_000_000),
      })
    );
    expect(res.status).toBe(400);
    expect(valuesSpy).not.toHaveBeenCalled();
  });

  it("rejects markup characters in the name with a 400", async () => {
    const res = await POST(
      signupRequest({
        email: "kid@example.com",
        password: "eight888",
        name: "<script>alert(1)</script>",
      })
    );
    expect(res.status).toBe(400);
    expect(valuesSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-string name with a 400", async () => {
    const res = await POST(
      signupRequest({
        email: "kid@example.com",
        password: "eight888",
        name: { evil: true },
      })
    );
    expect(res.status).toBe(400);
    expect(valuesSpy).not.toHaveBeenCalled();
  });

  it("stores a valid name trimmed", async () => {
    const res = await POST(
      signupRequest({
        email: "kid@example.com",
        password: "eight888",
        name: "  Hank  ",
      })
    );
    expect(res.status).toBe(200);
    expect(persistedName()).toBe("Hank");
  });

  it("falls back to a sanitized email prefix when no name is given", async () => {
    const res = await POST(
      signupRequest({ email: "hank+games@example.com", password: "eight888" })
    );
    expect(res.status).toBe(200);
    // '+' is stripped — the derived name is charset-safe.
    expect(persistedName()).toBe("hankgames");
  });

  it("falls back to the email prefix for a blank/whitespace name", async () => {
    const res = await POST(
      signupRequest({
        email: "hank@example.com",
        password: "eight888",
        name: "   ",
      })
    );
    expect(res.status).toBe(200);
    expect(persistedName()).toBe("hank");
  });
});

describe("POST /api/auth/signup error log", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(undefined);
    valuesSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const printed = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls
      .map((args) =>
        args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 8 }))).join(" ")
      )
      .join("\n");

  it("logs a failed insert without the email, the name or the password hash", async () => {
    // Two signups with one email race past the findFirst check. drizzle puts
    // every insert parameter into its error message.
    class DrizzleQueryError extends Error {}
    returning.mockReset().mockImplementation(async () => {
      const [values] = valuesSpy.mock.calls[0] as [Record<string, string>];
      throw new DrizzleQueryError(
        `Failed query: insert into "users" ("id", "name", "email", "password")\nparams: ${Object.values(values).join(",")}`,
        {
          cause: Object.assign(new Error("duplicate key value violates unique constraint"), {
            code: "23505",
            table: "users",
            constraint: "users_email_unique",
          }),
        }
      );
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      signupRequest({ email: "racer@example.com", password: "eight888", name: "Speedy" })
    );

    expect(res.status).toBe(500);
    expect(errorLog).toHaveBeenCalledWith(
      "Signup error:",
      expect.objectContaining({ code: "23505", constraint: "users_email_unique" })
    );
    const logged = printed(errorLog);
    expect(logged).not.toContain("racer@example.com");
    expect(logged).not.toContain("Speedy");
    expect(logged).not.toContain("$2"); // a bcrypt hash starts "$2a$" / "$2b$"
    expect(logged).not.toContain("Failed query");
  });

  it("logs a malformed body without quoting it", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "hunter22 racer@example.com",
      })
    );

    expect(res.status).toBe(500);
    const logged = printed(errorLog);
    expect(logged).toContain("SyntaxError");
    expect(logged).not.toContain("hunter22");
    expect(logged).not.toContain("racer@example.com");
  });
});
