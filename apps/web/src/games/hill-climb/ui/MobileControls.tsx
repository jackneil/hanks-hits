'use client';

/**
 * Hill Climb Racing - Mobile Controls
 *
 * The touch ZONES are the two halves of the play field (useControls):
 * the left half brakes, the right half drives, a drag up leans. This
 * layer only shows where they are: a chip in each bottom corner, where
 * the thumbs rest, plus the NITRO button above the GAS chip, so the right
 * thumb reaches it. The chips take no touch (pointer-events-none); the
 * zones under them do. The old layer drew two 160 px pads in the middle
 * of each half, over the truck and under the gauges (phone UX audit
 * 2026-09-29).
 */

import { useState } from 'react';
import { usePointerHold } from '@/shared/hooks/useTouchInput';

interface MobileControlsProps {
  setNitro: (active: boolean) => void;
}

/** A zone chip: a big arrow and a word, 64 px tall, 48 on a short screen. */
const CHIP =
  'flex items-center gap-2 rounded-2xl border-2 px-4 py-2 text-white/95 [text-shadow:_0_2px_4px_rgb(0_0_0_/_60%)] short:px-3 short:py-1.5';

export function MobileControls({ setNitro }: MobileControlsProps) {
  const [nitroPressed, setNitroPressed] = useState(false);

  // NITRO is a hold through the shared pointer hold: pointer capture, a
  // release on pointercancel, on window blur and on unmount. The gas/brake
  // zone hook (useControls) skips touches that land on a button, so a
  // NITRO press is never also a gas press.
  const nitroHold = usePointerHold<HTMLButtonElement>(
    () => {
      setNitroPressed(true);
      setNitro(true);
    },
    () => {
      setNitroPressed(false);
      setNitro(false);
    }
  );

  return (
    <div data-testid="hill-climb-touch" className="fixed inset-x-0 bottom-0 top-12 short:top-10 pointer-events-none z-30">
      {/* Left corner: brake */}
      <div
        data-testid="hill-climb-brake-chip"
        className={`${CHIP} absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 border-red-400/60 bg-red-500/45`}
      >
        <span className="text-3xl leading-none short:text-2xl" aria-hidden="true">◀</span>
        <span className="flex flex-col leading-tight">
          <span className="text-lg font-bold short:text-base">BRAKE</span>
          <span className="text-sm short:hidden">Drag up to lean</span>
        </span>
      </div>

      {/* Right corner: gas */}
      <div
        data-testid="hill-climb-gas-chip"
        className={`${CHIP} absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 flex-row-reverse border-green-400/60 bg-green-500/45`}
      >
        <span className="text-3xl leading-none short:text-2xl" aria-hidden="true">▶</span>
        <span className="flex flex-col text-right leading-tight">
          <span className="text-lg font-bold short:text-base">GAS</span>
          <span className="text-sm short:hidden">Drag up to lean</span>
        </span>
      </div>

      {/* NITRO: above the GAS chip, in reach of the right thumb */}
      <div className="absolute bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5rem)] right-3 flex flex-col items-center short:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.75rem)]">
        <button
          type="button"
          aria-label="Nitro"
          data-testid="hill-climb-nitro"
          {...nitroHold}
          className={`pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full border-4 transition-all duration-100 touch-none select-none [-webkit-touch-callout:none] short:h-16 short:w-16 ${
            nitroPressed ? 'scale-95 border-cyan-300 bg-cyan-500' : 'border-cyan-400/60 bg-cyan-600/85'
          }`}
        >
          <span className="text-3xl short:text-2xl" aria-hidden="true">🚀</span>
        </button>
        <span className="mt-1 text-sm font-bold text-white/80 [text-shadow:_0_1px_3px_rgb(0_0_0_/_70%)] short:hidden">NITRO</span>
      </div>

      {/* The line between the two zones */}
      <div className="absolute bottom-0 left-1/2 top-0 w-0.5 bg-white/10" />
    </div>
  );
}
