"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";

type GuestWarningProps = {
  className?: string;
  compact?: boolean;
};

/**
 * Warning banner for guest users
 *
 * Shows a friendly reminder that progress is only saved locally
 * and can be lost if they clear their browser data.
 */
export function GuestWarning({ className = "", compact = false }: GuestWarningProps) {
  const { data: session, status } = useSession();

  // Don't show if loading or authenticated
  if (status === "loading" || session?.user) {
    return null;
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-2 text-warning text-sm ${className}`}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span>Playing as Guest</span>
        <Link href="/login" className="link link-primary font-bold">
          Sign in to save
        </Link>
      </div>
    );
  }

  return (
    <div className={`alert alert-warning ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="stroke-current shrink-0 h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <div>
        <h3 className="font-bold">Playing as Guest</h3>
        <div className="text-sm">
          Your progress is saved on this device only. Clear your browser data
          and it&apos;s gone forever!
        </div>
      </div>
      <Link href="/login" className="btn btn-sm btn-primary">
        Sign In to Save
      </Link>
    </div>
  );
}

export default GuestWarning;
