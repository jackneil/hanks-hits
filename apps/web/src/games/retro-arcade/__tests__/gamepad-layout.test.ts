import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SYSTEM_IDS, type SystemType } from "../lib/constants";

/**
 * The on-screen gamepad of EmulatorJS 4.2.3, laid out on a phone.
 *
 * jsdom does no layout, so this test computes the rectangles itself, from
 * the real inputs:
 * - the default layout of each console, read from the vendored
 *   emulator.min.js (the same arrays that EmulatorJS uses),
 * - the EmulatorJS stylesheet (emulator.min.css),
 * - the style block of public/emulator/index.html (the Retro Arcade rules).
 * It builds the gamepad elements the way EmulatorJS does (classes and inline
 * style), finds the rules that match each element (element.matches), applies
 * the cascade (!important, inline style, specificity, order), and resolves
 * px, %, calc(), min(), max() and var(). Only absolute boxes occur in the
 * gamepad, so the layout is simple.
 *
 * The live check (Playwright, real EmulatorJS) measured the same numbers:
 * 48 px buttons, a 125 px d-pad, 100 px N64 sticks.
 */

const WEB_ROOT = join(__dirname, "..", "..", "..", "..");
const EJS_DIR = join(WEB_ROOT, "public", "emulator", "ejs", "4.2.3");
const EJS_JS = readFileSync(join(EJS_DIR, "emulator.min.js"), "utf8");
const EJS_CSS = readFileSync(join(EJS_DIR, "emulator.min.css"), "utf8");
const PAGE = readFileSync(join(WEB_ROOT, "public", "emulator", "index.html"), "utf8");
const PAGE_CSS = (() => {
  const match = /<style>([\s\S]*?)<\/style>/.exec(PAGE);
  if (!match) throw new Error("the emulator page has no style block");
  return match[1];
})();

// ------------------------------------------------------------ EmulatorJS layouts

type LayoutItem = {
  type: "button" | "dpad" | "zone";
  id: string;
  text?: string;
  location: "top" | "center" | "left" | "right";
  left?: number | string;
  right?: number | string;
  top?: number | string;
  block?: boolean;
};

/** The source text from `start` (included) to `end` (excluded) in emulator.min.js; `start` must be unique. */
function ejsSlice(start: string, end: string): string {
  const at = EJS_JS.indexOf(start);
  if (at < 0 || EJS_JS.indexOf(start, at + 1) >= 0) throw new Error(`emulator.min.js: "${start}" is not unique`);
  const stop = EJS_JS.indexOf(end, at);
  if (stop < 0) throw new Error(`emulator.min.js: no "${end}" after "${start}"`);
  return EJS_JS.slice(at, stop);
}

/**
 * Reads a minified array literal of plain objects (unquoted keys, "!0" for
 * true) as JSON, so the test runs none of the vendored code.
 */
