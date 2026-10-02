"use client";

import { useId, useRef, useState } from "react";
import { signOutAndClear } from "@/lib/auth-client";
import { forgetLocalWords } from "@/lib/local-words-key";
import { matchesGamerName } from "@/lib/gamer-name-confirm";
import { clearGameStorage } from "@/lib/storage-keys";

/**
 * "Delete this account": the parent's right to delete a child's
 * information (COPPA 16 CFR 312.6(a)(2), design/ACCOUNTS_COPPA.md).
 *
 * It is in a "For grown-ups" part at the bottom of the profile page. The
 * first button only opens the question. To delete, the grown-up types the
 * gamer name, and the server checks that name again (DELETE /api/account),
 * so a stray tap by a young player cannot delete the account. After the
 * delete, the page deletes the account's word store on this device (the
 * words that the player typed, lib/local-words-key.ts), then signs out,
 * which also clears the game saves on this device. Every other device
 * signs out the next time it loads a page.
 *
 * A 200 from the server is the end of the delete: the account is gone, and
 * the server has already ended the session cookie. If the sign-out after it
 * fails (a network drop), the page still clears this device and goes home.
 * It never says that the delete failed.
 *
 * User-facing copy: short sentences, no dashes.
 */

export const DELETE_ACCOUNT_LABEL = "Delete this account";
export const DELETE_ACCOUNT_WHAT =
  "This deletes the gamer name, every saved game and every score of this account. You cannot undo it.";
export const DELETE_ACCOUNT_FAILED = "That did not work. Try again.";

export function DeleteAccount({ handle, userId }: { handle: string | null; userId: string | null }) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openButtonRef = useRef<HTMLButtonElement>(null);

  const matches = matchesGamerName(typed, handle);

  const close = () => {
    setOpen(false);
    setTyped("");
    setError("");
    openButtonRef.current?.focus();
  };

  const handleDelete = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError("");
    let res: Response;
    try {
      res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      if (!res.ok) throw new Error(`DELETE /api/account ${res.status}`);
    } catch (err) {
      console.error("Delete account error:", err);
      setError(DELETE_ACCOUNT_FAILED);
      setBusy(false);
      return;
    }

    // The account is deleted. Delete its words on this device first: the
    // sign-out leaves every player's word store in place (the next sign-in
    // of the same player reads it), and this player will not sign in again.
    try {
      if (userId) await forgetLocalWords(userId);
    } catch (err) {
      // A blocked storage holds no words to delete.
      console.error("Could not delete the account's words on this device:", err);
    }

    // Sign out and clear this device.
    try {
      await signOutAndClear("/");
    } catch (err) {
      console.error("Sign-out after the delete failed; clearing this device:", err);
      try {
        clearGameStorage();
      } catch {
        // A blocked storage holds nothing to clear.
      }
      // A full page load (not a client-side route change): it also drops the
      // deleted account's progress that the game stores hold in memory. It
      // replaces the profile page, so Back does not open a deleted account.
      window.location.replace("/");
    }
  };

  return (
    <section aria-labelledby={`${inputId}-title`} className="mx-4 mt-8">
      <div className="bg-white/10 rounded-3xl p-6 border-2 border-white/20 text-white">
        <h2 id={`${inputId}-title`} className="text-xl font-bold mb-2">
          For grown-ups
        </h2>
        <p className="text-white/90 mb-4">{DELETE_ACCOUNT_WHAT}</p>

        {!open ? (
          <button
            ref={openButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-[44px] w-full px-6 py-3 rounded-2xl border-2 border-white bg-transparent text-white font-bold text-lg hover:bg-white/10 transition-colors"
          >
            {DELETE_ACCOUNT_LABEL}
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          >
            <label htmlFor={inputId} className="block font-semibold mb-2">
              To delete it, type the gamer name: <span className="font-bold">{handle ?? "Player"}</span>
            </label>
            <input
              id={inputId}
              type="text"
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="input input-bordered w-full min-h-[44px] text-lg text-gray-900 bg-white mb-4"
            />
            {error && (
              <p role="alert" className="mb-4 font-semibold text-white">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={!matches || busy}
                className="min-h-[44px] flex-1 px-6 py-3 rounded-2xl bg-red-700 text-white font-bold text-lg disabled:bg-white/20 disabled:text-white/70 disabled:cursor-not-allowed"
              >
                {busy ? "Deleting..." : "Delete forever"}
              </button>
              <button
                type="button"
                onClick={close}
                className="min-h-[44px] flex-1 px-6 py-3 rounded-2xl bg-white text-blue-900 font-bold text-lg"
              >
                Keep my account
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
