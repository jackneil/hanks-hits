"use client";

import type { GameDisplayInfo } from "@/shared/lib/gameStatExtractor";
import { MonsterTruckDetails } from "./MonsterTruckDetails";
import { HillClimbDetails } from "./HillClimbDetails";
import { OregonTrailDetails } from "./OregonTrailDetails";
import { CookieClickerDetails } from "./CookieClickerDetails";

interface GameDetailViewProps {
  game: GameDisplayInfo;
}

/**
 * Routes to the appropriate detail component based on game type.
 */
export function GameDetailView({ game }: GameDetailViewProps) {
  switch (game.appId) {
    case "monster-truck":
      return <MonsterTruckDetails data={game.fullData} />;
    case "hill-climb":
      return <HillClimbDetails data={game.fullData} />;
    case "oregon-trail":
      return <OregonTrailDetails data={game.fullData} />;
    case "cookie-clicker":
      return <CookieClickerDetails data={game.fullData} />;
    default:
      return null;
  }
}

export { MonsterTruckDetails } from "./MonsterTruckDetails";
export { HillClimbDetails } from "./HillClimbDetails";
export { OregonTrailDetails } from "./OregonTrailDetails";
export { CookieClickerDetails } from "./CookieClickerDetails";