function literal(source: string): LayoutItem[] {
  const json = source
    .replace(/([{,])([A-Za-z_]\w*):/g, '$1"$2":')
    .replace(/!0\b/g, "true")
    .replace(/!1\b/g, "false");
  return JSON.parse(`[${json}]`);
}

const SPEED_BUTTONS = literal(ejsSlice('{type:"button",text:"Fast"', "];let e;"));

/** The control layout (EJS_controlScheme) of each Retro Arcade console. */
const SCHEME: Record<SystemType, string> = {
  nes: "nes",
  snes: "snes",
  gb: "gb",
  gba: "gba",
  segaMD: "segaMD",
  n64: "n64",
  atari2600: "atari2600",
};

function ejsLayout(scheme: string): LayoutItem[] {
  const anchor =
    scheme === "segaMD"
      ? '["segaMD","segaCD","sega32x"].includes(this.getControlScheme())?(e=['
      : `"${scheme}"===this.getControlScheme()?(e=[`;
  const items = literal(ejsSlice(anchor, "],e.push(...t)").slice(anchor.length));
  // EmulatorJS adds Fast and Slow to each layout (Rewind only when it is on).
  return [...items, ...SPEED_BUTTONS];
}

// ------------------------------------------------------------ a small CSS engine

type Declaration = { prop: string; value: string; important: boolean };
type Rule = { selector: string; media: string; decls: Declaration[]; specificity: number; order: number };

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The index of the brace that closes the block opened at `open`. */
function closing(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces");
}

/** Splits at commas that are not inside parentheses. */
function splitTop(text: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function specificity(selector: string): number {
  let ids = 0;
  let classes = 0;
  let types = 0;
  let rest = selector;
  // :has(), :not(), :is() count as their argument.
  rest = rest.replace(/:(?:has|not|is)\(([^()]*)\)/g, (_m, inner: string) => {
    const s = specificity(inner);
    ids += Math.floor(s / 1e6);
    classes += Math.floor(s / 1e3) % 1e3;
    types += s % 1e3;
    return "";
  });
  rest = rest.replace(/::?[\w-]+(\([^)]*\))?/g, (m) => {
    if (m.startsWith("::")) types++;
    else classes++;
    return "";
  });
  ids += (rest.match(/#[\w-]+/g) ?? []).length;
  classes += (rest.match(/\.[\w-]+|\[[^\]]*\]/g) ?? []).length;
  rest = rest.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]/g, " ");
  types += (rest.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 1e6 + classes * 1e3 + types;
}

let ruleOrder = 0;
function parseCss(css: string, media = ""): Rule[] {
  const text = stripComments(css);
  const rules: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    const close = closing(text, open);
    const body = text.slice(open + 1, close);
    if (head.startsWith("@media")) {
      rules.push(...parseCss(body, head.slice("@media".length).trim()));
    } else if (!head.startsWith("@")) {
      const decls: Declaration[] = [];
      for (const part of splitTop(body, ";")) {
        const colon = part.indexOf(":");
        if (colon < 0) continue;
        const prop = part.slice(0, colon).trim().toLowerCase();
        let value = part.slice(colon + 1).trim();
        const important = /!\s*important\s*$/i.test(value);
        value = value.replace(/!\s*important\s*$/i, "").trim();
        if (prop) decls.push({ prop, value, important });
      }
      const order = ruleOrder++;
      for (const selector of splitTop(head)) {
        const s = selector.trim();
        if (s) rules.push({ selector: s, media, decls, specificity: specificity(s), order });
      }
    }
    i = close + 1;
  }
  return rules;
}

// The Retro Arcade style block comes first in the document; loader.js adds
// the EmulatorJS stylesheet to the head later.
const RULES = [...parseCss(PAGE_CSS), ...parseCss(EJS_CSS)];

type Viewport = { width: number; height: number };

/** Evaluates a media query list of the forms the page uses. */
function mediaMatches(media: string, vp: Viewport): boolean {
  if (!media) return true;
  return splitTop(media).some((query) =>
    query
      .split(/\s+and\s+/)
      .map((q) => q.trim())
      .every((feature) => {
        const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(feature);
        if (!m) throw new Error(`unsupported media feature: ${feature}`);
        const [, name, raw] = m;
        const px = Number.parseFloat(raw);
        switch (name) {
          case "orientation":
            return raw === (vp.height >= vp.width ? "portrait" : "landscape");
          case "max-width":
            return vp.width <= px;
          case "min-width":
            return vp.width >= px;
          case "max-height":
            return vp.height <= px;
          case "min-height":
            return vp.height >= px;
          default:
            throw new Error(`unsupported media feature: ${name}`);
        }
      })
  );
}

/**
 * element.matches, for the selectors of both stylesheets. A pseudo-element
 * (::before, ::-moz-range-track...) never matches an element; jsdom throws on
 * vendor pseudo-elements, so those are skipped here.
 */
function matches(el: Element, selector: string): boolean {
  if (selector.includes("::")) return false;
  try {
    return el.matches(selector);
  } catch {
    // Vendor pseudo-classes (:-webkit-..., :-moz-...) that jsdom does not know.
    if (/:-(webkit|moz|ms)-/.test(selector)) return false;
    throw new Error(`jsdom cannot match "${selector}"`);
  }
}

