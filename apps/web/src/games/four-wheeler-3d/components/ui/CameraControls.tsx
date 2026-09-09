"use client";
import { useAdventureSession } from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import {
  CAMERA_PRESETS,
  cameraPreset,
  cycleCameraPreset,
} from "../../lib/cameraPresets";
function choose(index: number) {
  useAdventureSession.setState({ cameraPreset: index });
  if (useFourWheeler3dStore.getState().progress.settings.helmetCam)
    useFourWheeler3dStore.getState().updateSettings({ helmetCam: false });
  useAdventureSession.getState().requestAction("camera:reset");
}
export function CameraControls() {
  const index = useAdventureSession((s) => s.cameraPreset),
    helmet = useFourWheeler3dStore((s) => s.progress.settings.helmetCam);
  return (
    <>
      <button
        onClick={() => choose(cycleCameraPreset(index))}
        aria-label={`Camera: ${helmet ? "Rider eyes" : cameraPreset(index).name}. Next view`}
        title="Cycle camera. Drag the world to orbit."
      >
        View <kbd>C</kbd>
      </button>
      <button
        onClick={() =>
          useAdventureSession.getState().requestAction("camera:reset")
        }
        aria-label="Reset camera orbit"
        title="Center camera"
      >
        ↺
      </button>
    </>
  );
}
export function CameraSettings() {
  const index = useAdventureSession((s) => s.cameraPreset);
  return (
    <section>
      <label htmlFor="fw-camera-preset">Camera view</label>
      <select
        id="fw-camera-preset"
        value={index}
        onChange={(e) => choose(Number(e.target.value))}
        style={{ width: "100%" }}
      >
        {CAMERA_PRESETS.map((p, i) => (
          <option key={p.name} value={i}>
            {p.name}
          </option>
        ))}
      </select>
      <p className="fw-muted">
        Drag the open world with a mouse or one finger to orbit. Mouse wheel
        adjusts distance. Driving buttons keep their own gestures.
      </p>
      <button
        onClick={() =>
          useAdventureSession.getState().requestAction("camera:reset")
        }
      >
        Center camera
      </button>
    </section>
  );
}
