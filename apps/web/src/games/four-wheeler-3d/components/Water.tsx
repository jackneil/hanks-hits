"use client";

/**
 * The lake. A flat disc at height 0 with a gentle moving swell.
 *
 * The waves are a small shader on top of the standard material, so the water
 * still catches the sun and the moon. There is no physics here yet: boats and
 * floating arrive with the lake milestone.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { SHORE_RADIUS } from "../lib/terrain";
import { LAKE } from "../lib/landmarks";

/** How far the surface rises and falls, in meters. */
const WAVE_HEIGHT = 0.14;

export function Water() {
  const timeUniform = useRef({ value: 0 });

  const material = useMemo(() => {
    const built = new THREE.MeshStandardMaterial({
      color: "#2f7f96",
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.86,
    });

    built.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform.current;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime;\nvarying float vRipple;\nvarying float vRadius;"
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float swell = sin(position.x * 0.06 + uTime * 0.9) * cos(position.y * 0.05 - uTime * 0.7);
          float chop = sin(position.x * 0.31 - uTime * 1.7) * sin(position.y * 0.27 + uTime * 1.4);
          vRipple = swell * 0.7 + chop * 0.3;
          vRadius = length(position.xy);
          transformed.z += vRipple * ${WAVE_HEIGHT.toFixed(3)};`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vRipple;\nvarying float vRadius;"
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (vRadius > ${SHORE_RADIUS.toFixed(1)}) discard;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.78, 0.74), clamp(vRipple * 0.5 + 0.5, 0.0, 1.0) * 0.35);`
        );
    };

    return built;
  }, []);

  // A square sheet, with everything past the shore thrown away in the
  // shader. A fan-shaped circle would only have vertices on its rim, so the
  // waves would have nothing to move in the middle of the lake.
  const geometry = useMemo(
    () => new THREE.PlaneGeometry(SHORE_RADIUS * 2, SHORE_RADIUS * 2, 96, 96),
    []
  );

  useFrame((state) => {
    timeUniform.current.value = state.clock.elapsedTime;
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[LAKE.x, 0, LAKE.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    />
  );
}

export default Water;
