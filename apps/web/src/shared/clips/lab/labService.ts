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
 *
 * INTEGRATION (plan 16, Wave C): the service (PR 2.4, service/ClipService.ts,
 * config.ts) is built at the same time as the lab and is not on this branch.
 * Until it merges, this function returns null and the lab page says that
 * clips are not on. When PR 2.4 is on the branch, replace the body with the
 * same load that ClipProvider does (defaultLoadService):
 *
 *   const { loadClipsVerdict } = await import("../config");
 *   const verdict = await loadClipsVerdict();
 *   if (!verdict.capture) return null;
 *   const { startClipService } = await import("../service/ClipService");
 *   return startClipService();
 *
 * Keep both imports dynamic: the capture runtime and the workers must load
 * only when clips are on (plan 4.1).
 */
import type { ClipServiceApi } from "../service/contract";

/** Loads the clip service. The lab calls it once, after the page mounts. */
export type LabServiceLoader = () => Promise<ClipServiceApi | null>;

export const loadLabService: LabServiceLoader = async () => null;
