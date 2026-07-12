// Trophy Case — cross-game achievements engine (shared: every game/app rides it)
// Public surface only; internals (evaluate, tier tables) import from their
// submodules directly (tests do the same).

export {
  getAchievementInfo,
  appCatalog,
  globalCatalog,
  type AchievementInfo,
} from "./definitions";
export {
  useAchievementsStore,
  reportProgressToAchievements,
  type AchievementsProgress,
} from "./store";
