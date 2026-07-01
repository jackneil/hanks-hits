/**
 * Weather App Constants
 * Weather icons, fun facts, and default locations
 */

// Weather condition types for mapping API responses
export type WeatherCondition =
  | "sunny"
  | "partly-cloudy"
  | "cloudy"
  | "rainy"
  | "stormy"
  | "snowy"
  | "foggy"
  | "windy";

// Weather icon configuration
export interface WeatherIcon {
  condition: WeatherCondition;
  emoji: string;
  label: string;
  color: string;
  bgGradient: string;
}

// Weather icons with kid-friendly styling
export const WEATHER_ICONS: Record<WeatherCondition, WeatherIcon> = {
  sunny: {
    condition: "sunny",
    emoji: "\u2600\uFE0F",
    label: "Sunny",
    color: "#FFD93D",
    bgGradient: "from-yellow-300 via-yellow-400 to-orange-300",
  },
  "partly-cloudy": {
    condition: "partly-cloudy",
    emoji: "\u26C5",
    label: "Partly Cloudy",
    color: "#87CEEB",
    bgGradient: "from-blue-300 via-blue-400 to-yellow-300",
  },
  cloudy: {
    condition: "cloudy",
    emoji: "\u2601\uFE0F",
    label: "Cloudy",
    color: "#A8D8EA",
    bgGradient: "from-gray-300 via-gray-400 to-blue-300",
  },
  rainy: {
    condition: "rainy",
    emoji: "\uD83C\uDF27\uFE0F",
    label: "Rainy",
    color: "#6C9BCF",
    bgGradient: "from-blue-400 via-blue-500 to-gray-500",
  },
  stormy: {
    condition: "stormy",
    emoji: "\u26C8\uFE0F",
    label: "Stormy",
    color: "#5C6BC0",
    bgGradient: "from-purple-500 via-gray-600 to-gray-700",
  },
  snowy: {
    condition: "snowy",
    emoji: "\u2744\uFE0F",
    label: "Snowy",
    color: "#E3F2FD",
    bgGradient: "from-blue-100 via-white to-blue-200",
  },
  foggy: {
    condition: "foggy",
    emoji: "\uD83C\uDF2B\uFE0F",
    label: "Foggy",
    color: "#B0BEC5",
    bgGradient: "from-gray-300 via-gray-400 to-gray-500",
  },
  windy: {
    condition: "windy",
    emoji: "\uD83D\uDCA8",
    label: "Windy",
    color: "#81C784",
    bgGradient: "from-green-300 via-teal-400 to-blue-400",
  },
};

// Map Open-Meteo WMO weather codes to our conditions
// https://open-meteo.com/en/docs
export function mapWeatherCode(code: number): WeatherCondition {
  // Clear
  if (code === 0) return "sunny";
  // Mainly clear, partly cloudy
  if (code === 1 || code === 2) return "partly-cloudy";
  // Overcast
  if (code === 3) return "cloudy";
  // Fog
  if (code >= 45 && code <= 48) return "foggy";
  // Drizzle
  if (code >= 51 && code <= 57) return "rainy";
  // Freezing rain
  if (code >= 66 && code <= 67) return "snowy";
  // Rain
  if (code >= 61 && code <= 65) return "rainy";
  // Snowfall
  if (code >= 71 && code <= 77) return "snowy";
  // Rain showers
  if (code >= 80 && code <= 82) return "rainy";
  // Snow showers
  if (code >= 85 && code <= 86) return "snowy";
  // Thunderstorm
  if (code >= 95 && code <= 99) return "stormy";

  return "cloudy"; // Default fallback
}

// Get weather description for kids
export function getKidFriendlyDescription(
  condition: WeatherCondition,
  temp: number,
  isDay: boolean
): string {
  const descriptions: Record<WeatherCondition, string[]> = {
    sunny: [
      "Perfect day to play outside!",
      "The sun is smiling at you!",
      "What a beautiful sunny day!",
      "Great weather for adventures!",
    ],
    "partly-cloudy": [
      "Sun and clouds are playing together!",
      "A nice mix of sun and clouds!",
      "The clouds are taking a peek!",
      "Pretty clouds floating by!",
    ],
    cloudy: [
      "The clouds are giving us shade!",
      "Cozy cloud blanket in the sky!",
      "Perfect for outdoor games!",
      "The sky is wearing a gray hat!",
    ],
    rainy: [
      "Splash in some puddles!",
      "Perfect weather for rubber boots!",
      "The flowers are getting a drink!",
      "Cozy day inside or play in the rain!",
    ],
    stormy: [
      "Lightning and thunder show!",
      "Stay safe inside and watch the storm!",
      "Nature is putting on a show!",
      "Time for cozy indoor activities!",
    ],
    snowy: [
      "Time to build a snowman!",
      "Snow day adventure!",
      "Let it snow, let it snow!",
      "Snowball fight weather!",
    ],
    foggy: [
      "The clouds came down to visit!",
      "Mysterious foggy day!",
      "Like walking through a cloud!",
      "The world is playing hide and seek!",
    ],
    windy: [
      "Hold onto your hat!",
      "Perfect kite flying weather!",
      "The wind is dancing!",
      "Whoosh! Feel that breeze!",
    ],
  };

  const options = descriptions[condition];
  const randomIndex = Math.floor(Math.random() * options.length);

  // Add temperature-based comments
  let tempComment = "";
  if (temp >= 90) tempComment = " Stay cool and drink water!";
  else if (temp >= 80) tempComment = " Nice and warm!";
  else if (temp <= 32) tempComment = " Brrr, it's freezing!";
  else if (temp <= 50) tempComment = " Bundle up!";

  // Night-specific adjustment
  if (!isDay && condition === "sunny") {
    return "Clear skies with stars above!" + tempComment;
  }

  return options[randomIndex] + tempComment;
}

