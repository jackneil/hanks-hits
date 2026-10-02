"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { signInWithGoogle, signOutAndClear } from "@/lib/auth-client";
import { Header } from "@/shared/components/Header";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { SECONDARY_ACTION } from "@/shared/components/buttonStyles";
import {
  LOGIN_ASK_A_GROWN_UP,
  LOGIN_FAILED,
  LOGIN_GUEST_PLAY,
  LOGIN_NOTE_DELETE,
  LOGIN_NOTE_KEEP,
  LOGIN_NOTE_NEVER,
  LOGIN_NOTE_NOT_KEPT,
  LOGIN_NOTE_TITLE,
  LOGIN_NOTE_USE,
  LOGIN_SIGNED_IN_AS,
  LOGIN_SIGNED_IN_SPOKEN,
  LOGIN_SIGNED_IN_SWITCH,
  LOGIN_SIGNED_IN_TITLE,
  LOGIN_SPOKEN,
  LOGIN_TITLE,
  LOGIN_WHAT_IT_DOES,
} from "./copy";

/**
 * The sign-in page. Sign-in is Google only, and a grown-up does it
 * (COPPA, issue #26i, design/ACCOUNTS_COPPA.md). Playing as a guest
 * always works, so the page also offers a way back to the games.
 *
 * The words are short for young players, and the read-aloud button reads
 * them out. The note for grown-ups (#for-grown-ups, linked from the home
 * page) is the COPPA notice at the place where the sign-in id is
 * collected: what an account keeps, what it is used for, and how we make
 * sure it is not used to contact a player.
 *
 * When this browser is already signed in, the page shows the gamer name
 * and "Sign out" instead of the Google button. A sign-in with a second
 * Google account here would link it to the first player's account
 * (Auth.js links a new account to the signed-in user), and the database
 * refuses that link too (accounts_user_id_unique).
 */

const noSubscription = () => () => {};

/**
 * True when Auth.js sent a failed sign-in back here with ?error=<code>
 * (pages.error in lib/auth.ts). It reads the address in the browser, so
 * the static page needs no Suspense. The server render says false.
 */
function useSignInFailed(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => new URLSearchParams(window.location.search).has("error"),
    () => false
  );
}

export default function LoginPage() {
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && !!session?.user?.id;
  const gamerName = session?.user?.handle || "Player";
  const signInFailed = useSignInFailed();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [triedAgain, setTriedAgain] = useState(false);
  const shownError = error || (signInFailed && !triedAgain ? LOGIN_FAILED : "");

  const handleGoogleLogin = async () => {
    setTriedAgain(true);
    setError("");
    setLoading(true);

    try {
      await signInWithGoogle("/");
    } catch {
      setError(LOGIN_FAILED);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-950">
      <Header showLoginButton={false} />

      <main className="flex flex-col items-center px-4 py-8">
        <div className="mb-4 text-6xl animate-bounce-slow" aria-hidden="true">
          🎮
        </div>
        <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8 w-full max-w-md">
          {signedIn ? (
            <>
              <div className="text-center mb-6">
                <h1 className="text-4xl font-bold text-gray-800 mb-3">{LOGIN_SIGNED_IN_TITLE}</h1>
                <p className="text-xl text-gray-700">
                  {LOGIN_SIGNED_IN_AS} <span className="font-bold">{gamerName}</span>.
                </p>
                <p className="text-lg text-gray-600 mt-1">{LOGIN_SIGNED_IN_SWITCH}</p>
              </div>
              <ReadAloudButton text={LOGIN_SIGNED_IN_SPOKEN} className="mb-4" />
              <Link href="/" className="btn btn-lg btn-primary w-full gap-2 mb-3">
                <span aria-hidden="true">🕹️</span>
                Back to the games
              </Link>
              <button
                type="button"
                onClick={() => signOutAndClear("/login")}
                className={`btn btn-lg w-full ${SECONDARY_ACTION}`}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className="text-center mb-6">
                <h1 className="text-4xl font-bold text-gray-800 mb-3">{LOGIN_TITLE}</h1>
                <p className="text-xl text-gray-700">{LOGIN_ASK_A_GROWN_UP}</p>
                <p className="text-lg text-gray-600 mt-1">{LOGIN_WHAT_IT_DOES}</p>
              </div>

              {shownError && (
                <div role="alert" className="alert alert-error mb-6">
                  <span>{shownError}</span>
                </div>
              )}

              <ReadAloudButton text={LOGIN_SPOKEN} className="mb-4" />

              {/* Google sign-in: big and clear for the grown-up. Off until the
                  session is known, so a signed-in browser cannot start it. */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading || status === "loading"}
                className="btn btn-lg w-full gap-3 mb-6 bg-white border-2 border-gray-300 hover:bg-gray-50 text-gray-700"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {loading ? "Opening Google..." : "Sign in with Google"}
              </button>

              {/* Guest play: always works, no sign-in needed */}
              <p className="text-center text-lg text-gray-700 mb-3">{LOGIN_GUEST_PLAY}</p>
              <Link href="/" className={`btn btn-lg w-full gap-2 ${SECONDARY_ACTION}`}>
                <span aria-hidden="true">🕹️</span>
                Just play
              </Link>
            </>
          )}

          <section
            id="for-grown-ups"
            aria-labelledby="for-grown-ups-title"
            className="mt-6 scroll-mt-24 rounded-2xl bg-slate-100 p-4 text-sm leading-relaxed text-gray-700"
          >
            <h2 id="for-grown-ups-title" className="font-bold text-gray-800 mb-1">
              {LOGIN_NOTE_TITLE}
            </h2>
            {[LOGIN_NOTE_KEEP, LOGIN_NOTE_NOT_KEPT, LOGIN_NOTE_USE, LOGIN_NOTE_NEVER, LOGIN_NOTE_DELETE].map((line) => (
              <p key={line} className="mt-2">
                {line}
              </p>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
