"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * WebGL gate for 3D games.
 *
 * Without this, a device that can't create a WebGL context (old GPU, GPU
 * blocklisted, hardware acceleration off) renders a silent black void with a
 * working HUD (2026-07-10 audit, High). We feature-detect up front and show a
 * kid-friendly explanation instead.
 */

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      // Safari fallback naming for very old versions
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

export function WebGLFallback({ gameName }: { gameName: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-gradient-to-b from-indigo-900 to-purple-900 text-white">
      <div className="text-7xl" aria-hidden>
        🛠️
      </div>
      <h2 className="text-2xl md:text-3xl font-bold">
        {gameName} needs 3D powers this device doesn&apos;t have right now
      </h2>
      <p className="max-w-md text-white/80">
        This game uses 3D graphics, and your browser couldn&apos;t turn them
        on. Try a different browser or computer, or ask a grown-up to check
        that hardware acceleration is switched on.
      </p>
      <Link
        href="/"
        className="mt-2 px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all font-bold text-lg min-h-[44px] flex items-center"
      >
        🏠 Back to Games
      </Link>
    </div>
  );
}

/**
 * Wrap a 3D game's scene. Renders children only when a WebGL context can be
 * created; otherwise shows the friendly fallback.
 */
export function WebGLGate({
  gameName,
  children,
}: {
  gameName: string;
  children: React.ReactNode;
}) {
  // null = not yet checked (SSR-safe: detection needs the DOM)
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(detectWebGL());
  }, []);

  if (supported === null) return null;
  if (!supported) return <WebGLFallback gameName={gameName} />;
  return <>{children}</>;
}
