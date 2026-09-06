/**
 * Does this keydown belong to the focused control instead of the game?
 *
 * Games listen for keys on `window`, so a key pressed while a control has
 * focus reaches the game handler too. Two cases must be left alone:
 *
 * - A text field (input, textarea, select, contenteditable) owns EVERY key:
 *   typing "a" into Math Attack's answer box must not fire a game shortcut.
 * - A button or link owns only its activation keys, Space and Enter: if the
 *   game calls preventDefault() on those, the browser never turns them into
 *   a click and "Read it to me" and Play go dead for anyone using Tab. Any
 *   OTHER key still reaches the game, so a kid who tapped an on-screen
 *   letter in Wordle (which leaves that button focused) can keep typing.
 *
 * Every window keydown handler must return early when this says true.
 */
export function keyBelongsToTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  if (target.closest("input, textarea, select, [contenteditable]")) {
    return true;
  }

  const control = target.closest("button, a, summary");
  if (!control) return false;

  const key = event.key;
  return key === " " || key === "Spacebar" || key === "Enter";
}