/** The cascaded value of each property of an element (null when not set). */
function cascade(el: Element, vp: Viewport): Map<string, string> {
  const winners = new Map<string, { rank: number[]; value: string }>();
  const offer = (prop: string, value: string, rank: number[]) => {
    const cur = winners.get(prop);
    const better =
      !cur ||
      rank.some((r, k) => r !== cur.rank[k] && rank.slice(0, k).every((x, j) => x === cur.rank[j]) && r > cur.rank[k]);
    if (better) winners.set(prop, { rank, value });
  };
  for (const rule of RULES) {
    if (!mediaMatches(rule.media, vp) || !matches(el, rule.selector)) continue;
    for (const d of rule.decls) offer(d.prop, d.value, [d.important ? 2 : 0, rule.specificity, rule.order]);
  }
  const inline = el.getAttribute("style") ?? "";
  for (const part of inline.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    // Inline style is above every normal declaration, below !important.
    offer(part.slice(0, colon).trim(), part.slice(colon + 1).trim(), [1, 0, 0]);
  }
  return new Map([...winners].map(([prop, w]) => [prop, w.value]));
}

/** The value of a custom property on the element or its nearest ancestor. */
function customProperty(el: Element | null, name: string, vp: Viewport): string | null {
  for (let e = el; e; e = e.parentElement) {
    const v = cascade(e, vp).get(name);
    if (v != null) return v;
  }
  return null;
}

/** Resolves a length: px, % of `basis`, calc(), min(), max(), var(). Null for auto. */
function length(value: string | undefined, basis: number, el: Element, vp: Viewport): number | null {
  if (value == null || value === "" || value === "auto" || value === "none") return null;
  let text = value;
  for (let guard = 0; /var\(/.test(text); guard++) {
    if (guard > 20) throw new Error(`var() loop in ${value}`);
    text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/, (_m, name: string, fallback?: string) => {
      const v = customProperty(el, name, vp) ?? fallback;
      if (v == null) throw new Error(`undefined ${name}`);
      return `(${v})`;
    });
  }
  const tokens = text.match(/-?\d*\.?\d+(?:px|%)?|[a-z]+\(|[()+\-*/,]/g) ?? [];
  let k = 0;
  const peek = () => tokens[k];
  const next = () => tokens[k++];
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * factor() : v / factor();
    return v;
  };
  const args = (): number[] => {
    const out = [expr()];
    while (peek() === ",") {
      next();
      out.push(expr());
    }
    if (next() !== ")") throw new Error(`bad function in ${value}`);
    return out;
  };
  const factor = (): number => {
    const t = next();
    if (t === "(" || t === "calc(") {
      const v = expr();
      if (next() !== ")") throw new Error(`bad parentheses in ${value}`);
      return v;
    }
    if (t === "min(") return Math.min(...args());
    if (t === "max(") return Math.max(...args());
    if (t === "-") return -factor();
    if (t !== undefined && /^-?\d*\.?\d+(px|%)?$/.test(t)) {
      const n = Number.parseFloat(t);
      return t.endsWith("%") ? (n / 100) * basis : n;
    }
    throw new Error(`cannot read "${value}" at "${t}"`);
  };
  const v = expr();
  if (k !== tokens.length) throw new Error(`trailing tokens in "${value}"`);
  return v;
}

type Rect = { x: number; y: number; w: number; h: number };

