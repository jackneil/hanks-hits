/**
 * The seam between the clips lab and the clip service implementation.
 *
 * The lab uses only the service contract (service/contract.ts): it attaches
 * with ClipServiceApi.attach, registers its canvas with
 * AttachedGame.registerCanvas, and clips with clipLast, startRecording,
 * stopRecording and library.file. That is the same public API that every
 * clip surface uses, so the lab exercises the full stack: flag, service,
 * capture runtime, encode worker, io worker and library.
 *
 * This function gives the tab's clip service, or null when clips are off.
 * It does the same load that ClipProvider does (defaultLoadService): it
 * reads the clips flag, and when the flag turns capture on, it starts the
 * tab's ClipService.
 *
 * Both imports are dynamic: the capture runtime and the workers must load
 * only when clips are on (plan 4.1).
 */
import type { ClipServiceApi } from "../service/contract";

/** Loads the clip service. The lab calls it once, after the page mounts. */
export type LabServiceLoader = () => Promise<ClipServiceApi | null>;

export const loadLabService: LabServiceLoader = async () => {
  const { loadClipsVerdict } = await import("../config");
  const verdict = await loadClipsVerdict();
  if (!verdict.capture) return null;
  const { startClipService } = await import("../service/ClipService");
  return startClipService();
};