// Outfit recommendations based on weather
export function getOutfitRecommendations(
  temp: number,
  condition: WeatherCondition
): string[] {
  const recommendations: string[] = [];

  // Temperature-based clothing
  if (temp >= 80) {
    recommendations.push("T-shirt and shorts");
    recommendations.push("Sandals or sneakers");
    recommendations.push("Sunglasses");
    recommendations.push("Don't forget sunscreen!");
  } else if (temp >= 65) {
    recommendations.push("T-shirt or light long sleeve");
    recommendations.push("Shorts or light pants");
    recommendations.push("Maybe bring a light jacket");
  } else if (temp >= 50) {
    recommendations.push("Long sleeve shirt or sweater");
    recommendations.push("Pants or jeans");
    recommendations.push("Light jacket");
  } else if (temp >= 35) {
    recommendations.push("Warm sweater or fleece");
    recommendations.push("Warm pants");
    recommendations.push("Jacket or coat");
    recommendations.push("Maybe a hat!");
  } else {
    recommendations.push("Warm winter coat");
    recommendations.push("Hat, gloves, and scarf");
    recommendations.push("Warm boots");
    recommendations.push("Bundle up - it's COLD!");
  }

  // Weather condition additions
  if (condition === "rainy" || condition === "stormy") {
    recommendations.push("Bring an umbrella!");
    recommendations.push("Rain boots or waterproof shoes");
  }

  if (condition === "snowy") {
    recommendations.push("Wear warm boots!");
    recommendations.push("Waterproof gloves");
  }

  if (condition === "sunny" && temp >= 70) {
    if (!recommendations.includes("Sunglasses")) {
      recommendations.push("Sunglasses");
    }
  }

  return recommendations;
}

// Fun weather facts for kids
export const WEATHER_FACTS = [
  "Lightning is 5 times hotter than the surface of the sun!",
  "A single cloud can weigh over a million pounds!",
  "Snowflakes can take up to 1 hour to fall from the clouds!",
  "The fastest wind ever recorded was 253 mph during a tornado!",
  "Rain contains vitamin B12!",
  "A hurricane can release energy equal to 10,000 nuclear bombs!",
  "Crickets chirp faster when it's warmer!",
  "Raindrops can fall as fast as 20 miles per hour!",
  "The wettest place on Earth gets 467 inches of rain per year!",
  "It can be too cold to snow!",
  "Fog is basically a cloud touching the ground!",
  "Hail can be as big as a softball!",
  "Thunder is caused by lightning heating the air so fast it explodes!",
  "A dust devil is a mini tornado!",
  "The coldest temperature ever was -128.6 F in Antarctica!",
  "The hottest temperature ever was 134 F in Death Valley!",
  "Every snowflake has 6 sides!",
  "Wind has no color - we just see what it's moving!",
  "Rainbows are actually full circles - we just see half!",
  "Clouds look white because they reflect all colors of light!",
  "A raindrop falls at about 14 mph!",
  "The Sahara Desert can drop to 25 F at night!",
  "Antarctica is the driest place on Earth!",
  "There are about 40,000 thunderstorms every day!",
  "The sky looks blue because of how sunlight scatters!",
];

export function getRandomFact(): string {
  const randomIndex = Math.floor(Math.random() * WEATHER_FACTS.length);
  return WEATHER_FACTS[randomIndex];
}

// Default/popular locations for quick selection
export const DEFAULT_LOCATIONS = [
  { name: "New York", latitude: 40.7128, longitude: -74.006 },
  { name: "Los Angeles", latitude: 34.0522, longitude: -118.2437 },
  { name: "Chicago", latitude: 41.8781, longitude: -87.6298 },
  { name: "Denver", latitude: 39.7392, longitude: -104.9903 },
  { name: "Miami", latitude: 25.7617, longitude: -80.1918 },
  { name: "Seattle", latitude: 47.6062, longitude: -122.3321 },
  { name: "Dallas", latitude: 32.7767, longitude: -96.797 },
  { name: "Phoenix", latitude: 33.4484, longitude: -112.074 },
];

// API URLs (Open-Meteo - free, no API key needed)
export const WEATHER_API = {
  forecast:
    "https://api.open-meteo.com/v1/forecast",
  geocoding:
    "https://geocoding-api.open-meteo.com/v1/search",
};
