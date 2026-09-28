/**
 * Clips runtime: main-thread capture machinery (plan 4.1, 6.2, 7, 5).
 * Nothing here reads window or navigator at import time.
 */
export {
  installRafDispatcher,
  hasRafDispatcher,
  type FrameHook,
  type InstallOptions,
  type RafDispatcher,
  type RafRealm,
} from "./rafDispatcher";
export {
  estimateDisplayHz,
  isLowPowerRate,
  measureDisplayHz,
  rungTable,
  snapHz,
  strideFor,
  RUNG_FLOOR_FPS,
  STANDARD_RATES,
  type Rung,
} from "./rungs";
export {
  FramePump,
  type CapturedPayload,
  type CaptureTicket,
  type FramePumpOptions,
  type FramePumpStats,
  type FrameSink,
} from "./framePump";
export {
  buildLadder,
  Governor,
  CLEAN_WINDOWS_TO_STEP_UP,
  LOW_POWER_KEEP_SECONDS,
  MAX_CAPTURE_SHARE,
  MAX_STEP_UPS,
  VIOLATIONS_TO_STEP_DOWN,
  WINDOW_MS,
  type GovernorDecision,
  type GovernorLevel,
  type GovernorOptions,
  type LevelKind,
  type PowerState,
  type PressureState,
  type ViolationReason,
  type WindowReport,
} from "./governor";
export { avcCodecString, avcLevelHex, profileOfCodec, PROFILE_ORDER, type AvcProfile } from "./avcLevel";
export {
  DEFAULT_TARGETS,
  runProbe,
  type ProbeEnv,
  type ProbeRequest,
  type ProbeResponse,
  type VideoAttempt,
  type VideoTarget,
  type WorkerProbeReport,
} from "./capabilityProbe";
export {
  bitrateFor,
  chooseVideoEncoder,
  memoryClassFor,
  probeCapabilities,
  probeCapabilityReport,
  probeWebGL2Readback,
  quickProbes,
  selectTier,
  CAPS_CACHE_ITEM,
  CACHE_MAX_AGE_MS,
  type CapabilityReport,
  type ContentKind,
  type EncoderPlan,
  type MemoryInput,
  type ProbeGlobals,
  type ProbeOptions,
  type TierInput,
  type WorkerLike,
} from "./capabilities";
