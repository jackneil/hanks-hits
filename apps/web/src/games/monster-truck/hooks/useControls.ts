import { useEffect, useCallback, useRef, useState } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
  nos: boolean;
  horn: boolean;
  reset: boolean;
}

export interface ControlValues {
  throttle: number;  // -1 to 1
  steering: number;  // -1 to 1
  nos: boolean;
  horn: boolean;
  reset: boolean;
}

const initialState: ControlState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  brake: false,
  nos: false,
  horn: false,
  reset: false,
};

// ============================================================================
// KEYBOARD CONTROLS
// ============================================================================

export function useKeyboardControls(
  onHorn?: () => void,
  onReset?: () => void
) {
  const stateRef = useRef<ControlState>({ ...initialState });
  const [state, setState] = useState<ControlState>({ ...initialState });

  const updateState = useCallback((updates: Partial<ControlState>) => {
    stateRef.current = { ...stateRef.current, ...updates };
    setState({ ...stateRef.current });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        updateState({ forward: true });
        break;
      case 'KeyS':
      case 'ArrowDown':
        updateState({ backward: true });
        break;
      case 'KeyA':
      case 'ArrowLeft':
        updateState({ left: true });
        break;
      case 'KeyD':
      case 'ArrowRight':
        updateState({ right: true });
        break;
      case 'Space':
        updateState({ nos: true });
        e.preventDefault();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        updateState({ brake: true });
        break;
      case 'KeyH':
        if (!stateRef.current.horn) {
          updateState({ horn: true });
          onHorn?.();
        }
        break;
      case 'KeyR':
        if (!stateRef.current.reset) {
          updateState({ reset: true });
          onReset?.();
        }
        break;
    }
  }, [updateState, onHorn, onReset]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        updateState({ forward: false });
        break;
      case 'KeyS':
      case 'ArrowDown':
        updateState({ backward: false });
        break;
      case 'KeyA':
      case 'ArrowLeft':
        updateState({ left: false });
        break;
      case 'KeyD':
      case 'ArrowRight':
        updateState({ right: false });
        break;
      case 'Space':
        updateState({ nos: false });
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        updateState({ brake: false });
        break;
      case 'KeyH':
        updateState({ horn: false });
        break;
      case 'KeyR':
        updateState({ reset: false });
        break;
    }
  }, [updateState]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Convert to control values
  const getControlValues = useCallback((): ControlValues => {
    const s = stateRef.current;
    return {
      throttle: (s.forward ? 1 : 0) - (s.backward ? 1 : 0),
      steering: (s.right ? 1 : 0) - (s.left ? 1 : 0),
      nos: s.nos,
      horn: s.horn,
      reset: s.reset,
    };
  }, []);

  return { state, getControlValues };
}

// ============================================================================
// TOUCH CONTROLS
// ============================================================================

export interface TouchControlState {
  gas: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  nos: boolean;
  horn: boolean;
}

const initialTouchControlState: TouchControlState = {
  gas: false,
  brake: false,
  left: false,
  right: false,
  nos: false,
  horn: false,
};

export function useTouchControls() {
  const stateRef = useRef<TouchControlState>({ ...initialTouchControlState });
  const [state, setState] = useState<TouchControlState>(initialTouchControlState);

  const updateState = useCallback((updates: Partial<TouchControlState>) => {
    stateRef.current = { ...stateRef.current, ...updates };
    setState({ ...stateRef.current });
  }, []);

  const createHandlers = useCallback((control: keyof TouchControlState) => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault();
      updateState({ [control]: true });
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault();
      updateState({ [control]: false });
    },
    onTouchCancel: () => updateState({ [control]: false }),
    onMouseDown: () => updateState({ [control]: true }),
    onMouseUp: () => updateState({ [control]: false }),
    onMouseLeave: () => updateState({ [control]: false }),
  }), [updateState]);

  const getControlValues = useCallback((): ControlValues => {
    const s = stateRef.current;
    return {
      throttle: (s.gas ? 1 : 0) - (s.brake ? 0.5 : 0),
      steering: (s.right ? 1 : 0) - (s.left ? 1 : 0),
      nos: s.nos,
      horn: s.horn,
      reset: false,
    };
  }, []);

  return {
    state,
    getControlValues,
    handlers: {
      gas: createHandlers('gas'),
      brake: createHandlers('brake'),
      left: createHandlers('left'),
      right: createHandlers('right'),
      nos: createHandlers('nos'),
      horn: createHandlers('horn'),
    },
  };
}

