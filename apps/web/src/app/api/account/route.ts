import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@hank-neil/db";
import { deleteAccount } from "@/lib/account-deletion";
import { ACCOUNT_GONE, postgresCode, sessionGamerName } from "@/lib/gaming-profile";
import { matchesGamerName } from "@/lib/gamer-name-confirm";

/**
 * DELETE /api/account
 * Deletes the signed-in account: the Google sign-in id, the gamer name,
 * every saved game and every score (COPPA 312.6, design/ACCOUNTS_COPPA.md).
 * The control is "Delete this account" in the "For grown-ups" part of the
 * profile page.
 *
 * Body: { confirm: string }, the account's gamer name, typed by the
 * grown-up (lib/gamer-name-confirm.ts). A request without the correct
 * name deletes nothing, so a stray tap cannot delete an account.
 *
 * The 200 response also ends the session cookie, so the delete does not
 * depend on the browser's sign-out. The caller then signs out
 * (signOutAndClear), which also clears the game saves on this device.
 */

/** Auth.js session cookies: plain and __Secure- (https), and their chunks (".0", ".1"). */
const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

/** Expire every session cookie that the request holds, and the two base names. */
function endSession(request: Request, response: NextResponse): NextResponse {
  const names = new Set(SESSION_COOKIE_NAMES);
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name && SESSION_COOKIE.test(name)) names.add(name);
  }
  for (const name of names) {
    response.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }
  return response;
}

export async function DELETE(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let confirm: unknown;
  try {
    ({ confirm } = (await request.json()) as { confirm?: unknown });
  } catch {
    confirm = undefined;
  }

  try {
    const handle = await sessionGamerName(db, userId);
    if (handle === ACCOUNT_GONE) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    if (!matchesGamerName(confirm, handle)) {
      return NextResponse.json(
        { error: "Type the gamer name exactly as it shows." },
        { status: 400 }
      );
    }

    await deleteAccount(db, userId);
    return endSession(request, NextResponse.json({ deleted: true }));
  } catch (error) {
    // No values in the log: only the Postgres error code.
    console.error("DELETE /api/account failed", { code: postgresCode(error) ?? "unknown" });
    return NextResponse.json(
      { error: "That did not work. Try again." },
      { status: 500 }
    );
  }
}
