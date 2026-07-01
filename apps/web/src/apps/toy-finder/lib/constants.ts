/**
 * Toy Finder Constants
 * Categories, types, and curated kid-friendly toys
 */

// Toy categories
export const TOY_CATEGORIES = [
  { id: "all", label: "All Toys", emoji: "🎁" },
  { id: "action-figures", label: "Action Figures", emoji: "🦸" },
  { id: "lego", label: "LEGO", emoji: "🧱" },
  { id: "video-games", label: "Video Games", emoji: "🎮" },
  { id: "outdoor", label: "Outdoor", emoji: "⚽" },
  { id: "vehicles", label: "Vehicles", emoji: "🚗" },
  { id: "dolls", label: "Dolls", emoji: "🎀" },
  { id: "cards", label: "Cards & Collectibles", emoji: "🃏" },
] as const;

export type ToyCategory = (typeof TOY_CATEGORIES)[number]["id"];

// Age range filter
export const AGE_RANGES = [
  { id: "all", label: "All Ages" },
  { id: "6-8", label: "Ages 6-8" },
  { id: "9-12", label: "Ages 9-12" },
  { id: "13+", label: "Ages 13+" },
] as const;

export type AgeRange = (typeof AGE_RANGES)[number]["id"];

// Priority levels for wishlist
export const PRIORITIES = [
  { id: "need", label: "Top Idea", emoji: "🔥", color: "bg-red-500" },
  { id: "want", label: "Good Idea", emoji: "⭐", color: "bg-orange-400" },
  { id: "maybe", label: "Maybe", emoji: "🤔", color: "bg-gray-400" },
] as const;

export type Priority = (typeof PRIORITIES)[number]["id"];

// Toy interface
export interface Toy {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  emoji: string; // Using emoji as placeholder for images
  category: Exclude<ToyCategory, "all">;
  ageRange: Exclude<AgeRange, "all">;
  brand?: string;
  rating: number; // 1-5
  trending?: boolean;
  inStock: boolean;
}

