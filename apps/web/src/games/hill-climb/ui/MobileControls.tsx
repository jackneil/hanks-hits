'use client';

/**
 * Hill Climb Racing - Mobile Controls
 *
 * Split-screen touch zones for gas/brake and lean.
 * Includes nitro button above gas pedal.
 */

import { useState, useCallback } from 'react';

interface MobileControlsProps {
  setNitro: (active: boolean) => void;
}

export function MobileControls({ setNitro }: MobileControlsProps) {
  const [nitroPressed, setNitroPressed] = useState(false);

  const handleNitroStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setNitroPressed(true);
    setNitro(true);
  }, [setNitro]);

  const handleNitroEnd = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setNitroPressed(false);
    setNitro(false);
  }, [setNitro]);

  return (
    <div className="fixed inset-0 pointer-events-none z-30">
      {/* Zone indicators sit in the LOWER portion of each half so they stay
          clear of the HUD (fuel/nitro gauges top-right, coins top-left) on a
          390px-tall landscape phone. The touch ZONES themselves are still the
          full half-screen (see useControls) - only the visual hint moved. */}
      {/* Left zone indicator (brake/lean back) */}
      <div className="absolute left-0 top-0 bottom-0 w-1/2 flex items-end justify-center pb-[max(1.5rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div className="bg-red-500/50 rounded-3xl p-6 border-2 border-red-500/50">
          <div className="text-center text-white/90 [text-shadow:_0_2px_4px_rgb(0_0_0_/_60%)]">
            <div className="text-4xl mb-2">◀</div>
            <div className="text-sm font-bold">BRAKE</div>
            <div className="text-xs mt-1">Drag ↑ to lean back</div>
          </div>
        </div>
      </div>

      {/* Right zone indicator (gas/lean forward) */}
      <div className="absolute right-0 top-0 bottom-0 w-1/2 flex items-end justify-center pb-[max(1.5rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div className="bg-green-500/50 rounded-3xl p-6 border-2 border-green-500/50">
          <div className="text-center text-white/90 [text-shadow:_0_2px_4px_rgb(0_0_0_/_60%)]">
            <div className="text-4xl mb-2">▶</div>
            <div className="text-sm font-bold">GAS</div>
            <div className="text-xs mt-1">Drag ↑ to lean forward</div>
          </div>
        </div>
      </div>

      {/* Nitro button - above the gas zone, LEFT of the HUD's fuel/nitro/
          speed column (which owns the right-4 lane from the header down to
          ~y290 on a 390px-tall phone; sharing that lane buried this button
          under the translucent gauges when the HUD moved below the header) */}
      <div className="absolute right-56 top-32 pointer-events-auto">
        <button
          onTouchStart={handleNitroStart}
          onTouchEnd={handleNitroEnd}
          onTouchCancel={handleNitroEnd}
          onMouseDown={handleNitroStart}
          onMouseUp={handleNitroEnd}
          onMouseLeave={handleNitroEnd}
          className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-all duration-100 ${
            nitroPressed
              ? 'bg-cyan-500 border-cyan-300 scale-95'
              : 'bg-cyan-600/80 border-cyan-400/50'
          }`}
        >
          <span className="text-3xl">🚀</span>
        </button>
        <div className="text-center text-white/60 text-xs mt-1 font-bold">NITRO</div>
      </div>

      {/* Divider line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/10" />
    </div>
  );
}
