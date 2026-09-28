/**
 * Clips sources: take frames from a game's canvas (plan 3a, 6.1).
 * Nothing here reads window or navigator at import time.
 */
export {
  detectCapturePath,
  registerCanvasSource,
  MAX_CONSECUTIVE_ERRORS,
  type CanvasSource,
  type CanvasSourceOptions,
} from "./canvasSource";
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
