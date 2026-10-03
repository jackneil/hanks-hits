"use client";

import { Html } from "@react-three/drei";
import { useFourWheeler3dStore } from "../../lib/store";

/** Private customization stays visible on the rider but outside the captured
 * WebGL canvas. Raycast occlusion preserves the shirt's position in the scene;
 * never use Html's blending mode, which introduces a canvas-backed plane.
 */
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
  if (!text) return null;
  return (
    <Html
      position={position}
      rotation={[0, back ? Math.PI : 0, 0]}
      transform
      occlude
      distanceFactor={width * 400 / 512}
      pointerEvents="none"
      zIndexRange={[1, 0]}
    >
      <div
        aria-hidden="true"
        data-private-outfit-text=""
        style={{
          width: 512,
          height: 128,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          whiteSpace: "nowrap",
          color: "#fff8dc",
          font: `700 ${Math.min(64, 490 / Math.max(1, Array.from(text).length))}px sans-serif`,
          backfaceVisibility: "hidden",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {text}
      </div>
    </Html>
  );
}
