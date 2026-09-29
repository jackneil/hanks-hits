/**
 * The messages between the Retro Arcade page and the emulator page
 * (public/emulator/index.html). Both pages are on this site. The parent
 * accepts a message only from the window of its own emulator iframe.
 *
 * Emulator to parent:
 * - ready: the game started.
 * - saveState: the kid pressed Save State. `state` holds the bytes.
 * - saveStateFailed: the emulator could not make a state.
 * - requestLoadState: the kid pressed Load State.
 * - capturedState: the answer to captureState. `state` is null on failure.
 * - stateLoaded / stateLoadFailed: the answer to loadState.
 * - emulator-exit: the kid pressed the Exit button of EmulatorJS.
 *
 * Parent to emulator:
 * - loadState: load `state`. `reason` comes back in the answer.
 * - captureState: send the current state (for the "auto" slot).
 *
 * A state is an ArrayBuffer that moves with a transfer list, so a 16 MB
 * state is not copied.
 */

export type LoadReason = "resume" | "manual";

export type EmulatorMessage =
  | { type: "ready" }
  | { type: "saveState"; state: ArrayBuffer }
  | { type: "saveStateFailed" }
  | { type: "requestLoadState" }
  | { type: "capturedState"; requestId: number; state: ArrayBuffer | null }
  | { type: "stateLoaded"; reason: LoadReason }
  | { type: "stateLoadFailed"; reason: LoadReason }
  | { type: "emulator-exit" };

export type ParentMessage =
  | { type: "loadState"; state: ArrayBuffer; reason: LoadReason }
  | { type: "captureState"; requestId: number };

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function reasonOf(value: unknown): LoadReason {
  return value === "resume" ? "resume" : "manual";
}

/** Reads a message from the emulator page. Returns null for anything else. */
export function parseEmulatorMessage(data: unknown): EmulatorMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case "ready":
    case "saveStateFailed":
    case "requestLoadState":
    case "emulator-exit":
      return { type: message.type };
    case "saveState":
      // An empty state is a failed save, not a save.
      if (!isArrayBuffer(message.state) || message.state.byteLength === 0) {
        return { type: "saveStateFailed" };
      }
      return { type: "saveState", state: message.state };
    case "capturedState": {
      if (typeof message.requestId !== "number") return null;
      const state =
        isArrayBuffer(message.state) && message.state.byteLength > 0 ? message.state : null;
      return { type: "capturedState", requestId: message.requestId, state };
    }
    case "stateLoaded":
    case "stateLoadFailed":
      return { type: message.type, reason: reasonOf(message.reason) };
    default:
      return null;
  }
}

/** The words that the kid sees about saves. Simple English for young readers. */
export const SAVE_MESSAGES = {
  saved: "Saved! 💾",
  loaded: "Loaded your save!",
  resumed: "Welcome back! This is where you stopped.",
  noSave: "No save yet. Tap Save State first.",
  didNotFit: "Your save did not fit. Try deleting an old game save.",
  saveFailed: "We could not save right now. Try again.",
  loadFailed: "We could not load your save. Try again.",
} as const;
