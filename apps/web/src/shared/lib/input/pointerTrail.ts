/**
 * The point where a pointer lets go, from its own moves.
 *
 * Why: do not trust the coordinates of a pointerup event. On an iPhone SE
 * (iOS 27 Safari), touch taps sent by safaridriver on 2026-10-01 gave this
 * sequence for one tap on the clip button:
 *
 *   pointerdown at (585, 22), then touchstart,
 *   pointerup at (0, 0) (clientX, clientY, pageX and pageY were all 0),
 *   then lostpointercapture, pointerleave and touchend.
 *
 * The touchend had the real point, and the compatibility mousedown,
 * mouseup and click had (585, 22). A plain div with or without
 * setPointerCapture got the same (0, 0) pointerup. Code that read the
 * pointerup point saw a finger that slid far off the button, so the clip
 * button cancelled every tap ("Clip it!" did nothing).
 *
 * The rule: a decision about where a pointer let go reads release(). It
 * never reads clientX, clientY, pageX, pageY, screenX, screenY, offsetX or
 * offsetY of the pointerup event. ESLint enforces this rule
 * (hanks-hits/no-pointerup-position in pointerReleaseRule.mjs).
 *
 * How it works: down() starts a trail at the pointerdown point. move()
 * updates the trail of a pointer that is down. release() gives the last
 * point of the trail and stops the trail. The Pointer Events spec
 * captures a touch pointer to its pointerdown target, so that element
 * gets all pointermove events of the finger. Thus the trail is never more
 * than one move behind the finger. A mouse or a pen gets the same result
 * when the element calls setPointerCapture.
 *
 * Usage:
 *   const trail = createPointerTrail();
 *   onPointerDown: (e) => trail.down(e)
 *   onPointerMove: (e) => trail.move(e)
 *   onPointerUp:   (e) => { const at = trail.release(e); ...at.x, at.y... }
 *   onPointerCancel: (e) => trail.forget(e.pointerId)
 */

/** The fields of a pointer event that a trail reads. */
export interface TrailPointerEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** A point in client (viewport) coordinates. */
export interface TrailPoint {
  x: number;
  y: number;
}

export interface PointerTrail {
  /** A pointer went down: start its trail at the event point. */
  down(event: TrailPointerEvent): void;
  /** A pointer moved: update its trail. A pointer that is not down is ignored. */
  move(event: TrailPointerEvent): void;
  /**
   * A pointer let go: give the last point of its trail and stop the trail.
   * For a pointer that never went down here, give the event point (the
   * best that is known).
   */
  release(event: TrailPointerEvent): TrailPoint;
  /** Stop the trail of a pointer with no release (pointercancel, lost capture). */
  forget(pointerId: number): void;
}

/** Framework-free. Make one trail for each element (or handler set). */
export function createPointerTrail(): PointerTrail {
  const points = new Map<number, TrailPoint>();
  return {
    down(event) {
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    },
    move(event) {
      const point = points.get(event.pointerId);
      if (!point) return;
      point.x = event.clientX;
      point.y = event.clientY;
    },
    release(event) {
      const point = points.get(event.pointerId);
      points.delete(event.pointerId);
      return point ? { x: point.x, y: point.y } : { x: event.clientX, y: event.clientY };
    },
    forget(pointerId) {
      points.delete(pointerId);
    },
  };
}
