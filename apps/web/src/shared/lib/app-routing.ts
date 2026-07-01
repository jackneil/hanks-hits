import { getGameMetadata } from "./gameMetadata.generated";

export function getPlayableHref(appId: string): string {
  const metadata = getGameMetadata(appId);
  return metadata.category === "apps" ? `/apps/${appId}` : `/games/${appId}`;
}
