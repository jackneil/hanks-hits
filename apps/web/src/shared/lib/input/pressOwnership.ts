/**
 * Which pointer presses belong to a control that keeps its events from the
 * game (the clip button, the in-play clip controls, the clip sheets and the
 * result chip).
 *
 * Why: these controls sit over a running game, and many games listen on the
 * window (Breakout moves its paddle on pointermove, and a game releases its
 * held input on pointerup or mouseup). A control that stops EVERY move and
 * release that crosses it makes a dead zone: the paddle stops while the
 * cursor crosses the control, and a finger or mouse that starts on the game
 * and lifts over the control never reaches the game's release handler, so
 * the input stays held (a stuck thrust).
 *
 * Rules:
 * - A press is the control's when its pointerdown landed on the control.
 *   The control stops the move, up and cancel events of its own presses
 *   only. Every other move, up and cancel event reaches the game.
 * - The same rule applies to a mouse release: mouseup stops at the control
 *   only when its mousedown landed there. (A pointer event and the mouse
 *   event made from it have the same target.)
 * - A press that leaves the control without pointer capture ends somewhere
 *   else, so it stops being the control's. A captured press keeps its
 *   events on the control, and the browser sends it no leave event until
 *   the release.
 * - Touch events always go to the element where the touch started, so a
 *   touch event on the control is always from a touch that started there.
 *   The control can keep stopping those.
 * - pointerdown, mousedown, touchstart, click and contextmenu on the control
 *   start or finish the control's own gesture: the control still stops them.
 */

export interface PressOwnership {
  /** A pointer went down on the control. */
  down(pointerId: number): void;
  /** True while a press that went down on the control is down. */
  owns(pointerId: number): boolean;
  /** The press came up or was cancelled. True when it started on the control. */
  end(pointerId: number): boolean;
  /** The pointer left the control: a press without capture ends somewhere else. */
  leave(pointerId: number, pointerType: string): void;
  /** A mouse button went down on the control. */
  mouseDown(): void;
  /** A mouse button came up on the control. True when its mousedown landed there. */
  mouseUp(): boolean;
}

export function createPressOwnership(): PressOwnership {
  const pressed = new Set<number>();
  let mousePressed = false;
  return {
    down(pointerId) {
      pressed.add(pointerId);
    },
    owns(pointerId) {
      return pressed.has(pointerId);
    },
    end(pointerId) {
      return pressed.delete(pointerId);
    },
    leave(pointerId, pointerType) {
      pressed.delete(pointerId);
      if (pointerType === "mouse") mousePressed = false;
    },
    mouseDown() {
      mousePressed = true;
    },
    mouseUp() {
      const ours = mousePressed;
      mousePressed = false;
      return ours;
    },
  };
}
