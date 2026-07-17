import { getGameMetadata } from "./gameMetadata.generated";
import type { CategoryId } from "./game-registry";

/**
 * The one owner of the app-vs-game route shape. Callers that already hold
 * the category (an injected catalog, a registry item) use this directly so
 * a future route change has exactly one place to happen.
 */
export function hrefForCategory(appId: string, category: CategoryId): string {
  return category === "apps" ? `/apps/${appId}` : `/games/${appId}`;
}

export function getPlayableHref(appId: string): string {
  return hrefForCategory(appId, getGameMetadata(appId).category);
}
