/**
 * The pure input reducer.
 *
 * Keyboard, touch buttons and phone tilt all become the same `ControlValues`,
 * so a test can prove that pressing W and holding GAS drive the ATV the same
 * way. Nothing here touches the window or React: `hooks/useControls.ts` owns
 * the listeners and calls into this file.
 */

export type ControlValues = {
  /** -1 full reverse, 0 coasting, 1 full throttle. */
  throttle: number;
  /** -1 hard left, 0 straight, 1 hard right. */
  steer: number;
  /** 1 while the brake is held. */
  brake: number;
  handbrake: boolean;
  jump: boolean;
  horn: boolean;
  reset: boolean;
  camera: boolean;
  interact: boolean;
  nos: boolean;
};

export const NEUTRAL: ControlValues = {
  throttle: 0,
  steer: 0,
  brake: 0,
  handbrake: false,
  jump: false,
  horn: false,
  reset: false,
  camera: false,
  interact: false,
  nos: false,
};

/**
 * The actions that happen once per press, however long the button is held.
 *
 * A kid's tap can be shorter than one frame, so these are LATCHED: the press
 * is remembered until the game reads it, and reading it takes it away. Holding
 * the key down does not do the action again.
 */
export const ONE_SHOTS = [
  "jump",
  "horn",
  "reset",
  "camera",
  "interact",
  "nos",
] as const;

export type OneShot = (typeof ONE_SHOTS)[number];

/** Which key does each one. */
export const ONE_SHOT_CODES: Record<OneShot, string> = {
  jump: "Space",
  horn: "KeyH",
  reset: "KeyR",
  camera: "KeyC",
  interact: "KeyE",
  nos: "KeyN",
};

/**
 * Keys that are down, and one-shot presses that have not been read yet.
 *
 * `held` answers "is the throttle down right now". `pending` answers "was the
 * jump button pressed since the last time we looked", which is the question a
 * quick tap needs.
 */
export type InputLatch = { held: Set<string>; pending: Set<string> };

export function createLatch(): InputLatch {
  return { held: new Set(), pending: new Set() };
}

/**
 * A key went down.
 *
 * A one-shot only latches on the way down from not being held, so the
 * browser's own key repeat cannot fire the action over and over.
 */
export function latchDown(latch: InputLatch, code: string): void {
  const isOneShot = ONE_SHOT_CODE_SET.has(code);
  if (isOneShot && !latch.held.has(code)) latch.pending.add(code);
  latch.held.add(code);
}

export function latchUp(latch: InputLatch, code: string): void {
  latch.held.delete(code);
}

/** Let go of everything. A tab away must never leave the throttle stuck on. */
export function clearLatch(latch: InputLatch): void {
  latch.held.clear();
  latch.pending.clear();
}

const ONE_SHOT_CODE_SET = new Set(Object.values(ONE_SHOT_CODES));

/**
 * Read one waiting press and take it away.
 *
 * Each action has exactly one reader in the game, so nothing else can eat a
 * press before the part that acts on it gets to see it.
 */
export function takeOneShot(
  latch: InputLatch,
  touch: TouchState,
  action: OneShot
): boolean {
  const code = ONE_SHOT_CODES[action];
  let pressed = latch.pending.delete(code);
  if (action === "jump" && touch.jumpPending) {
    touch.jumpPending = false;
    pressed = true;
  }
  if (action === "horn" && touch.hornPending) {
    touch.hornPending = false;
    pressed = true;
  }
  return pressed;
}

/** What the touch buttons and the tilt sensor report. */
export type TouchState = {
  gas: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  horn: boolean;
  /** Tilt steering, -1 to 1. Zero when tilt is off. */
  steerAxis: number;
};

export const NEUTRAL_TOUCH: TouchState = {
  gas: false,
  brake: false,
  left: false,
  right: false,
  jump: false,
  horn: false,
  steerAxis: 0,
};

/*
 * Tilt sign. The phone reports `gamma`, which grows as the top of the screen
 * rolls to the RIGHT. `hooks/useControls.ts` divides it by 20 degrees and
 * clamps, so a 20 degree roll to the right is a full right turn, the same
 * direction the monster-truck game uses.
 */
export const TILT_FULL_DEGREES = 20;

/** Turn a tilt reading in degrees into a steering axis, -1 to 1. */
export function steerFromGamma(gammaDegrees: number): number {
  const clamped = Math.max(
    -TILT_FULL_DEGREES,
    Math.min(TILT_FULL_DEGREES, gammaDegrees)
  );
  return clamped / TILT_FULL_DEGREES;
}

/**
 * Keys down to control values.
 *
 * W or the up arrow goes, S or the down arrow backs up, A and D steer, the
 * space bar jumps, left shift or X is the handbrake, H honks, R flips you
 * back over, C switches the camera, E uses the thing in front of you, and N
 * is the boost.
 */
export function reduceKeyboard(keys: Set<string>): ControlValues {
  const forward = keys.has("KeyW") || keys.has("ArrowUp");
  const backward = keys.has("KeyS") || keys.has("ArrowDown");
  const left = keys.has("KeyA") || keys.has("ArrowLeft");
  const right = keys.has("KeyD") || keys.has("ArrowRight");

  return {
    throttle: (forward ? 1 : 0) - (backward ? 1 : 0),
    steer: (right ? 1 : 0) - (left ? 1 : 0),
    brake: 0,
    handbrake: keys.has("ShiftLeft") || keys.has("KeyX"),
    jump: keys.has("Space"),
    horn: keys.has("KeyH"),
    reset: keys.has("KeyR"),
    camera: keys.has("KeyC"),
    interact: keys.has("KeyE"),
    nos: keys.has("KeyN"),
  };
}

/**
 * Touch buttons to control values.
 *
 * GAS is the throttle and BRAKE is the brake, so a kid can hold both, which is
 * how a real quad stops fast. Steering takes whichever push is bigger, the
 * arrows or the tilt, which is the same rule `combine` uses. In practice the
 * arrows are hidden while tilt is on, so only one of them is ever moving.
 */
export function reduceTouch(touch: TouchState): ControlValues {
  const arrows = (touch.right ? 1 : 0) - (touch.left ? 1 : 0);
  const tilt = touch.steerAxis;
  const steer = Math.abs(tilt) > Math.abs(arrows) ? tilt : arrows;

  return {
    throttle: touch.gas ? 1 : 0,
    steer,
    brake: touch.brake ? 1 : 0,
    handbrake: false,
    jump: touch.jump,
    horn: touch.horn,
    reset: false,
    camera: false,
    interact: false,
    nos: false,
  };
}

/** Whichever of the two axes is pushed harder. */
function strongest(a: number, b: number): number {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

/**
 * One set of values from both hands.
 *
 * Buttons are an OR, so a kid on a laptop with a touchscreen can use either.
 * Axes take the bigger push, so a leaning phone never fights the arrow keys.
 */
export function combine(
  keyboard: ControlValues,
  touch: ControlValues
): ControlValues {
  return {
    throttle: strongest(keyboard.throttle, touch.throttle),
    steer: strongest(keyboard.steer, touch.steer),
    brake: Math.max(keyboard.brake, touch.brake),
    handbrake: keyboard.handbrake || touch.handbrake,
    jump: keyboard.jump || touch.jump,
    horn: keyboard.horn || touch.horn,
    reset: keyboard.reset || touch.reset,
    camera: keyboard.camera || touch.camera,
    interact: keyboard.interact || touch.interact,
    nos: keyboard.nos || touch.nos,
  };
}
