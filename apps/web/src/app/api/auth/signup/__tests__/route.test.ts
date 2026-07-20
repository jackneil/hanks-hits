import { beforeEach, describe, expect, it, vi } from "vitest";

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
