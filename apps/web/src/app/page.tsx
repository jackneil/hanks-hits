import { discoverGamesAndApps } from "@/shared/lib/game-registry";
import { HomeClient } from "./HomeClient";

// Server component - discovers games at build time
export default async function Home() {
  const categories = await discoverGamesAndApps();

  return <HomeClient categories={categories} />;
}
