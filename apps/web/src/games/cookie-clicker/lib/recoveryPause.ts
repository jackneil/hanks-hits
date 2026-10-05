const holds = new Set<symbol>();

/** Native dialogs do not stop production timers or deferred achievement work. */
export function pauseCookieRecovery(): () => void {
  const hold = Symbol("recovery");
  holds.add(hold);
  return () => { holds.delete(hold); };
}

export const cookieRecoveryPaused = () => holds.size > 0;
