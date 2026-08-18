"use client";

import { useSession } from "next-auth/react";
import { signOutAndClear } from "@/lib/auth-client";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";

/**
 * Login button component - shows sign in or user dropdown
 *
 * - Guest: Shows "Sign In" button
 * - Authenticated: Shows avatar with dropdown menu
 */
interface LoginButtonProps {
  showLabelOnMobile?: boolean;
}

export function LoginButton({ showLabelOnMobile = false }: LoginButtonProps) {
  const { data: session, status } = useSession();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

  // Close dropdown on Escape and return focus to the avatar button
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDropdownOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dropdownOpen]);

  // Loading state
  if (status === "loading") {
    return (
      <div className="btn btn-ghost btn-circle">
        <span className="loading loading-spinner loading-sm" />
      </div>
    );
  }

  // Not logged in - optionally keep the text label visible on touch screens.
  // GameShell enables this; the wider page Header keeps its compact icon mode.
  if (!session?.user) {
    return (
      <Link
        href="/login"
        aria-label="Sign In"
        className="btn btn-primary btn-sm gap-2 min-h-[44px]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
          />
        </svg>
        <span className={showLabelOnMobile ? "" : "hidden sm:inline"}>Sign In</span>
      </Link>
    );
  }

  // Logged in - show avatar dropdown
  const userImage = session.user.image;
  const userName = session.user.name || session.user.email || "Player";
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    await signOutAndClear("/");
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div
        ref={triggerRef}
        tabIndex={0}
        role="button"
        className="btn btn-ghost btn-circle avatar cursor-pointer"
        onClick={() => setDropdownOpen(!dropdownOpen)}
      >
        <div className="w-10 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2">
          {userImage ? (
            <img
              src={userImage}
              alt={userName}
              onError={(e) => {
                // Fallback to initials on image load failure
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <div className={`bg-primary text-primary-content flex items-center justify-center w-full h-full text-lg font-bold ${userImage ? 'hidden' : ''}`}>
            {initials}
          </div>
        </div>
      </div>

      {dropdownOpen && (
        <ul
          tabIndex={0}
          className="absolute right-0 top-full mt-3 z-[60] p-2 shadow-lg bg-base-100 rounded-box w-52 menu menu-sm"
        >
          <li className="menu-title">
            <span className="text-base font-bold">{userName}</span>
            {session.user.email && (
              <span className="text-xs text-base-content/60">
                {session.user.email}
              </span>
            )}
          </li>
          <div className="divider my-0" />
          <li>
            <Link
              href="/profile"
              onClick={() => setDropdownOpen(false)}
              className="flex items-center gap-2"
            >
              <span className="text-lg">👤</span>
              My Profile
            </Link>
          </li>
          <li>
            <Link
              href="/leaderboards"
              onClick={() => setDropdownOpen(false)}
              className="flex items-center gap-2"
            >
              <span className="text-lg">🏆</span>
              Leaderboards
            </Link>
          </li>
          <div className="divider my-0" />
          <li>
            <button
              onClick={handleSignOut}
              className="text-error hover:bg-error/10"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Sign Out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export default LoginButton;