// ============================================================================
// DEVICE ORIENTATION (TILT STEERING)
// ============================================================================

interface OrientationState {
  gamma: number;
  beta: number;
  steering: number;
}

export function useDeviceOrientation() {
  const getOrientationSupport = () =>
    typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  const hasImplicitPermission = () => {
    if (!getOrientationSupport()) return false;
    return !('requestPermission' in DeviceOrientationEvent);
  };

  const [orientation, setOrientation] = useState<OrientationState>({
    gamma: 0,
    beta: 0,
    steering: 0,
  });
  const [isSupported] = useState(getOrientationSupport);
  const [isPermissionGranted, setIsPermissionGranted] = useState(hasImplicitPermission);

  const calibrationOffset = useRef(0);
  const lastGamma = useRef(0);
  const smoothingFactor = 0.25;

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const gamma = event.gamma ?? 0;
    const beta = event.beta ?? 0;

    // Smooth the input
    const smoothed = lastGamma.current + (gamma - lastGamma.current) * smoothingFactor;
    lastGamma.current = smoothed;

    // Apply calibration
    const calibrated = smoothed - calibrationOffset.current;

    // Convert to steering (-1 to 1), clamp at ±35 degrees
    const clamped = Math.max(-35, Math.min(35, calibrated));
    const steering = clamped / 35;

    setOrientation({ gamma: smoothed, beta, steering });
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    if ('requestPermission' in DeviceOrientationEvent) {
      try {
        const permission = await (DeviceOrientationEvent as unknown as {
          requestPermission: () => Promise<'granted' | 'denied'>
        }).requestPermission();

        if (permission === 'granted') {
          setIsPermissionGranted(true);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    setIsPermissionGranted(true);
    return true;
  }, [isSupported]);

  const calibrate = useCallback(() => {
    calibrationOffset.current = lastGamma.current;
  }, []);

  useEffect(() => {
    if (isPermissionGranted) {
      window.addEventListener('deviceorientation', handleOrientation);
      return () => window.removeEventListener('deviceorientation', handleOrientation);
    }
  }, [isPermissionGranted, handleOrientation]);

  return {
    orientation,
    isSupported,
    isPermissionGranted,
    requestPermission,
    calibrate,
  };
}

// ============================================================================
// COMBINED CONTROLS
// ============================================================================

export function useCombinedControls(
  onHorn?: () => void,
  onReset?: () => void
) {
  const keyboard = useKeyboardControls(onHorn, onReset);
  const touch = useTouchControls();
  const tilt = useDeviceOrientation();

  const [isMobile, setIsMobile] = useState(false);
  const [useTilt, setUseTilt] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        ('ontouchstart' in window);
      setIsMobile(mobile);
    };
    checkMobile();
  }, []);

  const getControlValues = useCallback((): ControlValues => {
    const kb = keyboard.getControlValues();
    const tc = touch.getControlValues();

    // Combine inputs - keyboard takes priority for throttle/steering if pressed
    const throttle = kb.throttle !== 0 ? kb.throttle : tc.throttle;
    let steering = kb.steering !== 0 ? kb.steering : tc.steering;

    // Apply tilt steering if enabled and on mobile
    if (useTilt && isMobile && tilt.isPermissionGranted) {
      steering = tilt.orientation.steering;
    }

    return {
      throttle,
      steering,
      nos: kb.nos || tc.nos,
      horn: kb.horn || tc.horn,
      reset: kb.reset,
    };
  }, [keyboard, touch, tilt, useTilt, isMobile]);

  return {
    keyboard,
    touch,
    tilt,
    isMobile,
    useTilt,
    setUseTilt,
    getControlValues,
  };
}
