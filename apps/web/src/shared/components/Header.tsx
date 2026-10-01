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
    // Opaque, the colour of the root: Safari on iOS 26 and later fills the
    // strip under the status bar from the page's top edge, and over a
    // see-through, blurred bar it painted that strip white on a real
    // iPhone SE (2026-10-01).
    <header className={`sticky top-0 z-50 bg-slate-950 border-b border-white/10 ${className}`}>
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Left: Back button or spacer */}
        {showBackButton ? (
          <Link
            href={backPath}
            className="group flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-300 min-w-[44px] min-h-[44px] border border-white/10 hover:border-white/20"
          >
            <span className="text-xl group-hover:-translate-x-1 transition-transform">←</span>
            <span className="text-white/80 group-hover:text-white font-medium hidden md:inline">Home</span>
          </Link>
        ) : (
          // Balances the right-hand links on a wide screen. On a phone it
          // only took width from the title ("Hank's H..." at 375 px). The
          // link words, the title icon and this spacer wait for md: from
          // sm, a phone held sideways (667 px) cut "Hall of Fame".
          <div className="hidden w-20 md:block" />
        )}

        {/* Center: Title with icon. The icon hides below sm: (the page
            content carries its own identity there) and the title never
            wraps — a two-line header title crowded 390px phones. */}
        {title && (
          <div className="flex items-center gap-3 min-w-0">
            {titleIcon && (
              <span className="hidden md:inline text-3xl md:text-4xl animate-bounce-slow">
                {titleIcon}
              </span>
            )}
            <h1 className="text-xl md:text-2xl font-black text-yellow-300 whitespace-nowrap truncate">
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
            <span className="text-white/80 group-hover:text-white font-medium hidden md:inline">Trophies</span>
          </Link>
          <Link
            href="/leaderboards"
            aria-label="Leaderboards"
            className="group flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-300 min-w-[44px] min-h-[44px] border border-white/10 hover:border-white/20"
          >
            <span className="text-xl" aria-hidden="true">🏆</span>
            <span className="text-white/80 group-hover:text-white font-medium hidden md:inline">Leaderboards</span>
          </Link>
          {showLoginButton && <LoginButton />}
        </div>
      </div>
    </header>
  );
}

export default Header;
