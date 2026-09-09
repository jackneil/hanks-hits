"use client";

/**
 * The on-screen controls for a phone.
 *
 * Two big pedals on the right, two steering arrows on the left, JUMP and HORN
 * above the pedals and the TILT chip above the arrows. Everything uses pointer
 * events with pointer capture, so a thumb can hold GAS while another thumb
 * taps LEFT. Every button is at least 44 px and the pedals are much bigger.
 *
 * Where each one sits comes from `lib/hudLayout.ts`, which a test reads to
 * prove that no two controls ever cover each other.
 */

import type { GameControls } from "../hooks/useControls";
import { boxStyle } from "../lib/hudLayout";

const BUTTON =
  "flex select-none items-center justify-center rounded-2xl font-black " +
  "text-white shadow-md active:translate-y-0.5";

export type MobileControlsProps = {
  controls: GameControls;
  walking?: boolean;
  forwardLabel?: string;
};

export function MobileControls({
  controls,
  walking = false,
  forwardLabel,
}: MobileControlsProps) {
  const { touch, tilt, useTilt, setUseTilt } = controls;
  const { handlers, state } = touch;

  const toggleTilt = async () => {
    if (useTilt) {
      setUseTilt(false);
      return;
    }
    const allowed = await tilt.requestPermission();
    if (!allowed) return;
    tilt.calibrate();
    setUseTilt(true);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {/* Tilt steering, above the arrows so the pedals never sit on it. */}
      <button
        type="button"
        onClick={toggleTilt}
        style={boxStyle("tilt")}
        className={`${BUTTON} pointer-events-auto rounded-full text-sm ${
          useTilt ? "bg-[#4d7155]" : "bg-[#24382fee]"
        }`}
      >
        {useTilt ? "📱 TILT ON" : "📱 TILT"}
      </button>

      {useTilt && (
        <button
          type="button"
          onClick={() => tilt.calibrate()}
          style={boxStyle("calibrate")}
          className={`${BUTTON} pointer-events-auto rounded-full bg-[#36575b] text-sm`}
        >
          🎯 HOLD STILL
        </button>
      )}

      {/* Steering. Tilt takes over when it is on, so the arrows step aside. */}
      {!useTilt && (
        <>
          <button
            type="button"
            aria-label="Steer left"
            style={boxStyle("steerLeft")}
            className={`${BUTTON} pointer-events-auto bg-[#24382fee] text-3xl active:bg-[#4b6652]`}
            {...handlers.left}
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Steer right"
            style={boxStyle("steerRight")}
            className={`${BUTTON} pointer-events-auto bg-[#24382fee] text-3xl active:bg-[#4b6652]`}
            {...handlers.right}
          >
            →
          </button>
        </>
      )}

      {/* Jump and horn, on the row above the pedals. */}
      <button
        type="button"
        aria-label="Jump"
        style={boxStyle("jump")}
        className={`${BUTTON} pointer-events-auto text-2xl ${
          state.jump ? "bg-amber-400" : "bg-[#92733e]"
        }`}
        {...handlers.jump}
      >
        🤸
      </button>
      {!walking && (
        <button
          type="button"
          aria-label="Honk the horn"
          style={boxStyle("horn")}
          className={`${BUTTON} pointer-events-auto text-2xl ${
            state.horn ? "bg-[#36575b]" : "bg-[#36575b]"
          }`}
          {...handlers.horn}
        >
          📣
        </button>
      )}

      {/* The pedals. */}
      <button
        type="button"
        aria-label={walking ? "Walk backward" : "Brake"}
        style={boxStyle("brake")}
        className={`${BUTTON} pointer-events-auto text-base ${
          state.brake ? "bg-[#a36a52]" : "bg-[#854e40]"
        }`}
        {...handlers.brake}
      >
        {walking ? "BACK" : "🛑 BRAKE"}
      </button>
      <button
        type="button"
        aria-label={walking ? "Walk forward" : "Gas"}
        style={boxStyle("gas")}
        className={`${BUTTON} pointer-events-auto text-base ${
          state.gas ? "bg-[#759463]" : "bg-[#527348]"
        }`}
        {...handlers.gas}
      >
        {forwardLabel ?? (walking ? "WALK" : "🦶 GAS")}
      </button>
    </div>
  );
}

export default MobileControls;
