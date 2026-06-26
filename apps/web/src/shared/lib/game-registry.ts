// ==============================================
// GAME & APP REGISTRY - Dynamic Discovery
// ==============================================

import fs from "fs";
import path from "path";

// Metadata type that each game/app exports
export interface GameMetadata {
  id: string;
  name: string;
  emoji: string;
  category: CategoryId;
  description?: string;
  hidden?: boolean; // Set true to hide from home page
  madeByKid?: boolean; // Set true on games the kid built/remixed — powers the "my-creations" shelf
}

// Category definitions
export type CategoryId =
  | "racing"
  | "board"
  | "arcade"
  | "action"
  | "puzzle"
  | "retro"
  | "apps";

export interface Category {
  id: CategoryId;
  title: string;
  emoji: string;
  gradient: string;
  bgClass: string;
}

export const CATEGORY_CONFIG: Record<CategoryId, Category> = {
  racing: {
    id: "racing",
    title: "Racing & Driving",
    emoji: "🏎️",
    gradient: "from-red-500 via-orange-500 to-yellow-500",
    bgClass: "bg-gradient-to-br from-red-950 via-orange-950 to-yellow-950",
  },
  board: {
    id: "board",
    title: "Board Games",
    emoji: "♟️",
    gradient: "from-amber-400 via-yellow-500 to-lime-500",
    bgClass: "bg-gradient-to-br from-amber-950 via-yellow-950 to-lime-950",
  },
  arcade: {
    id: "arcade",
    title: "Arcade Classics",
    emoji: "🕹️",
    gradient: "from-green-400 via-emerald-500 to-teal-500",
    bgClass: "bg-gradient-to-br from-green-950 via-emerald-950 to-teal-950",
  },
  action: {
    id: "action",
    title: "Action Games",
    emoji: "🎮",
    gradient: "from-cyan-400 via-blue-500 to-indigo-500",
    bgClass: "bg-gradient-to-br from-cyan-950 via-blue-950 to-indigo-950",
  },
  puzzle: {
    id: "puzzle",
    title: "Puzzle Games",
    emoji: "🧩",
    gradient: "from-violet-400 via-purple-500 to-fuchsia-500",
    bgClass: "bg-gradient-to-br from-violet-950 via-purple-950 to-fuchsia-950",
  },
  retro: {
    id: "retro",
    title: "Retro Gaming",
    emoji: "🎰",
    gradient: "from-purple-400 via-fuchsia-500 to-pink-500",
    bgClass: "bg-gradient-to-br from-purple-950 via-fuchsia-950 to-pink-950",
  },
  apps: {
    id: "apps",
    title: "Fun Apps",
    emoji: "📱",
    gradient: "from-pink-400 via-rose-500 to-red-500",
    bgClass: "bg-gradient-to-br from-pink-950 via-rose-950 to-red-950",
  },
};

// Category display order
export const CATEGORY_ORDER: CategoryId[] = [
  "racing",
  "board",
  "arcade",
  "action",
  "puzzle",
  "retro",
  "apps",
];

// Item for display (with computed href)
export interface DisplayItem {
  href: string;
  emoji: string;
  name: string;
  id: string;
}

export interface DisplayCategory extends Category {
  items: DisplayItem[];
}

/**
 * Discover all games and apps by scanning directories for metadata.ts files.
 * This runs at build time (server-side only).
 */
export async function discoverGamesAndApps(): Promise<DisplayCategory[]> {
  const games = await scanDirectory("games");
  const apps = await scanDirectory("apps");

  const allItems = [...games, ...apps];

  // Group by category
  const grouped = new Map<CategoryId, DisplayItem[]>();

  for (const item of allItems) {
    if (item.hidden) continue;

    const categoryItems = grouped.get(item.category) || [];
    categoryItems.push({
      href: item.category === "apps" ? `/apps/${item.id}` : `/games/${item.id}`,
      emoji: item.emoji,
      name: item.name,
      id: item.id,
    });
    grouped.set(item.category, categoryItems);
  }

  // Build display categories in order
  const categories: DisplayCategory[] = [];

  for (const categoryId of CATEGORY_ORDER) {
    const items = grouped.get(categoryId);
    if (items && items.length > 0) {
      categories.push({
        ...CATEGORY_CONFIG[categoryId],
        items,
      });
    }
  }

  return categories;
}

/**
 * Scan a directory for metadata.ts files
 */
async function scanDirectory(type: "games" | "apps"): Promise<GameMetadata[]> {
  const items: GameMetadata[] = [];

  try {
    // Get the src directory path
    const srcDir = path.join(process.cwd(), "src", type);

    // Check if directory exists
    if (!fs.existsSync(srcDir)) {
      console.warn(`Directory not found: ${srcDir}`);
      return items;
    }

    const dirs = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;

      const metadataPath = path.join(srcDir, dir.name, "metadata.ts");

      if (fs.existsSync(metadataPath)) {
        try {
          // Read and parse the metadata file
          const content = fs.readFileSync(metadataPath, "utf-8");
          const metadata = parseMetadata(content, dir.name, type);
          if (metadata) {
            items.push(metadata);
          }
        } catch (err) {
          console.warn(`Failed to parse metadata for ${dir.name}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning ${type} directory:`, err);
  }

  return items;
}

/**
 * Parse metadata from file content (simple regex-based parser)
 * This avoids needing to actually import/execute the TS files
 */
function parseMetadata(
  content: string,
  dirName: string,
  type: "games" | "apps"
): GameMetadata | null {
  try {
    // Extract values using regex
    const idMatch = content.match(/id:\s*["']([^"']+)["']/);
    const nameMatch = content.match(/name:\s*["']([^"']+)["']/);
    const emojiMatch = content.match(/emoji:\s*["']([^"']+)["']/);
    const categoryMatch = content.match(/category:\s*["']([^"']+)["']/);
    const hiddenMatch = content.match(/hidden:\s*(true|false)/);
    const descMatch = content.match(/description:\s*["']([^"']+)["']/);

    if (!nameMatch || !emojiMatch || !categoryMatch) {
      console.warn(`Missing required fields in metadata for ${dirName}`);
      return null;
    }

    return {
      id: idMatch ? idMatch[1] : dirName,
      name: nameMatch[1],
      emoji: emojiMatch[1],
      category: categoryMatch[1] as CategoryId,
      hidden: hiddenMatch ? hiddenMatch[1] === "true" : false,
      description: descMatch ? descMatch[1] : undefined,
    };
  } catch {
    return null;
  }
}
