// Shared input guards for games: one action per tap, a button that works
// for a second finger, a short lockout on restart input after the game
// changes state, and the presses that a control over the game may keep
// from it.
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
export {
  SECOND_FINGER_WAIT_MS,
  createSecondFingerClick,
  useSecondFingerClick,
} from "./useSecondFingerClick";
export type {
  SecondFingerClick,
  SecondFingerClickHandlers,
} from "./useSecondFingerClick";
export { createPressOwnership } from "./pressOwnership";
export type { PressOwnership } from "./pressOwnership";
