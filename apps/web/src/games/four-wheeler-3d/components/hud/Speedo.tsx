"use client";

/**
 * The round speedometer in the bottom right corner.
 *
 * It is the 2D game's dial rebuilt in SVG: an arc that fills as you speed up,
 * a needle, and the number in big digits. The needle and the number turn red
 * once you pass eight tenths of the top speed, the same rule the 2D game uses.
 */

import { mphFromMs, topSpeedMph } from "../../lib/vehicles";
import { boxStyle } from "../../lib/hudLayout";

/** Where the dial starts and ends, in degrees. */
const START_ANGLE = 135;
const SWEEP = 270;

/** Past this share of the top speed the dial turns red. */
const RED_LINE = 0.8;

const RADIUS = 42;
const CENTER = 50;

function pointOnDial(fraction: number, radius: number) {
  const angle = ((START_ANGLE + SWEEP * fraction) * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

export type SpeedoProps = {
  /** How fast the vehicle is going, in meters per second. */
  speed: number;
  /** Which vehicle, so the dial knows what its top speed is. */
  vehicleId: string;
  /**
   * True on a touch screen, where the dial sits above the JUMP and HORN row
   * in the shared layout. On a mouse screen it tucks into the corner.
   */
  raised?: boolean;
};

export function Speedo({ speed, vehicleId, raised = false }: SpeedoProps) {
  const topMph = topSpeedMph(vehicleId);
  const mph = Math.abs(mphFromMs(speed));
  const fraction = Math.max(0, Math.min(1, mph / topMph));
  const fast = fraction >= RED_LINE;

  const arcLength = (SWEEP / 360) * 2 * Math.PI * RADIUS;
  const needle = pointOnDial(fraction, RADIUS - 8);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40"
      aria-hidden="true"
    >
      <div
        className="relative"
        style={
          raised
            ? boxStyle("speedo")
            : { position: "absolute", right: "16px", bottom: "16px", width: "128px", height: "128px" }
        }
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <circle cx={CENTER} cy={CENTER} r={48} fill="rgba(12,16,22,0.78)" />
          {/* The empty dial. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} 999`}
            transform={`rotate(${START_ANGLE} ${CENTER} ${CENTER})`}
          />
          {/* How full it is right now. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={fast ? "#f04438" : "#37c46a"}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${arcLength * fraction} 999`}
            transform={`rotate(${START_ANGLE} ${CENTER} ${CENTER})`}
          />
          <line
            x1={CENTER}
            y1={CENTER}
            x2={needle.x}
            y2={needle.y}
            stroke={fast ? "#f04438" : "#f6f7f9"}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <circle cx={CENTER} cy={CENTER} r={4} fill="#f6f7f9" />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
          <span
            className={`text-2xl font-black tabular-nums leading-none ${
              fast ? "text-red-400" : "text-white"
            }`}
          >
            {Math.round(mph)}
          </span>
          <span className="text-[10px] font-bold tracking-wide text-white/70">
            MPH
          </span>
        </div>
      </div>
    </div>
  );
}

export default Speedo;
