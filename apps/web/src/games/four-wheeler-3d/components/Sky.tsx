"use client";
import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import { Sky as DreiSky, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  nightFactor,
  skyColors,
  sunPosition,
  type Weather,
} from "../lib/dayNight";
import { useGameContext } from "../lib/gameContext";

const SHADOW_BOX = 20,
  SUN_DISTANCE = 90;
const skyVertex = `varying vec3 direction;
void main(){ direction=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w; }`;
const nightFragment = `uniform vec3 zenith;uniform vec3 horizon;uniform float amount;varying vec3 direction;
void main(){float elevation=max(0.,normalize(direction).y);vec3 color=mix(horizon,zenith,pow(elevation,.42));gl_FragColor=vec4(color,amount);
#include <colorspace_fragment>
}`;

/** Locally authored, deterministic lunar albedo. No network texture or animated twinkle. */
function moonTexture() {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  let seed = 19;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const craters = Array.from({ length: 44 }, () => ({
    x: rand() * 1.65 - 0.825,
    y: rand() * 1.65 - 0.825,
    r: 0.025 + rand() * 0.16,
    depth: 0.03 + rand() * 0.14,
  }));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1,
        v = ((y + 0.5) / size) * 2 - 1,
        r = Math.hypot(u, v),
        i = (y * size + x) * 4;
      if (r >= 1) continue;
      const normalZ = Math.sqrt(1 - r * r),
        light = Math.max(0.13, u * 0.3 + v * 0.15 + normalZ * 0.92);
      let albedo = 0.88;
      for (const c of craters) {
        const d = Math.hypot(u - c.x, v - c.y) / c.r;
        if (d < 1) albedo -= c.depth * (1 - d * d);
        else if (d < 1.13) albedo += c.depth * 0.3;
      }
      const value = Math.min(255, Math.max(0, 255 * albedo * light));
      data[i] = value;
      data[i + 1] = value * 0.98;
      data[i + 2] = value * 0.92;
      data[i + 3] = Math.min(1, (1 - r) * 128) * 255;
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Atmospheric daylight plus an explicit night hemisphere; scattering alone turns gray below the horizon. */
export function GameSky({
  timeOfDay,
  weather,
}: {
  timeOfDay: number;
  weather: Weather;
}) {
  const { playerPos } = useGameContext();
  const daySky = useRef<ComponentRef<typeof DreiSky>>(null),
    nightDome =
      useRef<THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);
  const skyGroup = useRef<THREE.Group>(null),
    sunRef = useRef<THREE.DirectionalLight>(null),
    moonRef = useRef<THREE.DirectionalLight>(null),
    moonDisc = useRef<THREE.Sprite>(null),
    starsRef = useRef<THREE.Points>(null);
  const scratch = useMemo(() => new THREE.Vector3(), []),
    clockRef = useRef({ timeOfDay, weather });
  const texture = useMemo(() => moonTexture(), []),
    nightMaterial = useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: skyVertex,
          fragmentShader: nightFragment,
          uniforms: {
            zenith: { value: new THREE.Color("#071328") },
            horizon: { value: new THREE.Color("#253d58") },
            amount: { value: 0 },
          },
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      [],
    );
  useEffect(
    () => () => {
      texture.dispose();
      nightMaterial.dispose();
    },
    [texture, nightMaterial],
  );
  useEffect(() => {
    clockRef.current = { timeOfDay, weather };
  }, [timeOfDay, weather]);
  const palette = skyColors(timeOfDay, weather),
    sun = sunPosition(timeOfDay),
    rawNight = nightFactor(timeOfDay),
    night = rawNight * rawNight * (3 - 2 * rawNight),
    clear = weather === "sunny" ? 1 : weather === "foggy" ? 0.12 : 0.35;
  const fogColor = useMemo(
    () =>
      new THREE.Color(palette.fog).lerp(
        new THREE.Color("#263b54"),
        night * 0.35,
      ),
    [palette.fog, night],
  );
  const skyFill = useMemo(
    () =>
      new THREE.Color(palette.skyBottom).lerp(
        new THREE.Color("#a9c4e8"),
        night,
      ),
    [palette.skyBottom, night],
  );
  const groundFill = useMemo(
    () => new THREE.Color("#62543b").lerp(new THREE.Color("#425970"), night),
    [night],
  );
  useEffect(() => {
    const material = nightDome.current?.material;
    if (material) {
      material.uniforms.amount.value = night;
      material.uniforms.zenith.value
        .set("#071328")
        .lerp(new THREE.Color("#202d3e"), 1 - clear);
      material.uniforms.horizon.value.copy(fogColor);
    }
    const stars = starsRef.current;
    if (stars) {
      stars.renderOrder = -1000;
      stars.visible = night * clear > 0.02;
      const colors = stars.geometry.getAttribute("color");
      if (colors) {
        const array = colors.array as Float32Array;
        for (let i = 0; i < array.length; i++) array[i] = 0.82 * night * clear;
        colors.needsUpdate = true;
      }
    }
  }, [night, clear, fogColor, nightMaterial]);
  useEffect(() => {
    const light = sunRef.current;
    if (!light) return;
    Object.assign(light.shadow.camera, {
      left: -SHADOW_BOX,
      right: SHADOW_BOX,
      top: SHADOW_BOX,
      bottom: -SHADOW_BOX,
      near: 1,
      far: SUN_DISTANCE * 2.4,
    });
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.025;
    light.shadow.radius = 2;
    light.shadow.camera.updateProjectionMatrix();
  }, []);
  useFrame(({ camera, scene }) => {
    if (daySky.current) {
      daySky.current.visible = !(scene.background instanceof THREE.Texture);
      daySky.current.renderOrder = -1002;
    }
    const player = playerPos.current,
      direction = sunPosition(clockRef.current.timeOfDay);
    // Camera centering keeps the backdrop stable in far/orbit views and at flight altitude.
    skyGroup.current?.position.copy(camera.position);
    scratch.set(direction[0], Math.abs(direction[1]), direction[2]);
    const light = sunRef.current;
    if (light) {
      light.position.copy(scratch).multiplyScalar(SUN_DISTANCE).add(player);
      light.target.position.copy(player);
      light.target.updateMatrixWorld();
    }
    // The moon crosses the upper sky opposite the sun during the night.
    scratch
      .set(-direction[0], Math.max(0.12, -direction[1]), -direction[2])
      .normalize();
    if (moonDisc.current)
      moonDisc.current.position.copy(scratch).multiplyScalar(620);
    const moon = moonRef.current;
    if (moon) {
      moon.position.copy(scratch).multiplyScalar(90).add(player);
      moon.target.position.copy(player);
      moon.target.updateMatrixWorld();
    }
  });
  return (
    <>
      <group ref={skyGroup}>
        <DreiSky
          ref={daySky}
          distance={900}
          sunPosition={sun}
          turbidity={weather === "sunny" ? 3 : 9}
          rayleigh={1.4}
          mieCoefficient={0.006}
          mieDirectionalG={0.85}
        />
        <mesh
          ref={nightDome}
          material={nightMaterial}
          renderOrder={-1001}
          frustumCulled={false}
        >
          <sphereGeometry args={[850, 32, 16]} />
        </mesh>
        <Stars
          ref={starsRef}
          radius={650}
          depth={40}
          count={1800}
          factor={3}
          fade
          speed={0}
        />
        <sprite ref={moonDisc} scale={[22, 22, 1]} renderOrder={-999}>
          <spriteMaterial
            map={texture}
            transparent
            opacity={night * clear * 0.92}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
      </group>
      <fog attach="fog" args={[fogColor, palette.fogNear, palette.fogFar]} />
      <hemisphereLight
        intensity={Math.max(0.68 * night, palette.ambientIntensity * 0.8)}
        color={skyFill}
        groundColor={groundFill}
      />
      <directionalLight
        ref={sunRef}
        castShadow
        intensity={palette.sunIntensity * 1.6}
        color={night > 0.2 ? "#ffd9a8" : "#fff6e0"}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight
        ref={moonRef}
        intensity={night * 0.78}
        color="#b2c8eb"
      />
    </>
  );
}
export default GameSky;
