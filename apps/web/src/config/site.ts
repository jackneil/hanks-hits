import siteConfig from "./site.json";

/**
 * Single source of truth for site branding.
 *
 * To rebrand the whole site (e.g. "Jimmie's Hits"), edit `site.json` — change
 * `siteName` and `ownerName`. That file ships to Railway on deploy, so the live
 * site updates on the next build. You can also override per-deployment with env
 * vars set in the Railway dashboard: NEXT_PUBLIC_SITE_NAME, NEXT_PUBLIC_OWNER_NAME.
 */
export const SITE = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || siteConfig.siteName || "Hank's Hits",
  owner: process.env.NEXT_PUBLIC_OWNER_NAME || siteConfig.ownerName || "Hank",
  tagline: siteConfig.tagline || "Games, apps, and awesome stuff! 🚀",
  description: siteConfig.description || "Games, trucks, and awesome stuff!",
  emoji: siteConfig.emoji || "🎮",
} as const;
