/**
 * Values-free failure logs for the clip surfaces (plan 12: "Failures log a
 * values-free reason").
 *
 * A line holds the action name and the error type only. It never holds a
 * clip id, a file name, a game id or any player data. It uses the same
 * console.warn and "[clips]" prefix as the service (service/share.ts), so a
 * worker crash and a normal failure can be told apart in the browser log.
 */

/** The error type, when it is a plain word. Anything else is "Error". */
export function errorName(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name) ? name : "Error";
}

/**
 * Log that a clip UI action failed. `action` must be a fixed word from the
 * code (for example "clip", "share", "delete"), never a value.
 */
export function logClipUiFailure(action: string, error?: unknown, detail?: string): void {
  const reason = detail ?? (error === undefined ? "no result" : errorName(error));
  try {
    console.warn(`[clips] ui: ${action} failed (${reason})`);
  } catch {
    // A console that throws must not break the tap.
  }
}
