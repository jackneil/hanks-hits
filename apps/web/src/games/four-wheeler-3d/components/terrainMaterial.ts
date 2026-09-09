"use client";

import * as THREE from "three";

const snowUniform = { value: 0 };
let material: THREE.MeshStandardMaterial | null = null;

/** World-aligned local PBR maps blend across the exact existing terrain surface. */
export function getTerrainMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  const loader = new THREE.TextureLoader();
  const load = (slug: string, channel: "diff" | "nor_gl") => {
    const texture = loader.load(
      `/games/four-wheeler-3d/assets/${slug}/${slug}_${channel}_1k.jpg`,
    );
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    if (channel === "diff") texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const forest = load("forest_ground_04", "diff");
  const dirt = load("brown_mud_03", "diff");
  const asphalt = load("aerial_asphalt_01", "diff");
  const normal = load("forest_ground_04", "nor_gl");
  const dirtNormal = load("brown_mud_03", "nor_gl");
  const asphaltNormal = load("aerial_asphalt_01", "nor_gl");
  const built = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: forest,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.94,
  });
  built.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSnow: snowUniform,
      uDirtMap: { value: dirt },
      uAsphaltMap: { value: asphalt },
      uDirtNormal: { value: dirtNormal },
      uAsphaltNormal: { value: asphaltNormal },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 surfaceBlend;\nvarying vec2 vSurfaceBlend;\nvarying float vUpFacing;",
      )
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nvUpFacing = normalize(objectNormal).y;\nvSurfaceBlend = surfaceBlend;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uSnow;\nuniform sampler2D uDirtMap;\nuniform sampler2D uAsphaltMap;\nuniform sampler2D uDirtNormal;\nuniform sampler2D uAsphaltNormal;\nvarying vec2 vSurfaceBlend;\nvarying float vUpFacing;",
      )
      .replace(
        "#include <map_fragment>",
        `
        vec3 forestColor = texture2D(map, vMapUv).rgb;
        vec3 broadColor = texture2D(map, vMapUv * 0.17).rgb;
        float grain = dot(forestColor, vec3(0.299, 0.587, 0.114));
        vec3 ground = vColor.rgb * mix(0.5, 1.05, smoothstep(0.01, 0.35, grain));
        ground *= mix(0.83, 1.06, clamp(dot(broadColor, vec3(0.333)) * 3.0, 0.0, 1.0));
        vec3 dirtColor = texture2D(uDirtMap, vMapUv * 1.5).rgb;
        vec3 asphaltColor = texture2D(uAsphaltMap, vMapUv * 0.75).rgb;
        diffuseColor.rgb *= mix(mix(ground, dirtColor, vSurfaceBlend.x), asphaltColor, vSurfaceBlend.y);
      `,
      )
      .replace(
        "#include <color_fragment>",
        `
        float snowCover = uSnow * smoothstep(0.55, 0.92, vUpFacing) * 0.85;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.96, 0.99), snowCover);
      `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `
        vec3 terrainNormal = texture2D(normalMap, vNormalMapUv).xyz;
        terrainNormal = mix(terrainNormal, texture2D(uDirtNormal, vNormalMapUv * 1.5).xyz, vSurfaceBlend.x);
        terrainNormal = mix(terrainNormal, texture2D(uAsphaltNormal, vNormalMapUv * 0.75).xyz, vSurfaceBlend.y);
        terrainNormal = terrainNormal * 2.0 - 1.0;
        terrainNormal.xy *= normalScale * (1.0 - uSnow * 0.7);
        normal = normalize(tbn * terrainNormal);
      `,
      );
  };
  built.customProgramCacheKey = () => "hanks-terrain-pbr-v2";
  material = built;
  return built;
}

export function setTerrainSnowLevel(level: number): void {
  snowUniform.value = Math.min(1, Math.max(0, level));
}
