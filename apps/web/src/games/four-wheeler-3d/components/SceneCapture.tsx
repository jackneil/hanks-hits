"use client";
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useAdventureSession } from "../lib/adventureSession";

/** Read the frame immediately after rendering, without retaining every GPU frame. */
export function SceneCapture() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const captureView = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    };
    useAdventureSession.setState({ captureView });
    return () => {
      if (useAdventureSession.getState().captureView === captureView)
        useAdventureSession.setState({ captureView: null });
    };
  }, [gl, scene, camera]);
  return null;
}
