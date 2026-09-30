/**
 * The TILT button. iOS asks for motion permission, and only inside a tap,
 * so the permission request runs first, in the tap; tilt turns on only
 * when the phone says yes. The old toggle hid the arrows but never asked,
 * so on an iPhone no tilt data came and the truck could not steer at all
 * (phone UX audit 2026-09-29).
 */

export const TILT_NOTES = {
  denied: "Tilt needs your OK. Use the arrows for now!",
  unsupported: "This phone cannot steer by tilting. Use the arrows!",
} as const;

export interface TiltToggleInput {
  useTilt: boolean;
  isSupported: boolean;
  requestPermission: () => Promise<boolean>;
  setUseTilt: (on: boolean) => void;
  setNote: (note: string | null) => void;
}

/** Call this from the tap handler, before any other await. */
export function toggleTilt({ useTilt, isSupported, requestPermission, setUseTilt, setNote }: TiltToggleInput): Promise<void> {
  if (useTilt) {
    setUseTilt(false);
    setNote(null);
    return Promise.resolve();
  }
  if (!isSupported) {
    setNote(TILT_NOTES.unsupported);
    return Promise.resolve();
  }
  return requestPermission().then((granted) => {
    if (granted) {
      setUseTilt(true);
      setNote(null);
    } else {
      setNote(TILT_NOTES.denied);
    }
  });
}
