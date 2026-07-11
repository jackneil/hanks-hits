"use client";

import { useGameShell } from "../hooks/useGameShell";
import { PauseMenu } from "./PauseMenu";
import { LeaderboardButton } from "./LeaderboardButton";
import { FullscreenButton } from "./FullscreenButton";
import { hasLeaderboardSupport } from "@/lib/leaderboard-extractors";

interface GameShellProps {
  children: React.ReactNode;
  gameName: string;
  /** Optional appId - when provided, shows leaderboard button in header */
  appId?: string;
  canPause?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  showHomeButton?: boolean;
  showPauseButton?: boolean;
  pauseOnBlur?: boolean;
  headerClassName?: string;
  pauseMenuChildren?: React.ReactNode;
}

export function GameShell({
  children,
  gameName,
  appId,
  canPause = true,
  onPause,
  onResume,
  showHomeButton = true,
  showPauseButton = true,
  pauseOnBlur = true,
  headerClassName = "",
  pauseMenuChildren,
}: GameShellProps) {
  const { isPaused, resume, togglePause, goHome } = useGameShell({
    canPause,
    onPause,
    onResume,
    pauseOnBlur,
  });

  // Check if this game has leaderboard support
  const showLeaderboard = appId && hasLeaderboardSupport(appId);

  return (
    <div className="relative w-full h-full min-h-screen">
      {/* Header bar */}
      <div
        className={`fixed top-0 left-0 right-0 h-12 md:h-14 bg-black/70 backdrop-blur-md z-[1000] flex items-center justify-between px-3 md:px-4 ${headerClassName}`}
      >
        {/* Home button (spacer keeps the title balanced when hidden) */}
        {showHomeButton ? (
          <button
            onClick={goHome}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl hover:scale-110 transition-transform active:scale-95"
            aria-label="Back to games"
            title="Go Home"
          >
            🏠
          </button>
        ) : (
          <div className="w-11 shrink-0" />
        )}

        {/* Game name — a flex child between the clusters (not absolutely
            centered: a blind left-1/2 + max-w-[50%] title overlapped the
            three-button cluster on long names at 375px) */}
        <div className="flex-1 min-w-0 px-2 text-center text-white font-bold text-lg md:text-xl truncate">
          {gameName}
        </div>

        {/* Right side buttons */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Leaderboard button */}
          {showLeaderboard && (
            <LeaderboardButton appId={appId} variant="icon" />
          )}

          {/* Fullscreen lives IN the header row so it can never render
              underneath it (games used to float their own copy at top-4) */}
          <FullscreenButton variant="header" />

          {/* Pause button */}
          {showPauseButton && canPause && (
            <button
              onClick={togglePause}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl hover:scale-110 transition-transform active:scale-95"
              aria-label={isPaused ? "Resume game" : "Pause game"}
              title="Pause (ESC)"
            >
              ⏸️
            </button>
          )}
        </div>

        {/* No trailing spacer: the flex-1 title fills the space between the
            clusters, so a third flex child would just squeeze it (the old
            spacer pushed the fullscreen button into the middle of the bar,
            overlapping the then-absolutely-centered title — found by /qa). */}
      </div>

      {/* Game content - offset by header height */}
      <div className="pt-12 md:pt-14 w-full h-full">{children}</div>

      {/* Pause menu overlay */}
      {canPause && (
        <PauseMenu
          isOpen={isPaused}
          onResume={resume}
          onHome={goHome}
          gameName={gameName}
        >
          {/* Leaderboard button in pause menu */}
          {showLeaderboard && (
            <LeaderboardButton
              appId={appId}
              variant="full"
              className="w-full"
            />
          )}
          {pauseMenuChildren}
        </PauseMenu>
      )}
    </div>
  );
}
