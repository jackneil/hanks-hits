// Trophy Case — cross-game achievements engine (shared: every game/app rides it)

export {
  getAchievementInfo,
  catalogFor,
  type AchievementInfo,
  PLAYS_TIERS,
  STREAK_TIERS,
  EXPLORER_TIERS,
  RECORD_TIERS,
} from "./definitions";
export { evaluate, emptyWatermarks, type Watermarks } from "./evaluate";
export {
  useAchievementsStore,
  reportProgressToAchievements,
  type AchievementsProgress,
} from "./store";
