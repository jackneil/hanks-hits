"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SHORE_RADIUS } from "../lib/terrain";
import { LAKE } from "../lib/landmarks";

/** A repeatable normal tile, generated locally with no image transfer. */
function rippleNormals() {
  const side = 128;
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const u = (x / side) * Math.PI * 2;
      const v = (y / side) * Math.PI * 2;
      const nx =
        Math.cos(u * 5 + v * 3) * 0.32 + Math.cos(u * 11 - v * 7) * 0.12;
      const ny =
        Math.sin(v * 7 - u * 2) * 0.28 + Math.cos(u * 4 + v * 13) * 0.1;
      const normal = new THREE.Vector3(nx, ny, 1).normalize();
      const i = (y * side + x) * 4;
      data[i] = (normal.x * 0.5 + 0.5) * 255;
      data[i + 1] = (normal.y * 0.5 + 0.5) * 255;
      data[i + 2] = (normal.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(data, side, side);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Shallow lake color and sky reflections with small, physically oriented surface ripples. */
export function Water() {
  const timeUniform = useRef({ value: 0 });
  const motion = useRef(true);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      motion.current = !query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const resources = useMemo(() => {
    const normal = rippleNormals();
    const material = new THREE.MeshPhysicalMaterial({
      color: "#2c6560",
      roughness: 0.2,
      metalness: 0.12,
      clearcoat: 0.75,
      clearcoatRoughness: 0.14,
      ior: 1.333,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.48, 0.48),
      transparent: true,
      opacity: 0.91,
      depthWrite: false,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterTime = timeUniform.current;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uWaterTime;\nvarying vec2 vWaterPosition;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vWaterPosition = position.xy;
          transformed.z += sin(position.x * 0.07 + uWaterTime * 0.5) * cos(position.y * 0.09 - uWaterTime * 0.4) * 0.065;
        `,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uWaterTime;\nvarying vec2 vWaterPosition;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float radius = length(vWaterPosition);
          if (radius > ${SHORE_RADIUS.toFixed(1)}) discard;
          float shore = smoothstep(${(SHORE_RADIUS - 20).toFixed(1)}, ${SHORE_RADIUS.toFixed(1)}, radius);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.27, 0.21), shore * 0.55);
          diffuseColor.a *= mix(1.0, 0.24, shore);
        `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `
          vec2 waterUv = vWaterPosition / 18.0;
          vec3 rippleA = texture2D(normalMap, waterUv + vec2(uWaterTime * 0.008, uWaterTime * 0.004)).xyz * 2.0 - 1.0;
          vec3 rippleB = texture2D(normalMap, waterUv * 1.73 + vec2(-uWaterTime * 0.006, uWaterTime * 0.009)).xyz * 2.0 - 1.0;
          vec3 waterNormal = normalize(vec3((rippleA.xy + rippleB.xy) * normalScale, 1.0));
          normal = normalize(tbn * waterNormal);
        `,
        );
    };
    material.customProgramCacheKey = () => "hanks-water-reflections-v2";
    const geometry = new THREE.PlaneGeometry(
      SHORE_RADIUS * 2,
      SHORE_RADIUS * 2,
      64,
      64,
    );
    return { material, geometry, normal };
  }, []);
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.material.dispose();
      resources.normal.dispose();
    },
    [resources],
  );
  useFrame((_, delta) => {
    if (motion.current) timeUniform.current.value += Math.min(delta, 0.05);
  });
  return (
    <mesh
      geometry={resources.geometry}
      material={resources.material}
      position={[LAKE.x, 0, LAKE.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    />
  );
}

export default Water;
