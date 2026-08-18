"use client";

import { useEffect, useState } from "react";

/**
 * Four-Wheeler Adventure
 *
 * Wrapped as-is from Hank's original single-file build (a ~5,500-line
 * hand-built open-world sandbox: ATV racing, hunting, fishing, boats,
 * planes, a helper dog, dealerships, and more). It is served as a static
 * asset and shown full-screen in an iframe rather than ported to React,
 * to preserve exact behavior with zero risk of gameplay regressions.
 *
 * Layout note: GameShell renders a fixed, translucent header
 * (h-12 / md:h-14) above all game content. Hank's game draws its own HUD
 * (score/speed badges) at a fixed `top: 14px` *inside its own document*,
 * so if this iframe covered the full viewport, the shell header would
 * sit on top of and obscure that HUD. Instead we anchor the iframe just
 * below the header (top-12 / md:top-14) so nothing overlaps.
 *
 * Framing note: the site's global security headers send
 * `X-Frame-Options: DENY` / `frame-ancestors 'none'` on every route
 * (see next.config.ts), which blocks a plain `<iframe src="...">` from
 * loading the static game file — even same-origin. Rather than widen the
 * site-wide framing policy for one game, we fetch the (fully
 * self-contained, single-file) game HTML client-side and load it via
 * `srcDoc` instead: `srcDoc` content has no HTTP response of its own, so
 * those framing headers never come into play.
 */
export function FourWheelerAdventureGame() {
  const [isReady, setIsReady] = useState(false);
  const [gameHtml, setGameHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);

  useEffect(() => {
    const handleRestart = () => {
      setIsReady(false);
      setLoadError(false);
      setRestartNonce((nonce) => nonce + 1);
    };
    window.addEventListener("four-wheeler-restart", handleRestart);
    return () => window.removeEventListener("four-wheeler-restart", handleRestart);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/games/four-wheeler-adventure/index.html")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        return res.text();
      })
      .then((html) => {
        if (!cancelled) setGameHtml(html);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed left-0 right-0 bottom-0 top-12 md:top-14 bg-[#1f6b3a]">
      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1f6b3a] z-10">
          <div className="text-6xl mb-4 animate-bounce">🐕</div>
          <p className="text-white text-xl font-bold">
            {loadError
              ? "Couldn't load the game. Try refreshing!"
              : "Loading Four-Wheeler Adventure..."}
          </p>
        </div>
      )}

      {gameHtml !== null && (
        <iframe
          key={restartNonce}
          srcDoc={gameHtml}
          title="Four-Wheeler Adventure"
          className="w-full h-full border-0"
          allow="autoplay; fullscreen"
          onLoad={() => setIsReady(true)}
        />
      )}

      {/* Bottom-right: the game draws its own Camera/map/race cluster in the
          top-right, which this button used to cover (2026-07-10 audit). */}
    </div>
  );
}

export default FourWheelerAdventureGame;
