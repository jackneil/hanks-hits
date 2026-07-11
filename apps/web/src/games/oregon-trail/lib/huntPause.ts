import { create } from "zustand";

// Transient pause flag for the Hunting minigame's real-time loop, owned by the
// GameShell (ESC / pause button / pause-on-blur). It lives in its own tiny
// store — NOT the persisted oregon-trail store — so a paused hunt can never be
// written to localStorage or synced to the cloud, and it resets to false on
// every reload. The Hunting component reads `paused` to freeze its timer,
// spawner, and animation loop while the shell's pause menu is open.
type HuntPauseState = {
  paused: boolean;
  setPaused: (paused: boolean) => void;
};

export const useHuntPauseStore = create<HuntPauseState>((set) => ({
  paused: false,
  setPaused: (paused) => set({ paused }),
}));
