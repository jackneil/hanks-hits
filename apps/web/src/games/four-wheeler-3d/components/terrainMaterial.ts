"use client";

/**
 * One shared material for every terrain chunk.
 *
 * Sharing it means the snow blanket is a single uniform that the weather
 * component moves, instead of one material per loaded chunk. The chunk meshes
 * carry their own colours in the geometry, so one material still paints
 * grass, dirt, sand, rock and mountain snow correctly.
 */

import * as THREE from "three";

/** How white the ground goes at snowLevel 1, on the faces pointing up. */
const MAX_SNOW_WHITENESS = 0.85;

const snowUniform = { value: 0 };

let material: THREE.MeshStandardMaterial | null = null;

/** The material every chunk mesh uses. Built once, on first use. */
export function getTerrainMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;

  const built = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
  });

  built.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = snowUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vUpFacing;"
      )
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nvUpFacing = normalize(objectNormal).y;"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uSnow;\nvarying float vUpFacing;"
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float snowCover = uSnow * smoothstep(0.55, 0.92, vUpFacing) * ${MAX_SNOW_WHITENESS.toFixed(2)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.96, 0.99), snowCover);`
      );
  };

  material = built;
  return built;
}

/** Set how deep the snow lies, 0 to 1. Called from the render loop. */
export function setTerrainSnowLevel(level: number): void {
  snowUniform.value = Math.min(1, Math.max(0, level));
}
