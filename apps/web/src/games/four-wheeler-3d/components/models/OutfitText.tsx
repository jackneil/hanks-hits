"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFourWheeler3dStore } from "../../lib/store";
export function OutfitText({
  position,
  back = false,
  width = 0.3,
}: {
  position: [number, number, number];
  back?: boolean;
  width?: number;
}) {
  const text = useFourWheeler3dStore((s) => s.progress.adventure.outfit.text);
  const texture = useMemo(() => {
    if (typeof document === "undefined" || !text) return null;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.font = "700 64px sans-serif";
    ctx.fillStyle = "#fff8dc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64, 490);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [text]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture ? (
    <mesh position={position} rotation={[0, back ? Math.PI : 0, 0]}>
      <planeGeometry args={[width, width / 4]} />
      <meshStandardMaterial
        map={texture}
        transparent
        depthWrite={false}
        roughness={0.95}
      />
    </mesh>
  ) : null;
}
