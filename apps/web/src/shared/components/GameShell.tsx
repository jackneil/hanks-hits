"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { useGameShell } from "../hooks/useGameShell";
import { useFullscreen } from "../hooks/useFullscreen";
import { PauseMenu } from "./PauseMenu";
import { LeaderboardButton } from "./LeaderboardButton";
import { FullscreenButton } from "./FullscreenButton";
import { LoginButton } from "./LoginButton";
import { RestartConfirmationDialog } from "./RestartConfirmationDialog";
import { RestartGameButton } from "./RestartGameButton";
import { hasLeaderboardSupport } from "@/lib/leaderboard-extractors";
import { GAME_METADATA } from "../lib/gameMetadata.generated";
import { useGameBreaks } from "../lib/gameBreaks";
import {
  planHeader,
  resolveHeaderEmoji,
  routeIdFromPath,
  type HeaderLogin,
} from "../lib/headerBudget";

export type RestartConfirmationPolicy = "always" | "never";

interface GameShellProps {
  children: React.ReactNode;
  gameName: string;
  /** Optional appId - when provided, shows leaderboard button in header */
  appId?: string;
  /**
   * The title emoji on narrow screens (below 480 px). Leave it out and the
   * shell uses the game's metadata icon (by appId, then by the route's
   * folder name, then by the game name).
   */
  emoji?: string;
  canPause?: boolean;
  onRestart?: () => void;
  restartConfirmation?: RestartConfirmationPolicy;
  restartConfirmationMessage?: string;
  onPause?: () => void;
  onResume?: () => void;
  showHomeButton?: boolean;
  showPauseButton?: boolean;
  /** Hide the sign-in control (e.g. on the login/signup pages themselves) */
  showLoginButton?: boolean;
  pauseOnBlur?: boolean;
  headerClassName?: string;
  pauseMenuChildren?: React.ReactNode;
  /**
   * The header slot for the clip button: a sized 44 px slot. Pass `true`
   * for an empty slot, or the clip button itself. Leave it out and the
   * header has no slot.
   */
  clipSlot?: React.ReactNode;
  /**
   * Set this when the game shows the shared result chip at game over.
   * Below 400 px, a game that can pause then moves Leaderboard and Restart
   * out of the header: the pause menu holds them during play and the
   * result chip holds them at game over. Without it they stay in the
   * header, so they are never out of reach.
   */
  resultChipReady?: boolean;
}

function subscribeToResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * The viewport width in CSS pixels, or null on the server. It matches the
 * width that CSS media queries use (window.innerWidth).
 */
function useViewportWidth(): number | null {
  return useSyncExternalStore(
    subscribeToResize,
    () => window.innerWidth,
    () => null
  );
}

