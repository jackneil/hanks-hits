"use client";

import { useEffect } from "react";

import { useAdventureSession } from "../lib/adventureSession";

/**
 * Escape closes an open panel or the hunting scope first.
 *
 * The site's pause menu (GameShell) pauses on any other Escape. This listens
 * in the capture phase, so it runs before the shell, and it marks the key as
 * used, so one press never closes a panel and pauses the game as well.
 */
export function useAdventureEscape() {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      const session = useAdventureSession.getState();
      if (session.panel) session.openPanel(null);
      else if (session.scope) useAdventureSession.setState({ scope: false });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, []);
}
