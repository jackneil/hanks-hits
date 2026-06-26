import { LeaderboardsPage } from "@/apps/leaderboards";
import { SITE } from "@/config/site";

export const metadata = {
  title: `Leaderboards | ${SITE.name}`,
  description: "See how you rank against other players!",
};

export default function LeaderboardsRoute() {
  return <LeaderboardsPage />;
}
