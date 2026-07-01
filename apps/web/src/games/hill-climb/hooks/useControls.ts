/**
 * Hill Climb Racing - Controls Hook
 *
 * Keyboard and touch input handling.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useHillClimbStore } from '../lib/store';

// =============================================================================
// TYPES
// =============================================================================

export interface ControlState {
  gas: boolean;
  brake: boolean;
  leanBack: boolean;
  leanForward: boolean;
  nitro: boolean;
  reset: boolean;
}

export interface TouchZone {
  id: 'left' | 'right';
  active: boolean;
  startY: number;
  currentY: number;
}

// =============================================================================
// KEYBOARD CONTROLS HOOK
// =============================================================================

export function useKeyboardControls(): ControlState {
  const [controls, setControls] = useState<ControlState>({
    gas: false,
    brake: false,
    leanBack: false,
    leanForward: false,
    nitro: false,
    reset: false,
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Prevent default for game keys
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    switch (e.code) {
      case 'KeyD':
      case 'ArrowRight':
        setControls((c) => ({ ...c, gas: true }));
        break;
      case 'KeyA':
      case 'ArrowLeft':
        setControls((c) => ({ ...c, brake: true }));
        break;
      case 'KeyW':
      case 'ArrowUp':
        setControls((c) => ({ ...c, leanBack: true }));
        break;
      case 'KeyS':
      case 'ArrowDown':
        setControls((c) => ({ ...c, leanForward: true }));
        break;
      case 'Space':
        setControls((c) => ({ ...c, nitro: true }));
        break;
      case 'KeyR':
        setControls((c) => ({ ...c, reset: true }));
        break;
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyD':
      case 'ArrowRight':
        setControls((c) => ({ ...c, gas: false }));
        break;
      case 'KeyA':
      case 'ArrowLeft':
        setControls((c) => ({ ...c, brake: false }));
        break;
      case 'KeyW':
      case 'ArrowUp':
        setControls((c) => ({ ...c, leanBack: false }));
        break;
      case 'KeyS':
      case 'ArrowDown':
        setControls((c) => ({ ...c, leanForward: false }));
        break;
      case 'Space':
        setControls((c) => ({ ...c, nitro: false }));
        break;
      case 'KeyR':
        setControls((c) => ({ ...c, reset: false }));
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return controls;
}

// =============================================================================
// TOUCH CONTROLS HOOK
// =============================================================================

export function useTouchControls(): ControlState & { setNitro: (active: boolean) => void } {
  const [controls, setControls] = useState<ControlState>({
    gas: false,
    brake: false,
    leanBack: false,
    leanForward: false,
    nitro: false,
    reset: false,
  });

  const setNitro = useCallback((active: boolean) => {
    setControls((c) => ({ ...c, nitro: active }));
  }, []);

  const touchZonesRef = useRef<Map<number, TouchZone>>(new Map());

  const updateControlsFromTouches = useCallback(() => {
    let gas = false;
    let brake = false;
    let leanBack = false;
    let leanForward = false;

    const DRAG_THRESHOLD = 30; // Pixels to drag for lean

    touchZonesRef.current.forEach((zone) => {
      if (zone.id === 'right') {
        gas = true;
        // Drag up on right = lean forward
        const dragDistance = zone.startY - zone.currentY;
        if (dragDistance > DRAG_THRESHOLD) {
          leanForward = true;
        }
      } else {
        brake = true;
        // Drag up on left = lean back
        const dragDistance = zone.startY - zone.currentY;
        if (dragDistance > DRAG_THRESHOLD) {
          leanBack = true;
        }
      }
    });

    setControls((c) => ({
      gas,
      brake,
      leanBack,
      leanForward,
      nitro: c.nitro, // Preserve nitro state (set by button)
      reset: false,
    }));
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touches = e.changedTouches;
    const screenWidth = window.innerWidth;

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      const isLeftZone = touch.clientX < screenWidth / 2;

      touchZonesRef.current.set(touch.identifier, {
        id: isLeftZone ? 'left' : 'right',
        active: true,
        startY: touch.clientY,
        currentY: touch.clientY,
      });
    }

    updateControlsFromTouches();
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      const zone = touchZonesRef.current.get(touch.identifier);

      if (zone) {
        zone.currentY = touch.clientY;
      }
    }

    updateControlsFromTouches();
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      touchZonesRef.current.delete(touches[i].identifier);
    }

    updateControlsFromTouches();
  }, []);

  useEffect(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { ...controls, setNitro };
}

// =============================================================================
// COMBINED CONTROLS HOOK
// =============================================================================

export function useCombinedControls(): ControlState & { setNitro: (active: boolean) => void } {
  const keyboardControls = useKeyboardControls();
  const touchControls = useTouchControls();

  // Combine - keyboard OR touch triggers action
  return {
    gas: keyboardControls.gas || touchControls.gas,
    brake: keyboardControls.brake || touchControls.brake,
    leanBack: keyboardControls.leanBack || touchControls.leanBack,
    leanForward: keyboardControls.leanForward || touchControls.leanForward,
    nitro: keyboardControls.nitro || touchControls.nitro,
    reset: keyboardControls.reset || touchControls.reset,
    setNitro: touchControls.setNitro,
  };
}

// =============================================================================
// MOBILE DETECTION HOOK
// =============================================================================

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(
        'ontouchstart' in window ||
          navigator.maxTouchPoints > 0 ||
          window.innerWidth < 768
      );
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}

// =============================================================================
// PAUSE KEYBOARD HOOK
// =============================================================================

export function usePauseKeyboard(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;

      // Get fresh state to avoid stale closure issues
      const {
        isPlaying,
        isGameOver,
        isPaused,
        pauseScreen,
        pauseGame,
        resumeGame,
        setPauseScreen,
      } = useHillClimbStore.getState();

      // Ignore during game over - that screen has its own controls
      if (isGameOver) return;

      // Only handle when actually in the game
      if (!isPlaying) return;

      e.preventDefault();

      if (isPaused) {
        // If in settings submenu, go back to pause menu
        if (pauseScreen === 'settings') {
          setPauseScreen('menu');
        } else {
          // Otherwise resume game
          resumeGame();
        }
      } else {
        // Pause the game
        pauseGame();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // No dependencies - we use getState() for fresh values
}
