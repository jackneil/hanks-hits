// Retro Arcade - EmulatorJS Configuration and Game List

// Supported console/system types
export type SystemType = "nes" | "snes" | "gb" | "gba" | "segaMD" | "n64" | "atari2600";

// System metadata
export interface SystemInfo {
  id: SystemType;
  name: string;
  fullName: string;
  color: string;
  bgGradient: string;
  icon: string;
  extensions: string[];
  ejsCore: string;
}

// System definitions with their colors and EmulatorJS core names
export const SYSTEMS: Record<SystemType, SystemInfo> = {
  nes: {
    id: "nes",
    name: "NES",
    fullName: "Nintendo Entertainment System",
    color: "#E60012",
    bgGradient: "from-red-600 to-red-800",
    icon: "🎮",
    extensions: [".nes", ".zip"],
    ejsCore: "nes",
  },
  snes: {
    id: "snes",
    name: "SNES",
    fullName: "Super Nintendo",
    color: "#7B1FA2",
    bgGradient: "from-purple-600 to-purple-800",
    icon: "🎮",
    extensions: [".smc", ".sfc", ".zip"],
    ejsCore: "snes",
  },
  gb: {
    id: "gb",
    name: "Game Boy",
    fullName: "Nintendo Game Boy",
    color: "#4CAF50",
    bgGradient: "from-green-500 to-green-700",
    icon: "📱",
    extensions: [".gb", ".gbc", ".zip"],
    ejsCore: "gb",
  },
  gba: {
    id: "gba",
    name: "GBA",
    fullName: "Game Boy Advance",
    color: "#2196F3",
    bgGradient: "from-blue-500 to-blue-700",
    icon: "📱",
    extensions: [".gba", ".zip"],
    ejsCore: "gba",
  },
  segaMD: {
    id: "segaMD",
    name: "Genesis",
    fullName: "Sega Genesis / Mega Drive",
    color: "#212121",
    bgGradient: "from-gray-800 to-yellow-600",
    icon: "🎮",
    extensions: [".md", ".gen", ".bin", ".zip"],
    ejsCore: "segaMD",
  },
  n64: {
    id: "n64",
    name: "N64",
    fullName: "Nintendo 64",
    color: "#FF5722",
    bgGradient: "from-orange-500 via-green-500 to-blue-500",
    icon: "🎮",
    extensions: [".n64", ".z64", ".v64", ".zip"],
    ejsCore: "n64",
  },
  atari2600: {
    id: "atari2600",
    name: "Atari 2600",
    fullName: "Atari 2600",
    color: "#8B4513",
    bgGradient: "from-amber-700 to-orange-900",
    icon: "🕹️",
    extensions: [".bin", ".a26", ".zip"],
    ejsCore: "atari2600",
  },
};

// Game metadata
export interface GameInfo {
  id: string;
  name: string;
  system: SystemType;
  genre: string;
  description: string;
  romPath?: string; // Optional for pre-loaded games
  isCustom?: boolean; // User-uploaded ROM
}

// Pre-loaded homebrew games (user will need to provide their own ROMs)
// These are just metadata - actual ROMs must be user-provided
export const SAMPLE_GAMES: GameInfo[] = [
  // NES games placeholder
  {
    id: "nes-custom",
    name: "Upload NES ROM",
    system: "nes",
    genre: "Custom",
    description: "Upload your own NES ROM file to play",
    isCustom: true,
  },
  // SNES games placeholder
  {
    id: "snes-custom",
    name: "Upload SNES ROM",
    system: "snes",
    genre: "Custom",
    description: "Upload your own SNES ROM file to play",
    isCustom: true,
  },
  // Game Boy games placeholder
  {
    id: "gb-custom",
    name: "Upload Game Boy ROM",
    system: "gb",
    genre: "Custom",
    description: "Upload your own Game Boy ROM file to play",
    isCustom: true,
  },
  // GBA games placeholder
  {
    id: "gba-custom",
    name: "Upload GBA ROM",
    system: "gba",
    genre: "Custom",
    description: "Upload your own GBA ROM file to play",
    isCustom: true,
  },
  // Genesis games placeholder
  {
    id: "segaMD-custom",
    name: "Upload Genesis ROM",
    system: "segaMD",
    genre: "Custom",
    description: "Upload your own Genesis/Mega Drive ROM file to play",
    isCustom: true,
  },
  // N64 games placeholder
  {
    id: "n64-custom",
    name: "Upload N64 ROM",
    system: "n64",
    genre: "Custom",
    description: "Upload your own N64 ROM file to play",
    isCustom: true,
  },
  // Atari 2600 games placeholder
  {
    id: "atari2600-custom",
    name: "Upload Atari 2600 ROM",
    system: "atari2600",
    genre: "Custom",
    description: "Upload your own Atari 2600 ROM file to play",
    isCustom: true,
  },
];

// Get games for a specific system
export function getGamesForSystem(system: SystemType): GameInfo[] {
  return SAMPLE_GAMES.filter((game) => game.system === system);
}

// Validate file extension for a system
export function isValidRomFile(file: File, system: SystemType): boolean {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return SYSTEMS[system].extensions.includes(ext);
}

// Get system by ID
export function getSystem(id: SystemType): SystemInfo | undefined {
  return SYSTEMS[id];
}

// All system IDs as array
export const SYSTEM_IDS = Object.keys(SYSTEMS) as SystemType[];
