/**
 * Gameplay clips: the public barrel (plan 4.1).
 *
 * Import clip features from "@/shared/clips" only. Everything here is safe to
 * import on the server and on pages with clips off: nothing touches window,
 * document or navigator at import time, and no worker, mediabunny or WASM code
 * is reached. The service, the capture runtime and the workers load later,
 * with dynamic imports, when a clip-enabled game mounts and the flag says on.
 */

export { ClipProvider, clipsEnabledFor, useClipSource, type ClipProviderProps, type ClipSourceOptions } from "./service/ClipProvider";
export { AttachedGameContext, ClipServiceContext, useAttachedGame, useClipService, useClipSnapshot } from "./service/context";
export {
  DEFAULT_CLIP_SECONDS,
  EXTEND_WINDOW_MS,
  HIDDEN_SNAPSHOT,
  HOLD_FOR_MENU_MS,
  MIN_CLIP_SECONDS,
  type AttachedGame,
  type ClipActionResult,
  type ClipButtonState,
  type ClipLibraryApi,
  type ClipReasonCode,
  type ClipServiceApi,
  type ClipSnapshot,
  type EngineState,
  type GameAttachment,
  type PressOutcome,
  type PressToken,
  type SaveOutcome,
  type ShareOutcome,
} from "./service/contract";
export { getClipService } from "./service/registry";
export { getClipLibrary } from "./service/ioClient";
export { fileNameFor } from "./service/share";
export { loadClipsVerdict, type ClipsMode, type ClipsVerdict } from "./config";
export type { ClipKind, ClipRecord, MomentMark, RunPhase, Tier } from "./protocol";
