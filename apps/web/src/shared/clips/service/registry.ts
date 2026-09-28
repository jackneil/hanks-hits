/**
 * The tab's clip service reference, in a module with no imports, so the
 * public barrel can export getClipService() without pulling the service code
 * into every page. ClipService.ts sets it when ClipProvider starts the
 * service (after the flag verdict), with a dynamic import.
 */

import type { ClipServiceApi } from "./contract";

let current: ClipServiceApi | null = null;

/** The tab's clip service, or null: on the server, while clips are off, and before a clip-enabled game mounts. */
export function getClipService(): ClipServiceApi | null {
  return current;
}

/** @internal ClipService.ts only. */
export function setClipService(service: ClipServiceApi | null): void {
  current = service;
}
