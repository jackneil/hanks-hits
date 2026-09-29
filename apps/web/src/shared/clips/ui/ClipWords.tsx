/**
 * Clip words with a picture of the clip button (plan 11.6, decision 11:
 * a picture paired with a word is a pre-reader aid).
 *
 * The header's clip button is a drawn clapperboard in a thin ring, the only
 * control in the header that is not a color emoji. A 6-year-old who hears
 * "tap the clip button" must not have to guess which control that is, so
 * every sentence on a clip surface that names the clip button shows a small
 * copy of the real button right after the words. The picture is decorative
 * (aria-hidden): the voice and screen readers read the words only.
 *
 * The rule is in the words, not in a list of messages: any text that says
 * "clip button" gets the picture, so a new reason or tip gets it too.
 */

import { ClipGlyph } from "./glyphs";

const BUTTON_WORDS = /clip button/i;

/** The slate-950 header behind the real button. */
const HEADER = "#020617";

/**
 * The header's clip button, small: the same clapperboard (ClipGlyph) in the
 * same thin white ring, on the header's dark color (buttonFace "ready").
 */
export function ClipButtonPicture({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      data-glyph="clip-button"
      width={size}
      height={size}
      viewBox="0 0 44 44"
      aria-hidden="true"
      focusable="false"
      className={`inline-block shrink-0 align-text-bottom ${className}`}
    >
      <circle cx={22} cy={22} r={21.5} fill={HEADER} />
      <circle cx={22} cy={22} r={19.5} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={1.5} />
      <ClipGlyph x={10} y={10} size={24} stroke="white" />
    </svg>
  );
}

/** True when the words name the clip button. */
export function namesClipButton(text: string): boolean {
  return BUTTON_WORDS.test(text);
}

/**
 * The words, with the picture of the clip button right after the first
 * "clip button" (one picture per sentence group is enough to pair the word
 * with the control). Other words render as they are.
 */
export function ClipWords({ text }: { text: string }) {
  const match = BUTTON_WORDS.exec(text);
  if (!match) return <>{text}</>;
  const end = match.index + match[0].length;
  return (
    <>
      {text.slice(0, match.index)}
      <span className="whitespace-nowrap">
        {match[0]} <ClipButtonPicture size={22} />
      </span>
      {text.slice(end)}
    </>
  );
}
