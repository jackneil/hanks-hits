import siteConfig from "./site.json";

/**
 * Single source of truth for site branding.
 *
 * To rebrand the whole site (e.g. "Jimmie's Hits"), edit `site.json` — change
 * BOTH `siteName` and `ownerName`. That one file ships to Railway on deploy, so
 * the browser title, home page, footer, link previews, and the installable app
 * name all update on the next build. Editing this file is the only step — there
 * is no separate env var (a `NEXT_PUBLIC_*` override would render inconsistently
 * between server and client, so we keep it to one place).
 */
export const SITE = {
  name: siteConfig.siteName || "Hank's Hits",
  owner: siteConfig.ownerName || "Hank",
  tagline: siteConfig.tagline || "Games, apps, and awesome stuff! 🚀",
  description: siteConfig.description || "Games, trucks, and awesome stuff!",
  emoji: siteConfig.emoji || "🎮",
} as const;
