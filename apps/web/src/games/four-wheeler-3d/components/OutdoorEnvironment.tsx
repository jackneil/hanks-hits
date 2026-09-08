"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { nightFactor } from "../lib/dayNight";

/** A baked outdoor light probe gives metal, rubber and paint different reflections. */
export function OutdoorEnvironment({ timeOfDay }: { timeOfDay: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const previous = scene.environment;
    const probe = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(50, 32, 16);
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    const sky = new THREE.Color("#96b9db");
    const horizon = new THREE.Color("#eee3cd");
    const ground = new THREE.Color("#4e5840");
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i) / 50;
      color
        .copy(horizon)
        .lerp(y > 0 ? sky : ground, Math.min(1, Math.abs(y) * 2));
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
    });
    probe.add(new THREE.Mesh(geometry, material));
    const generator = new THREE.PMREMGenerator(gl);
    const target = generator.fromScene(probe, 0.04, 0.1, 100);
    // Three scenes are mutable renderer objects, not React state.
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = target.texture;
    geometry.dispose();
    material.dispose();
    generator.dispose();
    return () => {
      scene.environment = previous;
      target.dispose();
    };
  }, [gl, scene]);
  useEffect(() => {
    const previous = scene.environmentIntensity;
    // Keep the mutable Three light probe in sync with the game clock.
    // eslint-disable-next-line react-hooks/immutability
    scene.environmentIntensity = 0.6 * (1 - nightFactor(timeOfDay) * 0.85);
    return () => {
      scene.environmentIntensity = previous;
    };
  }, [scene, timeOfDay]);
  return null;
}
