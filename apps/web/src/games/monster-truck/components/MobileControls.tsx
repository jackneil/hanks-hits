'use client';

import { useTouchControls } from '../hooks/useControls';

interface MobileControlsProps {
  touchControls: ReturnType<typeof useTouchControls>;
  onHorn: () => void;
  nosCharge: number;
  nosMaxCharge: number;
  useTilt: boolean;
  onToggleTilt: () => void;
  onCalibrate: () => void;
  /** A kid-friendly note under the TILT button (for example, no permission). */
  tiltNote?: string | null;
}

/**
 * The touch controls, laid out for thumbs (phone UX audit 2026-09-29).
 *
 * Upright phone: the BRAKE and GAS pedals fill the bottom; the steering
 * arrows sit side by side above BRAKE (left thumb) and NOS and the horn
 * above GAS (right thumb); TILT sits above the arrows. Nothing sits in the
 * middle, where the truck is.
 *
 * Phone held sideways (short screen): the arrows are in the bottom left
 * corner and the pedals in the bottom right corner, with TILT above the
 * arrows and NOS and the horn above the pedals. The old layout centred the
 * arrow column on the whole screen, so ▶ sat under BRAKE and the horn
 * under GAS: a tap on ▶ pressed BRAKE.
 */
export function MobileControls({
  touchControls,
  onHorn,
  nosCharge,
  nosMaxCharge,
  useTilt,
  onToggleTilt,
  onCalibrate,
  tiltNote = null,
}: MobileControlsProps) {
  const { handlers, state } = touchControls;
  const nosPercent = (nosCharge / nosMaxCharge) * 100;

  return (
    // Anchored below the GameShell header, so no control sits inside the
    // header box.
    <div
      data-testid="monster-truck-mobile-controls"
      className="fixed inset-x-0 bottom-0 top-[var(--shell-header-h)] pointer-events-none z-50"
    >
      {/* TILT toggle, with its note, above the steering slot */}
      <div
        data-testid="tilt-slot"
        className="absolute left-3 bottom-[14rem] short:bottom-[6.25rem] flex flex-col items-start gap-1 pointer-events-none"
      >
        {tiltNote && (
          <div role="status" className="max-w-[14rem] rounded-xl bg-black/75 px-3 py-1.5 text-sm font-semibold text-white">
            {tiltNote}
          </div>
        )}
        <button
          type="button"
          onClick={onToggleTilt}
          aria-pressed={useTilt}
          data-testid="tilt-toggle"
          className={`pointer-events-auto min-h-[44px] min-w-[8rem] rounded-full px-4 py-2 text-base font-bold text-white active:scale-95 transition-transform ${
            useTilt ? 'bg-green-700' : 'bg-gray-700'
          }`}
        >
          {useTilt ? '🎮 TILT ON' : '🎮 TILT OFF'}
        </button>
      </div>

      {/* The steering slot: the arrows, or (with tilt) CALIBRATE */}
      <div
        data-testid="steering-slot"
        className="absolute left-3 bottom-[8.75rem] short:bottom-3 flex flex-row items-end gap-2 pointer-events-auto"
      >
        {useTilt ? (
          <div className="flex flex-col items-start gap-1">
            <div className="rounded-full bg-black/60 px-3 py-1 text-sm text-white">📱 Tilt your phone to steer</div>
            <button
              type="button"
              onClick={onCalibrate}
              data-testid="calibrate-button"
              className="min-h-[44px] rounded-full bg-blue-700 px-4 py-2 text-base font-bold text-white active:scale-95"
            >
              ⚙️ CALIBRATE
            </button>
          </div>
        ) : (
          <div data-testid="steering-area" className="flex flex-row gap-2">
            <button
              type="button"
              aria-label="Steer left"
              {...handlers.left}
              className={`flex h-16 w-[4.5rem] items-center justify-center rounded-2xl text-3xl font-bold text-white shadow-lg transition-all short:h-[4.5rem] short:w-20 ${
                state.left ? 'bg-blue-400 scale-105' : 'bg-blue-600'
              }`}
              style={{ touchAction: 'none' }}
            >
              ◀
            </button>
            <button
              type="button"
              aria-label="Steer right"
              {...handlers.right}
              className={`flex h-16 w-[4.5rem] items-center justify-center rounded-2xl text-3xl font-bold text-white shadow-lg transition-all short:h-[4.5rem] short:w-20 ${
                state.right ? 'bg-blue-400 scale-105' : 'bg-blue-600'
              }`}
              style={{ touchAction: 'none' }}
            >
              ▶
            </button>
          </div>
        )}
      </div>

      {/* NOS and the horn, above GAS */}
      <div
        data-testid="boost-slot"
        className="absolute right-3 bottom-[8.75rem] short:bottom-[6.25rem] flex flex-row gap-2 pointer-events-auto"
      >
        <button
          type="button"
          aria-label="NOS boost"
          {...handlers.nos}
          className={`relative flex h-16 w-16 flex-col items-center justify-center rounded-full font-bold text-white shadow-lg transition-all active:scale-95 short:h-14 short:w-14 ${
            state.nos ? 'bg-cyan-400 scale-110' : 'bg-cyan-600'
          } ${nosCharge < 10 ? 'opacity-50' : ''}`}
          style={{ touchAction: 'none' }}
        >
          <span className="text-2xl short:text-xl" aria-hidden="true">🚀</span>
          <span className="text-xs">NOS</span>
          {/* NOS level, inside the round button */}
          <span data-testid="nos-meter" className="absolute bottom-2 left-4 right-4 h-1 rounded bg-black/30">
            <span className="block h-full rounded bg-cyan-200 transition-all" style={{ width: `${nosPercent}%` }} />
          </span>
        </button>

        {/* The horn: the hold handlers plus one honk per press */}
        <button
          type="button"
          aria-label="Horn"
          {...handlers.horn}
          onPointerDown={(e) => {
            handlers.horn.onPointerDown(e);
            onHorn();
          }}
          className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl text-white shadow-lg transition-all active:scale-95 short:h-14 short:w-14 short:text-2xl ${
            state.horn ? 'bg-yellow-400 scale-110' : 'bg-yellow-600'
          }`}
          style={{ touchAction: 'none' }}
        >
          <span aria-hidden="true">📯</span>
        </button>
      </div>

      {/* The pedals: the whole bottom upright; the bottom right corner sideways */}
      <div
        data-testid="pedals"
        className="absolute bottom-0 left-0 right-0 flex h-32 pb-[env(safe-area-inset-bottom)] pointer-events-auto short:bottom-3 short:left-auto short:right-3 short:h-auto short:gap-2 short:pb-0"
      >
        <button
          type="button"
          aria-label="Brake"
          {...handlers.brake}
          className={`m-2 flex flex-1 items-center justify-center rounded-t-3xl text-2xl font-bold text-white shadow-lg transition-all short:m-0 short:h-[4.5rem] short:w-24 short:flex-none short:rounded-2xl short:text-lg ${
            state.brake ? 'bg-red-500' : 'bg-red-700'
          }`}
          style={{ touchAction: 'none' }}
        >
          <span className="flex flex-col items-center">
            <span className="text-4xl short:text-2xl" aria-hidden="true">🛑</span>
            <span>BRAKE</span>
          </span>
        </button>
        <button
          type="button"
          aria-label="Gas"
          {...handlers.gas}
          className={`m-2 flex flex-1 items-center justify-center rounded-t-3xl text-2xl font-bold text-white shadow-lg transition-all short:m-0 short:h-[4.5rem] short:w-28 short:flex-none short:rounded-2xl short:text-lg ${
            state.gas ? 'bg-green-400' : 'bg-green-700'
          }`}
          style={{ touchAction: 'none' }}
        >
          <span className="flex flex-col items-center">
            <span className="text-4xl short:text-2xl" aria-hidden="true">⛽</span>
            <span>GAS</span>
          </span>
        </button>
      </div>
    </div>
  );
}
