/**
 * Clips sources: take frames from a game's canvas (plan 3a, 6.1).
 * Nothing here reads window or navigator at import time.
 */
export {
  registerCanvasSource,
  BASELINE_WARMUP_MS,
  MAX_CONSECUTIVE_ERRORS,
  type CanvasSource,
  type CanvasSourceOptions,
  type CaptureCostSample,
  type ReadbackSignal,
} from "./canvasSource";
export {
  installCanvasActivity,
  pathForContextType,
  DRAW_CALLS_2D,
  DRAW_CALLS_EXTENSIONS,
  DRAW_CALLS_GL,
  DRAW_CALLS_GL2,
  type ActivityRealm,
  type CanvasActivity,
  type CanvasRecord,
  type ContextType,
} from "./canvasActivity";
export {
  autoDiscover,
  candidateCanvases,
  findLargestCanvas,
  IGNORE_ATTRIBUTE,
  type AutoDiscoverOptions,
  type AutoDiscovery,
} from "./autoDiscover";
export {
  PathEReader,
  readbackSize,
  type KickResult,
  type PathEOptions,
  type PathEPoll,
  type PathEReadback,
} from "./pathE";