function subscribeToHistory(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/**
 * The game or app id of the current route ("/apps/weather" gives
 * "weather"), or null on the server. It reads window.location, not
 * next/navigation, so every game test that mocks only useRouter keeps
 * working.
 */
function useRouteId(): string | null {
  return useSyncExternalStore(
    subscribeToHistory,
    () => routeIdFromPath(window.location.pathname),
    () => null
  );
}

const HEADER_BUTTON =
  "min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl hover:scale-110 transition-transform active:scale-95";

export function GameShell({
  children,
  gameName,
  appId,
  emoji,
  canPause = true,
  onRestart,
  restartConfirmation = "always",
  restartConfirmationMessage,
  onPause,
  onResume,
  showHomeButton = true,
  showPauseButton = true,
  showLoginButton = true,
  pauseOnBlur = true,
  headerClassName = "",
  pauseMenuChildren,
  clipSlot,
  resultChipReady = false,
}: GameShellProps) {
  const [isRestartConfirmationOpen, setIsRestartConfirmationOpen] = useState(false);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const { isPaused, resume, togglePause, goHome } = useGameShell({
    canPause,
    suppressEscape: isRestartConfirmationOpen,
    onPause,
    onResume,
    pauseOnBlur,
  });
  const { data: session, status } = useSession();
  const fullscreen = useFullscreen();
  const viewportWidth = useViewportWidth();
  const routeId = useRouteId();

  // Tell sheets and nudges that a game is on screen (gameBreaks.ts). A
  // layout effect runs before paint, so a nudge rendered in the same
  // commit never flashes over the game for one frame.
  const enterShell = useGameBreaks((s) => s.enterShell);
  const leaveShell = useGameBreaks((s) => s.leaveShell);
  useLayoutEffect(() => {
    enterShell();
    return leaveShell;
  }, [enterShell, leaveShell]);

  // Check if this game has leaderboard support
  const showLeaderboard = !!appId && hasLeaderboardSupport(appId);

  // What the game CAN do, not what it can do this second: many games turn
  // canPause off between runs and wire onPause/onResume, and the header
  // must not reflow when a run starts or ends.
  const pausable = canPause || !!onPause || !!onResume;
  const hasPauseSlot = showPauseButton && pausable;
  const hasClipSlot = clipSlot !== undefined && clipSlot !== null && clipSlot !== false;
  const titleEmoji = resolveHeaderEmoji(GAME_METADATA, { emoji, appId, routeId, gameName });
  // Mirrors LoginButton: a spinner while loading, the avatar when signed
  // in (both one 44 px control), and the Sign In button for a guest.
  const login: HeaderLogin = !showLoginButton
    ? "none"
    : status !== "loading" && !session?.user
      ? "guest"
      : "signedIn";

  // The server has no viewport: it renders the wide layout, and the
  // client corrects it on the first render after hydration.
  const layout = planHeader(viewportWidth ?? Number.POSITIVE_INFINITY, {
    home: true,
    leaderboard: showLeaderboard,
    fullscreen: !fullscreen.isPWA && (fullscreen.isIPhone || fullscreen.isSupported),
    restart: !!onRestart,
    pause: hasPauseSlot,
    clipSlot: hasClipSlot,
    login,
    pausable,
    resultChipReady,
    hasEmoji: !!titleEmoji,
  });

  return (
    <div className="relative w-full h-full min-h-screen">
      {/* Header bar. A solid background: the old backdrop-blur was a
          glassmorphism tell, and a backdrop-filter also becomes the
          containing block for position: fixed children, which trapped
          sheets opened from header buttons inside the 48 px bar. */}
      <div
        data-testid="game-shell-header"
        className={`fixed top-0 left-0 right-0 h-12 md:h-14 bg-slate-950 border-b border-white/10 z-[1000] flex items-center justify-between px-3 md:px-4 ${headerClassName}`}
      >
        {/* Home button (spacer keeps the title balanced when hidden) */}
        {showHomeButton ? (
          <button
            onClick={goHome}
            className={HEADER_BUTTON}
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
            three-button cluster on long names at 375px). Below 480 px it
            is the game's emoji; the full name stays the accessible name. */}
        {layout.title === "text" && (
          <div className="flex-1 min-w-0 px-2 text-center text-white font-bold text-lg md:text-xl truncate">
            {gameName}
          </div>
        )}
        {layout.title === "emoji" && (
          <div className="flex-1 min-w-0 px-2 flex items-center justify-center">
            <span
              role="img"
              aria-label={gameName}
              title={gameName}
              className="text-2xl leading-none"
            >
              {titleEmoji}
            </span>
          </div>
        )}
        {layout.title === "screenReaderOnly" && (
          <div className="flex-1 min-w-0">
            <span className="sr-only">{gameName}</span>
          </div>
        )}

        {/* Right side buttons */}
        <div
          data-testid="game-shell-controls"
          className={`flex shrink-0 items-center ${layout.compactGap ? "gap-0" : "gap-1"}`}
        >
          {/* Leaderboard button */}
          {showLeaderboard && layout.leaderboard === "header" && (
            <LeaderboardButton appId={appId} variant="icon" />
          )}

          {/* Fullscreen lives IN the header row so it can never render
              underneath it (games used to float their own copy at top-4) */}
          {layout.fullscreen !== "moved" && <FullscreenButton variant="header" />}

          {/* Restart button */}
          {onRestart && layout.restart === "header" && (
            <RestartGameButton
              ref={restartTriggerRef}
              onClick={() => {
                if (restartConfirmation === "never") {
                  onRestart();
                } else {
                  setIsRestartConfirmationOpen(true);
                }
              }}
            />
          )}

          {/* Clip button slot: one sized slot for every clip state */}
          {hasClipSlot && (
            <div
              data-testid="header-clip-slot"
              className="w-11 h-11 shrink-0 flex items-center justify-center"
            >
              {clipSlot === true ? null : clipSlot}
            </div>
          )}

          {/* Pause button. Between runs its slot stays reserved, so the
              controls beside it do not jump when a run starts or ends. */}
          {hasPauseSlot &&
            (canPause ? (
              <button
                onClick={togglePause}
                className={HEADER_BUTTON}
                aria-label={isPaused ? "Resume game" : "Pause game"}
                title="Pause (ESC)"
              >
                ⏸️
              </button>
            ) : (
              <div
                data-testid="header-pause-placeholder"
                aria-hidden="true"
                className="w-11 h-11 shrink-0"
              />
            ))}

          {/* Login (rightmost, matches the page Header): Sign In for guests,
              avatar dropdown for signed-in users. Same control everywhere. */}
          {showLoginButton && <LoginButton showLabelOnMobile={layout.signInLabel} />}
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
          onRestart={onRestart}
          restartConfirmation={restartConfirmation}
          restartConfirmationMessage={restartConfirmationMessage}
          gameName={gameName}
        >
          {/* The menu reads every button here out loud, in this order */}
          {showLeaderboard && (
            <LeaderboardButton
              appId={appId}
              variant="full"
              className="w-full"
            />
          )}
          {layout.fullscreen === "moved" && <FullscreenButton variant="menu" />}
          {pauseMenuChildren}
        </PauseMenu>
      )}

      <RestartConfirmationDialog
        isOpen={isRestartConfirmationOpen}
        gameName={gameName}
        message={restartConfirmationMessage}
        triggerRef={restartTriggerRef}
        onCancel={() => setIsRestartConfirmationOpen(false)}
        onConfirm={() => {
          setIsRestartConfirmationOpen(false);
          onRestart?.();
          if (isPaused) resume();
        }}
      />
    </div>
  );
}
