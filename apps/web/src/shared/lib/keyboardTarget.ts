/**
 * Is this keydown aimed at something the browser already handles?
 *
 * Games listen for keys on `window`, so a Space or Enter pressed while a
 * button has focus reaches the game handler too. If the game calls
 * preventDefault() there, the browser never turns that key into a click:
 * "Read it to me" and Play go dead for anyone using Tab. Every window
 * keydown handler must return early when this says true.
 */
export function isInteractiveTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  if (target.closest("button, a, input, textarea, select, [contenteditable], [role='dialog']")) {
    return true;
  }
  return false;
}
