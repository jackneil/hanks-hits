/**
 * Drawn glyphs for the clip surfaces. They are SVG, never emoji characters,
 * so they look the same on every device and take the text color
 * (currentColor) unless a state needs its own color.
 *
 * Every glyph is decorative (aria-hidden). The control that holds it
 * carries the accessible name.
 */

import type { SVGProps } from "react";

type GlyphProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 24, viewBox = "0 0 24 24", ...rest }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  );
}

/** A clapperboard: the clip glyph (plan 11.6 names the control "clip button", its emoji is 🎬). */
export function ClipGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="clip" {...props}>
      <rect x="3.5" y="9.5" width="17" height="10.5" rx="2" />
      <path d="M3.9 8.2 19.1 4.4 19.8 7.2 4.6 11" />
      <path d="m8.3 7.1 1.8 2.7M12.9 6 14.7 8.7" />
    </Svg>
  );
}

export function CheckGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="check" strokeWidth={2.75} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function StarGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="star" fill="currentColor" strokeWidth={1.5} {...props}>
      <path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
    </Svg>
  );
}

export function PlayGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="play" fill="currentColor" strokeWidth={1.5} {...props}>
      <path d="M8 5.5v13l10.5-6.5z" />
    </Svg>
  );
}

/** A filled dot inside a ring: Record a video. */
export function RecordGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="record" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function StopGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="stop" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </Svg>
  );
}

/** A frame with a hill and a sun: Take a picture. */
export function PictureGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="picture" {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="m4 17 5-5 4 4 2.5-2.5L20 18" />
      <circle cx="15.5" cy="9.5" r="1.5" />
    </Svg>
  );
}

/** Four tiles: a list of clips. */
export function TilesGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="tiles" {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

/** Three sliders: settings. */
export function SlidersGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="sliders" {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h13M20 12h0" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
      <circle cx="19" cy="12" r="1" />
    </Svg>
  );
}

/** A power symbol: turn the clip button back on. */
export function PowerGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="power" {...props}>
      <path d="M12 3.5v8" />
      <path d="M7 6.8a7.5 7.5 0 1 0 10 0" />
    </Svg>
  );
}

export function CloseGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="close" strokeWidth={2.5} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function ShareGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="share" {...props}>
      <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
      <path d="M6 11.5H5v8.5h14v-8.5h-1" />
    </Svg>
  );
}

/** A tray with a down arrow: a copy that leaves the site. Also the icon of iOS "Save Video". */
export function SaveGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="save" {...props}>
      <path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 15.5V20h14v-4.5" />
    </Svg>
  );
}

export function TrashGlyph(props: GlyphProps) {
  return (
    <Svg data-glyph="trash" {...props}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
    </Svg>
  );
}

/** A ribbon: Keep. Filled when kept. */
export function KeepGlyph({ filled = false, ...props }: GlyphProps & { filled?: boolean }) {
  return (
    <Svg data-glyph="keep" data-filled={filled ? "true" : "false"} {...props}>
      <path d="M7 3.5h10v17l-5-4-5 4z" fill={filled ? "currentColor" : "none"} />
    </Svg>
  );
}
