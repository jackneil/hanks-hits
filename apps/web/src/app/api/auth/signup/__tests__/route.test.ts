import { beforeEach, describe, expect, it, vi } from "vitest";

// The signup route is the server-side enforcement of the password minimum
// (SECURITY_BACKLOG item 2: 6 -> 8). Client-side minLength is decoration;
// this boundary is the one that counts.

const findFirst = vi.fn();
const returning = vi.fn();

vi.mock("@hank-neil/db", () => ({
  db: {
    query: { users: { findFirst: (...args: unknown[]) => findFirst(...args) } },
    insert: () => ({
      values: () => ({ returning: (...args: unknown[]) => returning(...args) }),
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
