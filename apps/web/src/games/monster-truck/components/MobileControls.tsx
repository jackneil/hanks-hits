'use client';

import { useTouchControls } from '../hooks/useControls';

interface MobileControlsProps {
  touchControls: ReturnType<typeof useTouchControls>;
  onHorn: () => void;
  onNos: () => void;
  nosCharge: number;
  nosMaxCharge: number;
  useTilt: boolean;
  onToggleTilt: () => void;
  onCalibrate: () => void;
}

export function MobileControls({
  touchControls,
  onHorn,
  onNos,
  nosCharge,
  nosMaxCharge,
  useTilt,
  onToggleTilt,
  onCalibrate,
}: MobileControlsProps) {
  const { handlers, state } = touchControls;
  const nosPercent = (nosCharge / nosMaxCharge) * 100;

  return (
    // Anchored below the GameShell header (like hill-climb's HUD), so no
    // control can sit inside the header box. The TILT and CALIBRATE buttons
    // used to sit at top-4 of the whole screen, under the header, where the
    // kid could not see or tap them.
    <div
      data-testid="monster-truck-mobile-controls"
      className="fixed inset-x-0 bottom-0 top-12 short:top-10 pointer-events-none z-50"
    >
      {/* TILT toggle, centered, with a fixed width and one place in both
          modes, so it never moves out from under the kid's thumb. It stays
          out of the header box, out of the strip right under the header,
          off the coin and speed panels, and off the truck:
          - upright phone: just above the pedals (the truck is higher up);
          - phone on its side (short screen): in the sky, below that strip
            (the truck sits just above the pedals there). */}
      <button
        type="button"
        onClick={onToggleTilt}
        aria-pressed={useTilt}
        data-testid="tilt-toggle"
        className={`
          absolute left-1/2 -translate-x-1/2 bottom-[8.5rem] short:bottom-auto short:top-16
          pointer-events-auto min-h-[44px] min-w-[8rem] px-4 py-2 rounded-full text-white font-bold text-sm
          ${useTilt ? 'bg-green-700' : 'bg-gray-600'}
          active:scale-95 transition-transform
        `}
      >
        {useTilt ? '🎮 TILT ON' : '🎮 TILT OFF'}
      </button>

      {/* CALIBRATE, while tilt steers.
          - Upright phone: where the arrow buttons were (the left HUD
            column ends far above it).
          - Phone on its side (short screen): the left HUD column (coins,
            stars, Session and Challenges) fills the left side from the
            header down to the pedals, so CALIBRATE sits just right of TILT
            instead, in the same row. TILT does not move. The max width
            keeps it clear of the NOS button column on narrow phones (the
            label wraps instead). */}
      {useTilt && (
        <button
          type="button"
          onClick={onCalibrate}
          data-testid="calibrate-button"
          className={`
            absolute left-4 top-[calc(50%-1.5rem)] md:top-[calc(50%-1.75rem)] -translate-y-1/2
            short:left-[calc(50%+4.5rem)] short:top-16 short:translate-y-0 short:max-w-[calc(50%-11rem)]
            pointer-events-auto min-h-[44px] px-4 py-2 rounded-full bg-blue-700 text-white font-bold text-sm leading-tight active:scale-95
          `}
        >
          ⚙️ CALIBRATE
        </button>
      )}

      {/* Steering buttons (when tilt is off). The side columns keep their
          old screen position (the middle of the whole screen, not of this
          lower layer), so they do not slide further under the pedals on a
          phone held sideways. */}
      {!useTilt && (
        <div
          data-testid="steering-area"
          className="absolute left-4 top-[calc(50%-1.5rem)] md:top-[calc(50%-1.75rem)] -translate-y-1/2 pointer-events-auto flex flex-col gap-4"
        >
          <button
            {...handlers.left}
            className={`
              w-16 h-24 rounded-xl
              flex items-center justify-center
              text-white font-bold text-3xl
              ${state.left ? 'bg-blue-400 scale-105' : 'bg-blue-600'}
              transition-all shadow-lg
            `}
            style={{ touchAction: 'none' }}
          >
            ◀
          </button>
          <button
            {...handlers.right}
            className={`
              w-16 h-24 rounded-xl
              flex items-center justify-center
              text-white font-bold text-3xl
              ${state.right ? 'bg-blue-400 scale-105' : 'bg-blue-600'}
              transition-all shadow-lg
            `}
            style={{ touchAction: 'none' }}
          >
            ▶
          </button>
        </div>
      )}

      {/* Side buttons - NOS and Horn */}
      <div className="absolute right-4 top-[calc(50%-1.5rem)] md:top-[calc(50%-1.75rem)] -translate-y-1/2 flex flex-col gap-4 pointer-events-auto">
        {/* NOS button */}
        <button
          {...handlers.nos}
          className={`
            relative w-20 h-20 rounded-full
            flex flex-col items-center justify-center
            text-white font-bold
            ${state.nos ? 'bg-cyan-400 scale-110' : 'bg-cyan-600'}
            ${nosCharge < 10 ? 'opacity-50' : ''}
            transition-all shadow-lg
            active:scale-95
          `}
          style={{ touchAction: 'none' }}
        >
          <span className="text-2xl">🚀</span>
          <span className="text-xs">NOS</span>
          {/* NOS level indicator, inside the round button (the button is
              relative; the meter used to float under the horn instead) */}
          <div
            data-testid="nos-meter"
            className="absolute bottom-3 left-5 right-5 h-1 bg-black/30 rounded"
          >
            <div
              className="h-full bg-cyan-300 rounded transition-all"
              style={{ width: `${nosPercent}%` }}
            />
          </div>
        </button>

        {/* Horn button: the hold handlers plus one honk per press (it used
            to honk on touchstart AND on the compatibility click). */}
        <button
          type="button"
          {...handlers.horn}
          onPointerDown={(e) => {
            handlers.horn.onPointerDown(e);
            onHorn();
          }}
          className={`
            w-20 h-20 rounded-full
            flex flex-col items-center justify-center
            text-white font-bold text-xl
            ${state.horn ? 'bg-yellow-400 scale-110' : 'bg-yellow-600'}
            transition-all shadow-lg
            active:scale-95
          `}
          style={{ touchAction: 'none' }}
        >
          <span className="text-3xl">📯</span>
        </button>
      </div>

      {/* Bottom pedals - with safe area for notched phones */}
      <div className="absolute bottom-0 left-0 right-0 h-32 flex pointer-events-auto pb-[env(safe-area-inset-bottom)]">
        {/* Brake pedal */}
        <button
          {...handlers.brake}
          className={`
            flex-1 m-2 rounded-t-3xl
            flex items-center justify-center
            text-white font-bold text-2xl
            ${state.brake ? 'bg-red-500' : 'bg-red-700'}
            transition-all shadow-lg
          `}
          style={{ touchAction: 'none' }}
        >
          <div className="flex flex-col items-center">
            <span className="text-4xl">🛑</span>
            <span>BRAKE</span>
          </div>
        </button>

        {/* Gas pedal */}
        <button
          {...handlers.gas}
          className={`
            flex-1 m-2 rounded-t-3xl
            flex items-center justify-center
            text-white font-bold text-2xl
            ${state.gas ? 'bg-green-400' : 'bg-green-600'}
            transition-all shadow-lg
          `}
          style={{ touchAction: 'none' }}
        >
          <div className="flex flex-col items-center">
            <span className="text-4xl">⛽</span>
            <span>GAS</span>
          </div>
        </button>
      </div>

      {/* Tilt indicator (when tilt is on): above the TILT toggle on an
          upright phone, in its old place on a phone held sideways */}
      {useTilt && (
        <div className="absolute bottom-[11.75rem] short:bottom-36 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-black/50 px-4 py-2 rounded-full text-white text-sm">
            📱 Tilt phone to steer
          </div>
        </div>
      )}
    </div>
  );
}
