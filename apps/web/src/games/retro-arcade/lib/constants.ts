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
  /**
   * The one solid color of the console's card on the first screen (a
   * Tailwind class). No gradient and no colored border. White text on each
   * color has a contrast of at least 4.9:1, and no two consoles share a
   * color.
   */
  cardColor: string;
  icon: string;
  extensions: string[];
  /**
   * The EJS_core value for this console: an EmulatorJS system name or a core
   * name. For a system name, EmulatorJS picks the first core of the system
   * and the player can pick another in its Settings. A core name pins that
   * core: the emulator page hides the Core setting and forgets a stored core
   * choice, so EmulatorJS loads that core only, on every device. The emulator
   * page (public/emulator/index.html) has the same value for each console,
   * and emulator-page.test.ts checks that the two agree.
   */
  ejsCore: string;
  /**
   * The EmulatorJS control layout (EJS_controlScheme), when ejsCore is a core
   * name. Without it, EmulatorJS uses the layout of the system of that core.
   */
  ejsControlScheme?: string;
}

// System definitions with their colors and EmulatorJS core names
export const SYSTEMS: Record<SystemType, SystemInfo> = {
  nes: {
    id: "nes",
    name: "NES",
    fullName: "Nintendo Entertainment System",
    color: "#E60012",
    bgGradient: "from-red-600 to-red-800",
    cardColor: "bg-red-700",
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
    cardColor: "bg-purple-700",
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
    cardColor: "bg-green-700",
    icon: "📱",
    extensions: [".gb", ".gbc", ".zip"],
    // mGBA (MPL-2.0) plays Game Boy and Game Boy Color games. It replaced
    // Gambatte, the EmulatorJS default for "gb". Both pass dmg-acid2 and
    // cgb-acid2. Gambatte is GPL-2.0 only, and each core file links the core
    // with GPL-3.0 RetroArch; MPL-2.0 is compatible with GPL-3.0. mGBA is the
    // GBA core, so the Game Boy control layout is set here. The emulator page
    // moves old Gambatte battery saves to mGBA (index.html).
    ejsCore: "mgba",
    ejsControlScheme: "gb",
  },
  gba: {
    id: "gba",
    name: "GBA",
    fullName: "Game Boy Advance",
    color: "#2196F3",
    bgGradient: "from-blue-500 to-blue-700",
    cardColor: "bg-blue-700",
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
    cardColor: "bg-sky-700",
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
    cardColor: "bg-orange-700",
    icon: "🎮",
    extensions: [".n64", ".z64", ".v64", ".zip"],
    // mupen64plus_next on every device. For "n64", EmulatorJS 4.2.3 picks
    // parallel_n64 on a phone with Safari (it reverses the N64 core order
    // there) and mupen64plus_next everywhere else. On a real iPhone SE
    // (iOS 27), parallel_n64 stopped at frame 24 with "RuntimeError: Out of
    // bounds memory access" (a black picture), and a start from its save
    // state hung the tab; Chromium did the same. mupen64plus_next booted,
    // saved, loaded and resumed its 16.8 MB state on that iPhone. The core
    // name pins it, so the site hosts no parallel_n64.
    ejsCore: "mupen64plus_next",
    ejsControlScheme: "n64",
  },
  atari2600: {
    id: "atari2600",
    name: "Atari 2600",
    fullName: "Atari 2600",
    color: "#8B4513",
    bgGradient: "from-amber-700 to-orange-900",
    cardColor: "bg-amber-800",
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
