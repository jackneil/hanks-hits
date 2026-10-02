// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/profile is the profile card's data. An account keeps no name,
 * email or photo (COPPA, issue #26i), so the card gets the made-up gamer
 * name and the "member since" date, and there is no name to edit.
 */

const authMock = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const gamingProfile = vi.hoisted(() => ({ getOrCreateGamingProfile: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@hank-neil/db", () => ({ db: { query: { users: { findFirst } } }, eq: vi.fn() }));
vi.mock("@/lib/gaming-profile", () => gamingProfile);

import * as route from "../route";

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1", handle: "TurboFox42" }, expires: "x" });
  // What a row from before the purge could still hold: the route must not pass it on.
  findFirst.mockReset().mockResolvedValue({
    id: "u1",
    name: "Kid Example",
    email: "kid@example.com",
    image: "https://lh3.googleusercontent.com/a/photo",
    emailVerified: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  gamingProfile.getOrCreateGamingProfile.mockReset().mockResolvedValue({ handle: "TurboFox42" });
});

describe("GET /api/profile", () => {
  it("returns the gamer name and the member-since date, and no personal information", async () => {
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: "TurboFox42", createdAt: "2026-01-01T00:00:00.000Z" });
  });

  it("reads only the created date from the users row", async () => {
    await route.GET();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ columns: { createdAt: true } }));
  });

  it("gives a player with no gamer name yet one now", async () => {
    await route.GET();
    expect(gamingProfile.getOrCreateGamingProfile).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("needs a signed-in player", async () => {
    authMock.mockResolvedValue(null);
    expect((await route.GET()).status).toBe(401);
  });
});

describe("PATCH /api/profile", () => {
  it("is gone: there is no name to edit", () => {
    expect((route as Record<string, unknown>).PATCH).toBeUndefined();
  });
});
