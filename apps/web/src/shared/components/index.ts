// Auth components
export { AuthProvider } from "./AuthProvider";
export { LoginButton } from "./LoginButton";
export { GuestWarning } from "./GuestWarning";
export { SyncIndicator } from "./SyncIndicator";

// Mobile/Fullscreen components. The orientation tip (OrientationWarning)
// is not here on purpose: GameShell renders it from the game's metadata
// (preferredOrientation), and a game must not mount its own.
export { FullscreenButton } from "./FullscreenButton";
export { IOSInstallPrompt } from "./IOSInstallPrompt";
export { WebGLGate, WebGLFallback, detectWebGL } from "./WebGLGate";

// Game shell components
export { GameShell } from "./GameShell";
export { PauseMenu } from "./PauseMenu";
export { RestartConfirmationDialog } from "./RestartConfirmationDialog";
export { RestartGameButton } from "./RestartGameButton";
export { GameStartOverlay, GameStartOverlayButton } from "./GameStartOverlay";
export type { GameStartOverlayProps } from "./GameStartOverlay";
export { GameSheet, GAME_SHEET_ACTION } from "./GameSheet";
export type { GameSheetProps } from "./GameSheet";
export { ResultChip } from "./ResultChip";
export type { ResultChipProps } from "./ResultChip";
export { ReadAloudButton } from "./ReadAloudButton";

// Leaderboard components
export { Leaderboard } from "./Leaderboard";
export { LeaderboardModal } from "./LeaderboardModal";
export { LeaderboardButton } from "./LeaderboardButton";
