/**
 * The grid of a start-card picker with short choices (an age: "4yo",
 * "12yo"): three choices to a row, so every choice is on screen with the
 * heading on a phone held upright. A two-column grid put the fifth and
 * later choices under the fold at 375x549, behind a faint scroll shadow
 * (phone UX audit 2026-09-29, S12: Wordle showed four of six, Math Attack
 * four of seven).
 *
 * The grid has six columns and each choice takes two, so a last row that
 * is not full still fills the width: one choice left takes all six
 * columns, two choices left take three each. A lone half-width cell at
 * the end looked broken (the same reason the two-column pickers span
 * their odd last choice).
 *
 * Use it with GameStartOverlayButton in the start card's picker slot:
 *   <div className={PICKER_GRID}>
 *     {choices.map((choice, index) => (
 *       <GameStartOverlayButton className={pickerCellClass(index, choices.length)} ... />
 *     ))}
 *   </div>
 */

/** The picker grid: three choices to a row. */
export const PICKER_GRID = "grid grid-cols-6 gap-2";

/** The column span of choice `index` of `count`: the last row fills the width. */
export function pickerCellClass(index: number, count: number): string {
  const remainder = count % 3;
  const lastRowStart = count - remainder;
  if (remainder === 1 && index === lastRowStart) return "col-span-6";
  if (remainder === 2 && index >= lastRowStart) return "col-span-3";
  return "col-span-2";
}
