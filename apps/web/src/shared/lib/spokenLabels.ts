/**
 * The words a voice says for the controls and the text of a surface.
 *
 * One copy for the pause menu, the result chip and the game sheet, so
 * every kid-facing surface reads its buttons the same way: the visible
 * label with the emoji taken out (a picture for a kid who cannot read;
 * the voice says the word), a control's data-spoken words first when it
 * has them (a clip length is "16 seconds" for the voice, "0:16" on the
 * screen), and the aria-label of an icon-only control.
 */

const INTERACTIVE = 'button, a[href], [role="button"], [role="link"]';
// Emoji, the variation selector, the joiner and the keycap mark.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Text with the emoji taken out and the spaces made single. */
export function spokenTextOf(text: string | null | undefined): string {
  return (text ?? "").replace(PICTOGRAPHS, " ").replace(/\s+/g, " ").trim();
}

/** The words for one control, or null when it has none. */
export function spokenLabel(el: Element): string | null {
  const spoken = el.getAttribute("data-spoken")?.trim();
  if (spoken) return spoken;
  const visible = spokenTextOf(el.textContent);
  if (visible) return visible;
  return el.getAttribute("aria-label")?.trim() || null;
}

/**
 * The words of a container, in reading order, with a space between the
 * text of each node (so "<p>Best: 890 m.</p><p>Go!</p>" is "Best: 890 m.
 * Go!", not "Best: 890 m.Go!") and without hidden parts (aria-hidden,
 * hidden). Emoji are taken out.
 */
export function spokenWordsOf(root: Element | null): string {
  if (!root) return "";
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = spokenTextOf(node.textContent);
      if (text) parts.push(text);
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return;
    node.childNodes.forEach(walk);
  };
  walk(root);
  return parts.join(" ");
}

/**
 * Joins the parts of a spoken text into sentences: a part that does not
 * end in . ! or ? gets a period, so the voice pauses between them and
 * never says "m.." after a part that already ends a sentence.
 */
export function joinSpoken(parts: Array<string | null | undefined | false>): string {
  return parts
    .map((part) => (part ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

/** The spoken labels of the visible controls inside a container, in DOM order. */
export function spokenLabelsIn(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll(INTERACTIVE))
    .filter((el) => !el.closest('[aria-hidden="true"], [hidden]'))
    .map(spokenLabel)
    .filter((label): label is string => !!label);
}
