"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

import { Header } from "@/shared/components/Header";
import { TrophyCase } from "@/shared/components/TrophyCase";

/**
 * Guest-visible home for the Trophy Case. Trophies live in local (and, when
 * signed in, cloud-synced) achievements state, so a kid NEVER needs an
 * account to see what they earned — the unlock toast points here, and this
 * page must work for the platform's default signed-out kid.
 */
export function TrophiesPage() {
  const { status } = useSession();

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-600 to-purple-700 pb-8">
      <Header title="Trophy Case" titleIcon="🏆" />

      <TrophyCase />

      {status === "unauthenticated" && (
        <p className="mx-4 text-center text-white/70 text-sm">
          Psst: trophies live on this computer for now.{" "}
          <Link
            href="/login"
            className="text-white font-bold underline inline-flex items-center min-h-[44px] px-1 align-middle"
          >
            Sign in
          </Link>{" "}
          to keep them safe everywhere you play!
        </p>
      )}
    </div>
  );
}
