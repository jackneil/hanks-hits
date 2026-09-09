"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import * as THREE from "three";
import { nightFactor } from "../lib/dayNight";

/** Local 1K HDR sky, filtered once for realistic paint, glass and water reflections. */
export function OutdoorEnvironment({ timeOfDay }: { timeOfDay: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const previous = scene.environment;
    const previousBackground = scene.background;
    let skyTexture: THREE.DataTexture | undefined;
    let cancelled = false;
    let target: THREE.WebGLRenderTarget | undefined;
    const loader = new HDRLoader();
    loader.load(
      "/games/four-wheeler-3d/assets/kloofendal_48d_partly_cloudy_puresky/kloofendal_48d_partly_cloudy_puresky_1k.hdr",
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        const generator = new THREE.PMREMGenerator(gl);
        target = generator.fromEquirectangular(texture);
        // The Three scene is an imperative renderer resource, not React state.
        scene.environment = target.texture;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        skyTexture = texture;
        scene.background = texture;
        generator.dispose();
      },
      undefined,
      () => {
        /* The hemisphere and sun still light the world if an optional asset fails. */
      },
    );
    return () => {
      cancelled = true;
      if (target && scene.environment === target.texture)
        scene.environment = previous;
      if (skyTexture && scene.background === skyTexture)
        scene.background = previousBackground;
      skyTexture?.dispose();
      target?.dispose();
    };
  }, [gl, scene]);
  useEffect(() => {
    const previous = scene.environmentIntensity;
    const previousBackgroundIntensity = scene.backgroundIntensity;
    // eslint-disable-next-line react-hooks/immutability
    scene.environmentIntensity = 0.58 * (1 - nightFactor(timeOfDay) * 0.93);
    scene.backgroundIntensity = 0.72;
    return () => {
      scene.environmentIntensity = previous;
      scene.backgroundIntensity = previousBackgroundIntensity;
    };
  }, [scene, timeOfDay]);
  return null;
}
