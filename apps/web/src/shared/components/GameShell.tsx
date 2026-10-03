"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { useGameShell } from "../hooks/useGameShell";
import { useFullscreen } from "../hooks/useFullscreen";
import { PlayBoxContext } from "../hooks/usePlayBox";
import { ShellHoldContext } from "../hooks/useShellHold";
import { useShellOverlayOpen } from "../lib/shellOverlays";
import { OrientationWarning, preferredOrientationFor } from "./OrientationWarning";
import { PauseMenu } from "./PauseMenu";
import { ShellSheetActionsContext } from "./shellSheetActions";
import { LeaderboardButton } from "./LeaderboardButton";
import { ClipShellScope, useClipHeaderSlot, useClipShellUi } from "@/shared/clips";
import { FullscreenButton } from "./FullscreenButton";
import { LoginButton } from "./LoginButton";
import { RestartConfirmationDialog } from "./RestartConfirmationDialog";
import { RestartGameButton } from "./RestartGameButton";
import { isGameVideoGame } from "@/lib/game-video-games";
import dynamic from "next/dynamic";
const ShareGameplayButton = dynamic(() => import("@/shared/clips/ui/ShareGameplayButton").then((module) => module.ShareGameplayButton), { loading: () => <span role="status" className="px-3 text-sm">Loading sharing...</span> });
import { GAME_METADATA } from "../lib/gameMetadata.generated";
import { shellHasPlay, useGameBreaks } from "../lib/gameBreaks";
import {
  isPhoneScreen,
  planHeader,
  resolveHeaderEmoji,
  routeIdFromPath,
  type HeaderLogin,
} from "../lib/headerBudget";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useSecondFingerClick } from "../lib/input";

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
  /**
   * The first shell overlay opened over the game: the restart question,
   * the leaderboard, the install steps, a clip sheet, the orientation tip,
   * or the tab went hidden. A game with onPause hears onPause too (once),
   * when it can pause. A game that runs its own loop and cannot pause (no
   * pause menu) reads `useShellHold()` instead (the same hold, as a
   * boolean in ShellHoldContext) and stands still while it is true, so no
   * game time passes under the overlay.
   */
  onShellOverlayOpen?: () => void;
  /** The last shell overlay closed (or the tab came back). */
  onShellOverlayClose?: () => void;
  /**
   * The game has its own pause screen on GameSheet with `shellActions`
   * (no shell pause menu). With `inPlay`, a phone moves Leaderboard and
   * Sign In off the header into that sheet during play, as it does for the
   * shell pause menu.
   */
  ownPauseSheet?: boolean;
  /** A run is live (for a game with ownPauseSheet; the shell cannot know). */
  inPlay?: boolean;
  showHomeButton?: boolean;
  showPauseButton?: boolean;
  /** Hide the sign-in control (e.g. on the login/signup pages themselves) */
  showLoginButton?: boolean;
  pauseOnBlur?: boolean;
  headerClassName?: string;
  pauseMenuChildren?: React.ReactNode;
  /**
   * Reserve the header's clip slot (44 px) with nothing in it. Only the
   * header layout tests use it. A clip-enabled game passes nothing: when its
   * clips are on, GameShell puts the clip button in this slot itself (plan
   * 11.2, through the shell mount in ClipShellScope).
   */
  clipSlot?: boolean;
  /**
   * Set this only when BOTH are true: the game shows the shared result chip
   * at game over, AND every other screen between runs (the start card, a
   * level or wave card) opens the pause menu. Below 400 px, a game that can
   * pause then moves Leaderboard and Restart out of the header: the pause
   * menu holds them on every screen but game over, and the result chip
   * holds them at game over. A game whose start card or level card cannot
   * pause (Asteroids) leaves it off, or those screens have neither control.
   * Without it both stay in the header, so they are never out of reach.
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

/** The viewport height in CSS pixels, or null on the server. */
function useViewportHeight(): number | null {
  return useSyncExternalStore(
    subscribeToResize,
    () => window.innerHeight,
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

// touch-manipulation: a double tap on a header button must never zoom the
// page (only DaisyUI's .btn had touch-action before; these are plain buttons).
const HEADER_BUTTON =
  "min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl hover:scale-110 transition-transform active:scale-95 touch-manipulation";

/**
 * The header bar: --shell-header-h in globals.css, 48 px, and 44 px on a
 * short screen (a phone held sideways, the short: variant). Never keyed on
 * the width: an 844 px wide phone held sideways is not a tablet.
 */
export const HEADER_HEIGHT_CLASSES = "h-[var(--shell-header-h)]";

/**
 * The play box: the screen under the header, in dvh, so it is the real
 * screen with the iOS toolbars in or out (usePlayBox.ts). It scrolls when
 * a game is taller than the screen; the page itself never scrolls. While
 * a game fits itself to the box (usePlayBox({ fit: true })), the box does
 * not scroll and a touch on it goes to the game, not to the browser. No
 * text in it can be selected or long-pressed into the iOS callout. When a
 * bottom sheet shows (bottomSheetSpace.ts), the box ends above it.
 */
export const PLAY_BOX_CLASSES =
  "relative w-full h-[calc(100dvh-var(--shell-header-h)-var(--bottom-sheet-space,0px))] overflow-y-auto overscroll-contain select-none [-webkit-touch-callout:none] data-[fitted]:overflow-hidden data-[fitted]:touch-none";

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
  onShellOverlayOpen,
  onShellOverlayClose,
  ownPauseSheet = false,
  inPlay = false,
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
  const { isPaused, isHeld, pause, resume, togglePause, goHome, hold, release } = useGameShell({
    canPause,
    suppressEscape: isRestartConfirmationOpen,
    onPause,
    onResume,
    pauseOnBlur,
    onShellOverlayOpen,
    onShellOverlayClose,
  });

  // Hold the game while any shell overlay is open (shellOverlays.ts): the
  // restart question, the leaderboard, the install steps, a clip sheet or
  // the orientation tip. The game hears onPause (no menu) or, with no
  // pause, onShellOverlayOpen; and the reverse when the last one closes.
  const overlayOpen = useShellOverlayOpen();
  useEffect(() => {
    if (overlayOpen) hold(SHELL_OVERLAY_HOLD);
    else release(SHELL_OVERLAY_HOLD);
  }, [overlayOpen, hold, release]);
  // A restart from the question: let the old run go BEFORE the restart, so
  // no resume reaches the new run after it started.
  const releaseShellOverlay = useCallback(() => release(SHELL_OVERLAY_HOLD), [release]);

  return (
    // The hold, as a boolean, for a game that runs its own loop
    // (useShellHold.ts). Above ClipShellScope: the clip sheets count
    // themselves in shellOverlays.ts, and the value comes from the same
    // useGameShell that hears them.
    <ShellHoldContext.Provider value={isHeld}>
      {/* Gameplay clips (plan 4.1): only the clip service and the clip UI
          are gated on the metadata literal clips: true (and, for the UI,
          on the flag turning capture on). The shell itself is the same for
          every game: the plan 11.2 header work (the solid header, the
          emoji title below 480 px, the white restart glyph, the width
          budget), the moved toast and the start-card and pause-menu parts
          change every GameShell route, with or without clips. */}
      <ClipShellScope appId={appId} gameName={gameName} canPause={canPause} paused={isPaused} pause={pause} resume={resume}>
        <GameShellFrame
          gameName={gameName}
          appId={appId}
          emoji={emoji}
          canPause={canPause}
          onRestart={onRestart}
          restartConfirmation={restartConfirmation}
          restartConfirmationMessage={restartConfirmationMessage}
          onPause={onPause}
          onResume={onResume}
          showHomeButton={showHomeButton}
          showPauseButton={showPauseButton}
          showLoginButton={showLoginButton}
          headerClassName={headerClassName}
          pauseMenuChildren={pauseMenuChildren}
          clipSlot={clipSlot}
          resultChipReady={resultChipReady}
          ownPauseSheet={ownPauseSheet}
          inPlay={inPlay}
          isPaused={isPaused}
          resume={resume}
          togglePause={togglePause}
          goHome={goHome}
          isRestartConfirmationOpen={isRestartConfirmationOpen}
          setIsRestartConfirmationOpen={setIsRestartConfirmationOpen}
          releaseShellOverlay={releaseShellOverlay}
        >
          {children}
        </GameShellFrame>
      </ClipShellScope>
    </ShellHoldContext.Provider>
  );
}

/** The hold that GameShell puts on the game while a shell overlay is open. */
const SHELL_OVERLAY_HOLD = "shell-overlay";

interface GameShellFrameProps
  extends Omit<
    GameShellProps,
    "pauseOnBlur" | "restartConfirmation" | "resultChipReady" | "onShellOverlayOpen" | "onShellOverlayClose"
  > {
  restartConfirmation: RestartConfirmationPolicy;
  resultChipReady: boolean;
  isPaused: boolean;
  resume: () => void;
  togglePause: () => void;
  goHome: () => void;
  isRestartConfirmationOpen: boolean;
  setIsRestartConfirmationOpen: (open: boolean) => void;
  /** Lets the game go from the restart question's hold, before onRestart. */
  releaseShellOverlay: () => void;
}

/**
 * The header, the game and the pause menu. It renders INSIDE ClipShellScope,
 * so it can read the clip UI parts (useClipShellUi) of a clip-enabled game.
 */
function GameShellFrame({
  children,
  gameName,
  appId,
  emoji,
  canPause = true,
  onRestart,
  restartConfirmation,
  restartConfirmationMessage,
  onPause,
  onResume,
  showHomeButton = true,
  showPauseButton = true,
  showLoginButton = true,
  headerClassName = "",
  pauseMenuChildren,
  clipSlot,
  resultChipReady,
  ownPauseSheet = false,
  inPlay = false,
  isPaused,
  resume,
  togglePause,
  goHome,
  isRestartConfirmationOpen,
  setIsRestartConfirmationOpen,
  releaseShellOverlay,
}: GameShellFrameProps) {
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const playBoxRef = useRef<HTMLDivElement>(null);
  // The clip UI parts, or null: no clip-enabled game, clips off, or not loaded yet.
  const clip = useClipShellUi();
  const clipButtonShown = useClipHeaderSlot();
  const { data: session, status } = useSession();
  const fullscreen = useFullscreen();
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();
  const isCoarse = useCoarsePointer();
  const routeId = useRouteId();
  // Pause works for a tap by the other thumb while one thumb holds a pedal
  // or FIRE (a browser makes no click for a second finger).
  const pauseTap = useSecondFingerClick<HTMLButtonElement>(togglePause);

  // Tell sheets and nudges that a game is on screen (gameBreaks.ts). A
  // layout effect runs before paint, so a nudge rendered in the same
  // commit never flashes over the game for one frame. An app page (under
  // /apps/) has no play to cover, so it does not count.
  const enterShell = useGameBreaks((s) => s.enterShell);
  const leaveShell = useGameBreaks((s) => s.leaveShell);
  useLayoutEffect(() => {
    if (!shellHasPlay(window.location.pathname)) return;
    enterShell();
    return leaveShell;
  }, [enterShell, leaveShell]);

  // Check if this game has leaderboard support
  const showLeaderboard = !!appId && isGameVideoGame(appId);

  // What the game CAN do, not what it can do this second: many games turn
  // canPause off between runs and wire onPause/onResume, and the header
  // must not reflow when a run starts or ends.
  const canEverPause = canPause || !!onPause || !!onResume;
  // The header budget may move controls into the pause menu only when the
  // kid can open that menu by touch, which needs the pause button.
  const hasPauseSlot = showPauseButton && canEverPause;
  // The clip button takes the slot while the clip UI shows one (plan 11.2).
  // The header tests reserve an empty slot with clipSlot.
  const clipButton = clip && clipButtonShown ? <clip.ClipButton /> : null;
  const hasClipSlot = clipButton !== null || clipSlot === true;
  const titleEmoji = resolveHeaderEmoji(GAME_METADATA, { emoji, appId, routeId, gameName });
  // The orientation tip, for a game whose metadata declares an orientation.
  // Rendered here, above the game: a game's own tree may be keyed and
  // remount on each restart, and the tip must not come back with it.
  const preferredOrientation = preferredOrientationFor(GAME_METADATA, { appId, routeId });
  const orientationGameId = appId ?? routeId ?? gameName;
  // Mirrors LoginButton: a spinner while loading, the avatar when signed
  // in (both one 44 px control), and the Sign In button for a guest.
  const login: HeaderLogin = !showLoginButton
    ? "none"
    : status !== "loading" && !session?.user
      ? "guest"
      : "signedIn";

  // A phone with a touch screen, during play: the pause menu is one tap
  // away, so it holds Leaderboard and Sign In (headerBudget.ts, step 0).
  // "During play" is canPause: a run is live. Between runs (the start
  // card, game over) both stay in the header.
  const phonePlay =
    isCoarse &&
    viewportWidth !== null &&
    viewportHeight !== null &&
    isPhoneScreen(viewportWidth, viewportHeight) &&
    ((hasPauseSlot && canPause) || (ownPauseSheet && inPlay));

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
    pausable: hasPauseSlot,
    resultChipReady,
    hasEmoji: !!titleEmoji,
    phonePlay,
    ownPauseSheet,
  });

  // A game with its own pause sheet shows the moved controls there
  // (GameSheet with shellActions); the shell pause menu shows its own.
  const sheetActions =
    ownPauseSheet && (layout.leaderboard === "moved" || layout.signIn === "moved") ? (
      <>
        {showLeaderboard && layout.leaderboard === "moved" && (
          <LeaderboardButton appId={appId} variant="full" className="w-full" />
        )}
        {layout.signIn === "moved" && <LoginButton variant="menu" />}
      </>
    ) : null;

  // dvh, not min-h-screen: 100vh is taller than an iPhone screen with the
  // Safari toolbars shown, so the page scrolled on every route. The header
  // room (pt) plus the play box is exactly one screen. A bottom sheet (the
  // install tip on an app page, bottomSheetSpace.ts) gets its room from
  // the body's padding-bottom, so the root leaves that much out: a full
  // 100dvh root plus the padding made every app route 232 px taller than
  // the screen, and the play box slid under the header.
  return (
    <ShellSheetActionsContext.Provider value={sheetActions}>
      <div className="relative w-full min-h-[calc(100dvh-var(--bottom-sheet-space,0px))] pt-[var(--shell-header-h)]" style={showLeaderboard ? { paddingTop: "calc(var(--shell-header-h) + 44px)" } : undefined}>
        {/* Header bar. A solid background: the old backdrop-blur was a
            glassmorphism tell, and a backdrop-filter also becomes the
            containing block for position: fixed children, which trapped
            sheets opened from header buttons inside the 48 px bar. */}
        <div
          data-testid="game-shell-header"
          className={`fixed top-0 left-0 right-0 ${HEADER_HEIGHT_CLASSES} bg-slate-950 border-b border-white/10 z-[1000] flex items-center justify-between px-3 md:px-4 ${headerClassName}`}
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
          {/* Every title region is `relative`: the clip confirmation (plan
              11.1, z-1000 like the header) lies over the title, never over a
              control, and takes no taps. */}
          {layout.title === "text" && (
            <div className="relative flex-1 min-w-0 px-2 text-center text-white font-bold text-lg md:text-xl truncate">
              {gameName}
              {clip && <clip.InPlayConfirm />}
            </div>
          )}
          {(layout.title === "emoji" || layout.title === "emojiTight") && (
            <div
              data-testid="header-title"
              className={`relative flex-1 min-w-0 flex items-center justify-center ${
                layout.title === "emoji" ? "px-2" : ""
              }`}
            >
              {/* The tight title drops the padding and uses a smaller glyph,
                  so it stays visible on the narrowest phones (step 6). */}
              <span
                role="img"
                aria-label={gameName}
                title={gameName}
                className={`${layout.title === "emoji" ? "text-2xl" : "text-xl"} leading-none`}
              >
                {titleEmoji}
              </span>
              {clip && <clip.InPlayConfirm />}
            </div>
          )}
          {layout.title === "screenReaderOnly" && (
            <div className="relative flex-1 min-w-0">
              <span className="sr-only">{gameName}</span>
              {clip && <clip.InPlayConfirm />}
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
                {clipButton}
              </div>
            )}

            {/* Pause button. Between runs its slot stays reserved, so the
                controls beside it do not jump when a run starts or ends. */}
            {hasPauseSlot &&
              (canPause ? (
                <button
                  type="button"
                  {...pauseTap}
                  className={HEADER_BUTTON}
                  aria-label={isPaused ? "Resume game" : "Pause game"}
                  title="Pause (ESC)"
                >
                  ⏸️
                </button>
              ) : layout.fullscreen === "moved" ? (
                // Between runs there is no pause menu to hold Fullscreen
                // (step 5), so it takes the free pause slot. Same 44 px, so
                // nothing moves when the run starts and Pause comes back.
                <div
                  data-testid="header-pause-slot-fullscreen"
                  className="w-11 h-11 shrink-0 flex items-center justify-center"
                >
                  <FullscreenButton variant="header" />
                </div>
              ) : (
                <div
                  data-testid="header-pause-placeholder"
                  aria-hidden="true"
                  className="w-11 h-11 shrink-0"
                />
              ))}

            {/* Login (rightmost, matches the page Header): Sign In for guests,
                avatar dropdown for signed-in users. Same control everywhere.
                On a phone during play the guest Sign In is in the pause menu. */}
            {showLoginButton && layout.signIn !== "moved" && (
              <LoginButton showLabelOnMobile={layout.signInLabel} />
            )}
          </div>

          {/* No trailing spacer: the flex-1 title fills the space between the
              clusters, so a third flex child would just squeeze it (the old
              spacer pushed the fullscreen button into the middle of the bar,
              overlapping the then-absolutely-centered title — found by /qa). */}
        </div>

        {showLeaderboard && <div data-testid="game-share-bar" className="fixed inset-x-0 top-[var(--shell-header-h)] z-[1000] flex h-11 items-center justify-center gap-2 border-b border-white/10 bg-slate-950 px-2 text-white">
          <ShareGameplayButton className="btn-ghost text-sm" />
          <LeaderboardButton appId={appId} variant="full" className="text-sm shadow-none" />
        </div>}

        {/* The orientation tip: once per session, never over the start card,
            and the game is held while it shows (OrientationWarning.tsx). */}
        {preferredOrientation && (
          <OrientationWarning preferred={preferredOrientation} gameId={orientationGameId} />
        )}

        {/* The play box: the screen under the header (PLAY_BOX_CLASSES). */}
        <PlayBoxContext.Provider value={playBoxRef}>
          <div ref={playBoxRef} data-play-box="" data-testid="game-shell-play-box" className={PLAY_BOX_CLASSES} style={showLeaderboard ? { height: "calc(100dvh - var(--shell-header-h) - 44px - var(--bottom-sheet-space,0px))" } : undefined}>
            {children}
          </div>
        </PlayBoxContext.Provider>

        {/* The in-play toast slot (plan 11.4): the new-clip chip, the Record
            pill and tap replies, directly under the header. It portals to
            document.body at z-1050. */}
        {clip && <clip.ToastSlot />}

        {/* Pause menu overlay */}
        {canPause && (
          <PauseMenu
            isOpen={isPaused}
            onResume={resume}
            onHome={goHome}
            onRestart={onRestart}
            onRestartConfirmed={() => {
              // The same order as the header's question: let the old run go
              // (the question's hold, then the menu), THEN restart, so no
              // resume reaches the new run after it started.
              releaseShellOverlay();
              resume();
              onRestart?.();
            }}
            restartConfirmation={restartConfirmation}
            restartConfirmationMessage={restartConfirmationMessage}
            gameName={gameName}
          >
            {/* The menu reads every button here out loud, in this order
                (PauseMenu reads the visible label of each child button, so
                the "Clips" entry is spoken too, plan 11.4) */}
            {showLeaderboard && <ShareGameplayButton className="btn-lg w-full" />}
            {showLeaderboard && (
              <LeaderboardButton
                appId={appId}
                variant="full"
                className="w-full"
              />
            )}
            {layout.fullscreen === "moved" && <FullscreenButton variant="menu" />}
            {layout.signIn === "moved" && <LoginButton variant="menu" />}
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
            // The question held the game: let the old run go first, so the
            // new run never hears a resume after it started.
            releaseShellOverlay();
            setIsRestartConfirmationOpen(false);
            onRestart?.();
            if (isPaused) resume();
          }}
        />
      </div>
    </ShellSheetActionsContext.Provider>
  );
}
