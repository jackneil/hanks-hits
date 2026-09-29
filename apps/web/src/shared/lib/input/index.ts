// Shared input guards for games: one action per tap, and a short lockout
// on restart input after the game changes state.
export {
  COMPAT_CLICK_WINDOW_MS,
  createPointerTap,
  usePointerTap,
} from "./usePointerTap";
export type {
  PointerTap,
  PointerTapHandlers,
  PointerTapOptions,
  TapEvent,
} from "./usePointerTap";
export {
  DEFAULT_RESTART_GRACE_MS,
  createRestartGrace,
  useRestartGrace,
} from "./useRestartGrace";
export type { GraceInput, RestartGrace } from "./useRestartGrace";
