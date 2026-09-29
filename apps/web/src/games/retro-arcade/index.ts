// Retro Arcade Game - Main exports
// Self-contained game module for EmulatorJS-based retro gaming

export { RetroArcadeGame, default } from "./Game";
export { useRetroArcadeStore } from "./lib/store";
export type {
  RetroArcadeProgress,
  RecentGame,
  CustomRom,
  ArcadeSettings,
  PlayStats,
} from "./lib/store";
export type { SaveSlot, SavedGame } from "./lib/saveStates";
export type { SystemType, SystemInfo, GameInfo } from "./lib/constants";
export {
  SYSTEMS,
  SYSTEM_IDS,
  SAMPLE_GAMES,
  getGamesForSystem,
  isValidRomFile,
  getSystem,
} from "./lib/constants";