/** The border box of an absolutely positioned element inside its containing block. */
function place(el: Element, cb: Rect, vp: Viewport, autoHeight = 0): Rect {
  const c = cascade(el, vp);
  const get = (p: string) => c.get(p);
  const w = Math.max(
    length(get("width"), cb.w, el, vp) ??
      (length(get("left"), cb.w, el, vp) != null && length(get("right"), cb.w, el, vp) != null
        ? cb.w - length(get("left"), cb.w, el, vp)! - length(get("right"), cb.w, el, vp)!
        : 0),
    length(get("min-width"), cb.w, el, vp) ?? 0
  );
  const maxH = length(get("max-height"), cb.h, el, vp);
  let h = Math.max(length(get("height"), cb.h, el, vp) ?? autoHeight, length(get("min-height"), cb.h, el, vp) ?? 0);
  if (maxH != null) h = Math.min(h, maxH);
  const left = length(get("left"), cb.w, el, vp);
  const right = length(get("right"), cb.w, el, vp);
  const top = length(get("top"), cb.h, el, vp);
  const bottom = length(get("bottom"), cb.h, el, vp);
  let x = left ?? (right != null ? cb.w - right - w : 0);
  x += length(get("margin-left"), cb.w, el, vp) ?? 0;
  const translate = /translate\(\s*(-?[\d.]+)%/.exec(get("transform") ?? "");
  if (translate) x += (Number.parseFloat(translate[1]) / 100) * w;
  const y = top ?? (bottom != null ? cb.h - bottom - h : 0);
  return { x: cb.x + x, y: cb.y + y, w, h };
}

// ------------------------------------------------------------ the gamepad

type Control = { name: string; rect: Rect };

/**
 * Builds the gamepad DOM of EmulatorJS 4.2.3 (setVirtualGamepad and
 * createBottomMenuBar) for a console and a box size, and returns the
 * rectangle of each control, of the menu button, of the menu bar and of the
 * canvas. `gamepadShown` is the class that the page's trackGamepad puts on
 * #game while EmulatorJS shows the gamepad (on a phone).
 */
function layout(system: SystemType, vp: Viewport, { gamepadShown = true } = {}) {
  const scheme = SCHEME[system];
  const doc = document.implementation.createHTMLDocument("gamepad");
  const game = doc.createElement("div");
  game.id = "game";
  game.className = `ejs_parent ${vp.width <= 575 ? "ejs_small_screen" : "ejs_big_screen"}${gamepadShown ? " hh_gamepad_shown" : ""}`;
  doc.body.appendChild(game);
  // The canvas of RetroArch fills its parent (.ejs_canvas{width:100%;height:100%}).
  const canvasParent = doc.createElement("div");
  canvasParent.className = "ejs_canvas_parent";
  game.appendChild(canvasParent);
  const parent = doc.createElement("div");
  parent.className = "ejs_virtualGamepad_parent";
  game.appendChild(parent);
  const containers = {
    top: doc.createElement("div"),
    center: doc.createElement("div"),
    left: doc.createElement("div"),
    right: doc.createElement("div"),
  };
  containers.top.className = "ejs_virtualGamepad_top";
  containers.center.className = "ejs_virtualGamepad_bottom";
  containers.left.className = "ejs_virtualGamepad_left";
  containers.right.className = "ejs_virtualGamepad_right";
  parent.append(containers.top, containers.center, containers.left, containers.right);

  const items = ejsLayout(scheme);
  const buttons: [Element, LayoutItem][] = [];
  const dpads: [Element, LayoutItem][] = [];
  const zones: [Element, LayoutItem][] = [];
  for (const item of items) {
    const el = doc.createElement("div");
    let style = "";
    // EmulatorJS writes left/right/top only when the value is truthy.
    for (const side of ["left", "right", "top"] as const) {
      const v = item[side];
      if (v) style += `${side}:${v}${typeof v === "number" ? "px" : ""};`;
    }
    if (item.type === "button") {
      if (item.block) style += "height:31px;";
      el.className = `ejs_virtualGamepad_button cs_${scheme} b_${item.id}`;
      buttons.push([el, item]);
    } else {
      el.className = `cs_${scheme} b_${item.id}`;
      (item.type === "dpad" ? dpads : zones).push([el, item]);
    }
    if (item.type !== "zone") el.setAttribute("style", style);
    containers[item.location].appendChild(el);
  }
  const dpadMains = dpads.map(([el]) => {
    const main = doc.createElement("div");
    main.className = "ejs_dpad_main";
    el.appendChild(main);
    return main;
  });
  const open = doc.createElement("div");
  open.className = "ejs_virtualGamepad_open";
  game.appendChild(open);
  const menu = doc.createElement("div");
  menu.className = "ejs_menu_bar";
  game.appendChild(menu);

  const box: Rect = { x: 0, y: 0, w: vp.width, h: vp.height };
  // In normal flow the canvas parent is the whole box (width and height 100%).
  const canvas = place(canvasParent, box, vp);
  const parentRect = place(parent, box, vp);
  const rects = new Map<Element, Rect>();
  for (const c of Object.values(containers)) rects.set(c, place(c, parentRect, vp));

  const controls: Control[] = [];
  for (const [el, item] of buttons) {
    controls.push({ name: `${item.text || item.id} (b_${item.id})`, rect: place(el, rects.get(el.parentElement!)!, vp) });
  }
  for (const main of dpadMains) {
    // .ejs_dpad_main fills the nearest positioned box: its container.
    controls.push({ name: "d-pad", rect: place(main, rects.get(main.parentElement!.parentElement!)!, vp) });
  }
  for (const [el, item] of zones) {
    // nipplejs (static mode) centers a 100 px stick at left/top of the container.
    const cb = rects.get(el.parentElement!)!;
    const cx = cb.x + length(String(item.left), cb.w, el, vp)!;
    const cy = cb.y + length(String(item.top), cb.h, el, vp)!;
    controls.push({ name: `stick (b_${item.id})`, rect: { x: cx - 50, y: cy - 50, w: 100, h: 100 } });
  }
  const openRect = place(open, box, vp);
  controls.push({ name: "menu button", rect: openRect });
  // The height of the menu bar depends on its buttons. The phone menu wraps
  // its buttons in rows: take it at its tallest (its max-height, else the
  // whole box). The big-screen menu is one row: 44 px buttons and its 15 px
  // and 10 px padding (.ejs_big_screen .ejs_menu_bar).
  const menuRect = place(menu, box, vp, vp.width <= 575 ? vp.height : 44 + 15 + 10);
  return { controls, canvas, menuButton: openRect, menuBar: menuRect, menuCascade: cascade(menu, vp) };
}

/**
 * The picture of the game. RetroArch fits it into the canvas at the aspect
 * of the core. EmulatorJS puts it at the top of a canvas that is taller
 * than it is wide (video_top_portrait_viewport) and in the middle of any
 * other canvas. The aspects are the ones the live check measured for each
 * core.
 */
const ASPECT: Record<SystemType, number> = {
  atari2600: 4 / 3,
  nes: 64 / 49,
  snes: 4 / 3,
  gb: 8 / 7,
  gba: 3 / 2,
  segaMD: 64 / 49,
  n64: 4 / 3,
};
function picture(system: SystemType, canvas: Rect): Rect {
  const aspect = ASPECT[system];
  if (canvas.w / aspect <= canvas.h) {
    const h = canvas.w / aspect;
    return { x: canvas.x, y: canvas.y + (canvas.h > canvas.w ? 0 : (canvas.h - h) / 2), w: canvas.w, h };
  }
  const w = canvas.h * aspect;
  return { x: canvas.x + (canvas.w - w) / 2, y: canvas.y, w, h: canvas.h };
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Phone screens, as the size of the emulator box (the screen minus the 52 px
 * bar of the game). 568x320 and 667x375 are the iPhone SE (1st and 2nd/3rd
 * generation) in landscape: the shortest boxes.
 */
const PHONES: [string, Viewport][] = [
  ["390x844", { width: 390, height: 792 }],
  ["320x568", { width: 320, height: 516 }],
  ["360x640", { width: 360, height: 588 }],
  ["844x390", { width: 844, height: 338 }],
  ["568x320", { width: 568, height: 268 }],
  ["667x375", { width: 667, height: 323 }],
];

const CASES = SYSTEM_IDS.flatMap((system) => PHONES.map(([label, vp]) => [system, label, vp] as const));

describe("on-screen gamepad layout (EmulatorJS 4.2.3 defaults + index.html)", () => {
  it("reads the default layout of each console from emulator.min.js", () => {
    // A wrong extraction must fail here, not pass the checks below.
    expect(SPEED_BUTTONS.map((b) => b.id)).toEqual(["speed_fast", "speed_slow"]);
    const counts = Object.fromEntries(SYSTEM_IDS.map((s) => [s, layout(s, PHONES[0][1]).controls.length]));
    // The live check counted the same controls (menu button included).
    expect(counts).toEqual({ nes: 8, snes: 12, gb: 8, gba: 10, segaMD: 12, n64: 15, atari2600: 7 });
  });

  it("matches the positions that the live check measured (SNES and N64 at 390x844)", () => {
    // Rectangles measured in Chromium on the build of 40b5a5a, for the parts
    // of the layout that this change does not move.
    const at = (system: SystemType, name: string) =>
      layout(system, PHONES[0][1]).controls.find((c) => c.name.startsWith(name))?.rect;
    expect(at("snes", "d-pad")).toEqual({ x: 10, y: 603, w: 125, h: 125 });
    expect(at("snes", "Start")).toEqual({ x: 171, y: 736, w: 48, h: 48 });
    expect(at("snes", "menu button")).toEqual({ x: 315, y: 736, w: 48, h: 48 });
    expect(at("n64", "stick (b_stick)")).toEqual({ x: 22.5, y: 628, w: 100, h: 100 });
    expect(at("n64", "CU")).toEqual({ x: 280, y: 520, w: 50, h: 50 });
    expect(at("n64", "Z")).toEqual({ x: 99, y: 736, w: 50, h: 48 });
  });

  it.each(CASES)("%s at %s: no two controls overlap", (system, _label, vp) => {
    const { controls } = layout(system, vp);
    const overlaps: string[] = [];
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++) {
        const o = overlap(controls[i].rect, controls[j].rect);
        if (o > 0) overlaps.push(`${controls[i].name} x ${controls[j].name}: ${Math.round(o)} px2`);
      }
    expect(overlaps).toEqual([]);
  });

  it.each(CASES)("%s at %s: every control is at least 44 px and on the screen", (system, _label, vp) => {
    const { controls } = layout(system, vp);
    const small = controls.filter((c) => c.rect.w < 44 || c.rect.h < 44).map((c) => `${c.name} ${c.rect.w}x${c.rect.h}`);
    const off = controls
      .filter((c) => c.rect.x < 0 || c.rect.y < 0 || c.rect.x + c.rect.w > vp.width || c.rect.y + c.rect.h > vp.height)
      .map((c) => `${c.name} ${JSON.stringify(c.rect)}`);
    expect(small).toEqual([]);
    expect(off).toEqual([]);
  });

  it.each(CASES)("%s at %s: no control covers 10% or more of itself with the picture", (system, _label, vp) => {
    const { controls, canvas } = layout(system, vp);
    const pic = picture(system, canvas);
    const onPicture = controls
      .map((c) => ({ name: c.name, pct: (100 * overlap(c.rect, pic)) / (c.rect.w * c.rect.h) }))
      .filter((c) => c.pct >= 10)
      .map((c) => `${c.name} ${c.pct.toFixed(1)}%`);
    expect(onPicture).toEqual([]);
  });
});

describe("the picture beside the landscape strips", () => {
  const LANDSCAPE = PHONES.filter(([, vp]) => vp.width > vp.height);

  it.each(SYSTEM_IDS.flatMap((system) => LANDSCAPE.map(([label, vp]) => [system, label, vp] as const)))(
    "%s at %s: the picture stays between the strips and fills the height or the width between them",
    (system, _label, vp) => {
      const { canvas } = layout(system, vp);
      const pic = picture(system, canvas);
      expect(pic.x).toBeGreaterThanOrEqual(canvas.x);
      expect(pic.x + pic.w).toBeLessThanOrEqual(canvas.x + canvas.w + 0.01);
      // The largest picture that fits: as tall as the box, or as wide as the space between the strips.
      expect(Math.max(pic.h / vp.height, pic.w / canvas.w)).toBeCloseTo(1, 5);
    }
  );

  it("keeps the whole box for the picture when a wide screen does not need the strips (844x390)", () => {
    const vp = PHONES.find(([label]) => label === "844x390")![1];
    for (const system of SYSTEM_IDS) {
      const { canvas } = layout(system, vp);
      const full = picture(system, { x: 0, y: 0, w: vp.width, h: vp.height });
      expect(picture(system, canvas)).toEqual(full);
    }
  });

  it("keeps the whole box for the picture without the gamepad (a computer) and in portrait", () => {
    for (const system of SYSTEM_IDS) {
      expect(layout(system, { width: 1280, height: 748 }, { gamepadShown: false }).canvas).toEqual({ x: 0, y: 0, w: 1280, h: 748 });
      expect(layout(system, { width: 568, height: 268 }, { gamepadShown: false }).canvas).toEqual({ x: 0, y: 0, w: 568, h: 268 });
      expect(layout(system, PHONES[0][1]).canvas).toEqual({ x: 0, y: 0, w: 390, h: 792 });
    }
  });
});

describe("EmulatorJS menu and its menu button", () => {
  it.each(CASES)("%s at %s: the open menu leaves the menu button uncovered", (system, _label, vp) => {
    const { menuButton, menuBar } = layout(system, vp);
    // menuBar is the menu at its tallest (its max-height).
    expect(overlap(menuButton, menuBar)).toBe(0);
  });

  it.each(PHONES.filter(([, vp]) => vp.width <= 575))(
    "at %s the phone menu stays inside the box and scrolls",
    (_label, vp) => {
      const { menuBar, menuCascade } = layout("gb", vp);
      expect(menuBar.y).toBeGreaterThanOrEqual(0);
      expect(menuBar.y + menuBar.h).toBeLessThanOrEqual(vp.height);
      expect(menuCascade.get("overflow-y")).toBe("auto");
    }
  );
});