// Curated kid-friendly toys
export const CURATED_TOYS: Toy[] = [
  // LEGO
  {
    id: "lego-star-wars-falcon",
    name: "LEGO Star Wars Millennium Falcon",
    description: "Build the iconic spaceship from Star Wars! Includes Han Solo and Chewbacca minifigures.",
    price: 169.99,
    originalPrice: 199.99,
    emoji: "🚀",
    category: "lego",
    ageRange: "9-12",
    brand: "LEGO",
    rating: 5,
    trending: true,
    inStock: true,
  },
  {
    id: "lego-technic-monster-jam",
    name: "LEGO Technic Monster Jam Megalodon",
    description: "Build and race the awesome shark-themed monster truck!",
    price: 19.99,
    emoji: "🦈",
    category: "lego",
    ageRange: "6-8",
    brand: "LEGO",
    rating: 4.8,
    trending: true,
    inStock: true,
  },
  {
    id: "lego-minecraft-village",
    name: "LEGO Minecraft The Village",
    description: "Create your own Minecraft village with villagers and a zombie!",
    price: 89.99,
    emoji: "🏠",
    category: "lego",
    ageRange: "9-12",
    brand: "LEGO",
    rating: 4.7,
    inStock: true,
  },
  {
    id: "lego-mario-starter",
    name: "LEGO Super Mario Starter Course",
    description: "Interactive Mario adventures with sounds and coin collecting!",
    price: 59.99,
    emoji: "🍄",
    category: "lego",
    ageRange: "6-8",
    brand: "LEGO",
    rating: 4.9,
    trending: true,
    inStock: true,
  },
  {
    id: "lego-city-fire-station",
    name: "LEGO City Fire Station",
    description: "Build a 3-level fire station with fire truck and motorcycle!",
    price: 79.99,
    emoji: "🚒",
    category: "lego",
    ageRange: "6-8",
    brand: "LEGO",
    rating: 4.6,
    inStock: true,
  },

  // VEHICLES
  {
    id: "hot-wheels-ultimate-garage",
    name: "Hot Wheels Ultimate Garage",
    description: "Mega garage that holds 100+ cars with track loops and a gorilla attack!",
    price: 109.99,
    emoji: "🏎️",
    category: "vehicles",
    ageRange: "6-8",
    brand: "Hot Wheels",
    rating: 4.7,
    trending: true,
    inStock: true,
  },
  {
    id: "hot-wheels-monster-trucks",
    name: "Hot Wheels Monster Trucks 5-Pack",
    description: "5 giant monster trucks ready to crush everything in their path!",
    price: 24.99,
    emoji: "🚛",
    category: "vehicles",
    ageRange: "6-8",
    brand: "Hot Wheels",
    rating: 4.5,
    inStock: true,
  },
  {
    id: "rc-monster-truck",
    name: "RC Monster Truck Off-Road",
    description: "Remote control monster truck that does flips and stunts!",
    price: 49.99,
    emoji: "🎮",
    category: "vehicles",
    ageRange: "6-8",
    brand: "New Bright",
    rating: 4.3,
    trending: true,
    inStock: true,
  },
  {
    id: "matchbox-action-drivers",
    name: "Matchbox Action Drivers Set",
    description: "Epic playset with car wash, gas station, and working elevator!",
    price: 39.99,
    emoji: "🚙",
    category: "vehicles",
    ageRange: "6-8",
    brand: "Matchbox",
    rating: 4.4,
    inStock: true,
  },

  // ACTION FIGURES
  {
    id: "minecraft-figures-8pack",
    name: "Minecraft Action Figures 8-Pack",
    description: "Steve, Alex, Creeper, and more! All your favorite Minecraft characters.",
    price: 34.99,
    emoji: "⛏️",
    category: "action-figures",
    ageRange: "6-8",
    brand: "Mattel",
    rating: 4.6,
    trending: true,
    inStock: true,
  },
  {
    id: "sonic-figures-set",
    name: "Sonic the Hedgehog Figure Set",
    description: "Sonic, Tails, Knuckles, and Dr. Eggman action figures!",
    price: 29.99,
    emoji: "🦔",
    category: "action-figures",
    ageRange: "6-8",
    brand: "Jakks Pacific",
    rating: 4.5,
    inStock: true,
  },
  {
    id: "pokemon-trainer-kit",
    name: "Pokemon Battle Trainer Kit",
    description: "Pikachu and other Pokemon figures with battle arena!",
    price: 39.99,
    emoji: "⚡",
    category: "action-figures",
    ageRange: "6-8",
    brand: "Pokemon",
    rating: 4.7,
    trending: true,
    inStock: true,
  },
  {
    id: "marvel-avengers-set",
    name: "Marvel Avengers Action Set",
    description: "Iron Man, Spider-Man, Captain America, and Hulk!",
    price: 44.99,
    emoji: "🦸",
    category: "action-figures",
    ageRange: "6-8",
    brand: "Hasbro",
    rating: 4.8,
    inStock: true,
  },
  {
    id: "transformers-optimus",
    name: "Transformers Optimus Prime",
    description: "Converts from robot to truck and back! Autobots, roll out!",
    price: 54.99,
    emoji: "🤖",
    category: "action-figures",
    ageRange: "9-12",
    brand: "Hasbro",
    rating: 4.6,
    inStock: true,
  },

  // VIDEO GAMES
  {
    id: "nintendo-mario-kart",
    name: "Mario Kart 8 Deluxe",
    description: "Race your friends on the Nintendo Switch! 48 tracks and tons of characters.",
    price: 49.99,
    emoji: "🏁",
    category: "video-games",
    ageRange: "6-8",
    brand: "Nintendo",
    rating: 4.9,
    trending: true,
    inStock: true,
  },
  {
    id: "nintendo-zelda",
    name: "Zelda: Tears of the Kingdom",
    description: "Epic adventure in Hyrule! Build, explore, and save the kingdom.",
    price: 69.99,
    emoji: "🗡️",
    category: "video-games",
    ageRange: "9-12",
    brand: "Nintendo",
    rating: 5,
    trending: true,
    inStock: true,
  },
  {
    id: "minecraft-switch",
    name: "Minecraft for Switch",
    description: "Build anything you can imagine! Play with friends anywhere.",
    price: 29.99,
    emoji: "🧱",
    category: "video-games",
    ageRange: "6-8",
    brand: "Mojang",
    rating: 4.8,
    inStock: true,
  },
  {
    id: "pokemon-violet",
    name: "Pokemon Violet",
    description: "Catch 'em all in the open world of Paldea!",
    price: 59.99,
    emoji: "🎮",
    category: "video-games",
    ageRange: "6-8",
    brand: "Nintendo",
    rating: 4.5,
    inStock: true,
  },
  {
    id: "super-smash-bros",
    name: "Super Smash Bros. Ultimate",
    description: "Everyone is here! Battle with 80+ characters.",
    price: 59.99,
    emoji: "👊",
    category: "video-games",
    ageRange: "9-12",
    brand: "Nintendo",
    rating: 4.9,
    trending: true,
    inStock: true,
  },
  {
    id: "roblox-gift-card",
    name: "Roblox Gift Card - 2000 Robux",
    description: "Get Robux to buy cool items and accessories!",
    price: 24.99,
    emoji: "💎",
    category: "video-games",
    ageRange: "6-8",
    brand: "Roblox",
    rating: 4.7,
    trending: true,
    inStock: true,
  },

  // OUTDOOR
  {
    id: "nerf-elite-2",
    name: "Nerf Elite 2.0 Commander",
    description: "Fire 6 darts in a row! Includes 12 elite darts.",
    price: 19.99,
    emoji: "🔫",
    category: "outdoor",
    ageRange: "6-8",
    brand: "Nerf",
    rating: 4.5,
    trending: true,
    inStock: true,
  },
  {
    id: "nerf-mega-mastodon",
    name: "Nerf MEGA Mastodon",
    description: "Motorized mega blaster! Fires huge mega darts super far.",
    price: 79.99,
    emoji: "🎯",
    category: "outdoor",
    ageRange: "9-12",
    brand: "Nerf",
    rating: 4.6,
    inStock: true,
  },
  {
    id: "soccer-goal-set",
    name: "Soccer Goal Training Set",
    description: "Portable soccer goal with ball and cones. Perfect for backyard!",
    price: 44.99,
    emoji: "⚽",
    category: "outdoor",
    ageRange: "6-8",
    brand: "Franklin Sports",
    rating: 4.4,
    inStock: true,
  },
  {
    id: "basketball-hoop",
    name: "Adjustable Basketball Hoop",
    description: "Height adjusts as you grow! From 5 to 10 feet.",
    price: 149.99,
    emoji: "🏀",
    category: "outdoor",
    ageRange: "6-8",
    brand: "Spalding",
    rating: 4.7,
    inStock: true,
  },
  {
    id: "golf-training-set",
    name: "Kids Golf Club Set",
    description: "Real junior golf clubs sized for kids! Includes bag.",
    price: 89.99,
    emoji: "⛳",
    category: "outdoor",
    ageRange: "6-8",
    brand: "Callaway",
    rating: 4.5,
    inStock: true,
  },
  {
    id: "razor-scooter",
    name: "Razor A5 Lux Scooter",
    description: "Smooth ride with big wheels! Folds up to carry.",
    price: 99.99,
    emoji: "🛴",
    category: "outdoor",
    ageRange: "6-8",
    brand: "Razor",
    rating: 4.6,
    trending: true,
    inStock: true,
  },

  // DOLLS
  {
    id: "barbie-dreamhouse",
    name: "Barbie DreamHouse",
    description: "3-story dollhouse with pool, slide, and 75+ pieces!",
    price: 199.99,
    emoji: "🏰",
    category: "dolls",
    ageRange: "6-8",
    brand: "Barbie",
    rating: 4.8,
    trending: true,
    inStock: true,
  },
  {
    id: "barbie-camper",
    name: "Barbie Dream Camper",
    description: "Hit the road! Camper transforms into a campsite playset.",
    price: 99.99,
    emoji: "🚐",
    category: "dolls",
    ageRange: "6-8",
    brand: "Barbie",
    rating: 4.6,
    inStock: true,
  },
  {
    id: "lol-surprise",
    name: "LOL Surprise OMG Fashion Doll",
    description: "Unbox surprises and style your OMG fashion doll!",
    price: 34.99,
    emoji: "💖",
    category: "dolls",
    ageRange: "6-8",
    brand: "LOL Surprise",
    rating: 4.4,
    trending: true,
    inStock: true,
  },
  {
    id: "american-girl",
    name: "American Girl Truly Me Doll",
    description: "Create your own American Girl doll! Choose hair, eyes, and more.",
    price: 115.00,
    emoji: "👧",
    category: "dolls",
    ageRange: "9-12",
    brand: "American Girl",
    rating: 4.9,
    inStock: true,
  },

  // CARDS & COLLECTIBLES
  {
    id: "pokemon-elite-trainer",
    name: "Pokemon Elite Trainer Box",
    description: "9 booster packs, dice, sleeves, and collector box!",
    price: 49.99,
    emoji: "📦",
    category: "cards",
    ageRange: "6-8",
    brand: "Pokemon",
    rating: 4.8,
    trending: true,
    inStock: true,
  },
  {
    id: "pokemon-binder",
    name: "Pokemon Card Binder Collection",
    description: "Cool binder to store and show off your Pokemon cards!",
    price: 19.99,
    emoji: "📒",
    category: "cards",
    ageRange: "6-8",
    brand: "Ultra Pro",
    rating: 4.5,
    inStock: true,
  },
  {
    id: "topps-baseball",
    name: "Topps Baseball Cards 2025",
    description: "Collect your favorite baseball players!",
    price: 24.99,
    emoji: "⚾",
    category: "cards",
    ageRange: "6-8",
    brand: "Topps",
    rating: 4.3,
    inStock: true,
  },
  {
    id: "nba-panini",
    name: "NBA Panini Prizm Cards",
    description: "Chase shiny prizm parallels of NBA stars!",
    price: 39.99,
    emoji: "🏀",
    category: "cards",
    ageRange: "9-12",
    brand: "Panini",
    rating: 4.6,
    trending: true,
    inStock: true,
  },
  {
    id: "squishmallows",
    name: "Squishmallows 16-inch Plush",
    description: "Super soft and squishy! Perfect for hugging and collecting.",
    price: 24.99,
    emoji: "🧸",
    category: "cards",
    ageRange: "6-8",
    brand: "Squishmallows",
    rating: 4.8,
    trending: true,
    inStock: true,
  },
];

/**
 * Get toys filtered by category
 */
export function getToysByCategory(category: ToyCategory): Toy[] {
  if (category === "all") return CURATED_TOYS;
  return CURATED_TOYS.filter((t) => t.category === category);
}

/**
 * Get toys filtered by age range
 */
export function getToysByAge(ageRange: AgeRange): Toy[] {
  if (ageRange === "all") return CURATED_TOYS;
  return CURATED_TOYS.filter((t) => t.ageRange === ageRange);
}

/**
 * Get a toy by ID
 */
export function getToyById(id: string): Toy | undefined {
  return CURATED_TOYS.find((t) => t.id === id);
}
