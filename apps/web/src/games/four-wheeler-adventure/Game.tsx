"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { GameStartOverlay } from "@/shared/components";

interface FourWheelerAdventureGameProps {
  /** Changes whenever the shell confirms a fresh game restart. */
  restartNonce?: number;
}

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
export function FourWheelerAdventureGame({
  restartNonce = 0,
}: FourWheelerAdventureGameProps) {
  const [gameHtml, setGameHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadedRestartNonce, setLoadedRestartNonce] = useState<number | null>(null);
  // The kid presses Play on the shared start overlay before the iframe mounts.
  // A restart keeps hasStarted true, so it drops straight back into play.
  const [hasStarted, setHasStarted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isReady = loadedRestartNonce === restartNonce;

  // The game document carries its own start panel. Press its button for the
  // kid so one Play press is all it takes. srcDoc iframes are same-origin, so
  // the button is reachable. This also runs on a restart remount.
  const handleIframeLoad = useCallback(() => {
    setLoadedRestartNonce(restartNonce);
    const playBtn = iframeRef.current?.contentDocument?.getElementById(
      "playBtn"
    ) as HTMLElement | null;
    playBtn?.click();
    // Hand the keyboard to the iframe: arrow/WASD keys go to the focused
    // document, and without this the parent page keeps focus, so a desktop
    // player has to click the game before any key does anything.
    iframeRef.current?.contentWindow?.focus();
  }, [restartNonce]);

  useEffect(() => {
    let cancelled = false;

    fetch("/games/four-wheeler-adventure/index.html")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        return res.text();
      })
      .then((html) => {
        if (!cancelled) {
          setGameHtml(html);
          setLoadedRestartNonce(restartNonce);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [restartNonce]);

  return (
    <div className="fixed left-0 right-0 bottom-0 top-12 md:top-14 bg-[#1f6b3a]">
      {hasStarted && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1f6b3a] z-10">
          <div className="text-6xl mb-4 animate-bounce">🐕</div>
          <p className="text-white text-xl font-bold">
            {loadError
              ? "Couldn't load the game. Try refreshing!"
              : "Loading Four-Wheeler Adventure..."}
          </p>
        </div>
      )}

      {/* The iframe mounts only after Play: its own start panel is pressed
          automatically on load, so mounting it earlier would start the game
          behind the overlay. The HTML itself is already fetched and cached. */}
      {hasStarted && gameHtml !== null && (
        <iframe
          ref={iframeRef}
          key={restartNonce}
          srcDoc={gameHtml}
          title="Four-Wheeler Adventure"
          className="w-full h-full border-0"
          allow="autoplay; fullscreen"
          onLoad={handleIframeLoad}
        />
      )}

      {!hasStarted && (
        <GameStartOverlay
          title="Four-Wheeler Adventure"
          emoji="🛻"
          subtitle="Ride around, race, fish, and explore with your dog!"
          touchHints={[
            "🦶 Tap GAS to go, BRAKE to stop",
            "👈👉 Tap the arrows to steer",
            "🤸 Tap JUMP for a stunt",
          ]}
          keyboardHints={[
            "🦶 Press W or the up arrow to go",
            "🛑 Press S or the down arrow to stop",
            "👈👉 Press A and D to steer",
            "🤸 Press the space bar to jump",
          ]}
          onStart={() => setHasStarted(true)}
        />
      )}

      {/* Bottom-right: the game draws its own Camera/map/race cluster in the
          top-right, which this button used to cover (2026-07-10 audit). */}
    </div>
  );
}

export default FourWheelerAdventureGame;
