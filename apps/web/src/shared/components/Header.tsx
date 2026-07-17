"use client";

import Link from "next/link";
import { LoginButton } from "./LoginButton";

interface HeaderProps {
  title?: string;
  titleIcon?: string;
  showBackButton?: boolean;
  backPath?: string;
  className?: string;
  /** Hide the sign-in control (e.g. on the login/signup pages themselves) */
  showLoginButton?: boolean;
}

/**
 * Shared header component with consistent styling across pages.
 *
 * Features:
 * - Sticky positioning with backdrop blur
 * - Optional back button (left)
 * - Optional title with emoji icon (center)
 * - LoginButton (right)
 */
export function Header({
  title,
  titleIcon,
  showBackButton = true,
  backPath = "/",
  className = "",
  showLoginButton = true,
}: HeaderProps) {
  return (
    <header className={`sticky top-0 z-50 backdrop-blur-xl bg-slate-950/80 border-b border-white/10 ${className}`}>
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Left: Back button or spacer */}
        {showBackButton ? (
          <Link
            href={backPath}
            className="group flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-300 min-w-[44px] min-h-[44px] border border-white/10 hover:border-white/20"
          >
            <span className="text-xl group-hover:-translate-x-1 transition-transform">←</span>
            <span className="text-white/80 group-hover:text-white font-medium hidden sm:inline">Home</span>
          </Link>
        ) : (
          <div className="w-20" />
        )}

        {/* Center: Title with icon. The icon hides below sm: (the page
            content carries its own identity there) and the title never
            wraps — a two-line header title crowded 390px phones. */}
        {title && (
          <div className="flex items-center gap-3 min-w-0">
            {titleIcon && (
              <span className="hidden sm:inline text-3xl md:text-4xl animate-bounce-slow drop-shadow-[0_0_15px_rgba(250,204,21,0.5)]">
                {titleIcon}
              </span>
            )}
            <h1 className="text-xl md:text-2xl font-black bg-gradient-to-r from-yellow-300 via-pink-400 to-cyan-400 bg-clip-text text-transparent whitespace-nowrap truncate">
              {title}
            </h1>
          </div>
        )}

        {/* Right: Trophies + Leaderboards links (everyone) + LoginButton.
            🏅 for the Trophy Case, 🏆 stays Leaderboards — same glyph for
            both would misdirect a kid hunting their trophies. */}
        <div className="flex items-center gap-2">
          <Link
            href="/trophies"
            aria-label="Trophy Case"
            className="group flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-300 min-w-[44px] min-h-[44px] border border-white/10 hover:border-white/20"
          >
            <span className="text-xl" aria-hidden="true">🏅</span>
            <span className="text-white/80 group-hover:text-white font-medium hidden sm:inline">Trophies</span>
          </Link>
          <Link
            href="/leaderboards"
            aria-label="Leaderboards"
            className="group flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-300 min-w-[44px] min-h-[44px] border border-white/10 hover:border-white/20"
          >
            <span className="text-xl" aria-hidden="true">🏆</span>
            <span className="text-white/80 group-hover:text-white font-medium hidden sm:inline">Leaderboards</span>
          </Link>
          {showLoginButton && <LoginButton />}
        </div>
      </div>
    </header>
  );
}

export default Header;
