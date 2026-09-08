/**
 * The 24 minute day: the clock, the sun, the weather and the snow.
 *
 * Every rule here comes straight from the 2D game so the 3D world feels the
 * same. One real second is one game minute, the sun is up from 6 in the
 * morning until 8 at night, and a new day rolls fresh weather.
 *
 * Nothing here touches React or Three, so it is all easy to test.
 */

/** The four kinds of weather, the same list the 2D game uses. */
export const WEATHERS = ["sunny", "rainy", "foggy", "snowy"] as const;
export type Weather = (typeof WEATHERS)[number];

/** One real second is one game minute, so a whole day takes 24 minutes. */
export const GAME_HOURS_PER_REAL_SECOND = 1 / 60;

/** Snow piles up this fast while it snows, and melts this fast after. */
const SNOW_FALL_PER_SECOND = 0.03;
const SNOW_MELT_PER_SECOND = 0.012;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move the clock forward. `newDay` is true on the tick that passes midnight. */
export function advanceClock(
  timeOfDay: number,
  dtSeconds: number
): { timeOfDay: number; newDay: boolean } {
  const next = timeOfDay + dtSeconds * GAME_HOURS_PER_REAL_SECOND;
  if (next >= 24) return { timeOfDay: next % 24, newDay: true };
  return { timeOfDay: next, newDay: false };
}

/**
 * How dark it is right now: 0 in full day, 1 in deep night.
 * Day runs 8 to 20, dusk darkens across 20 to 21, dawn brightens across 7 to 8.
 */
export function nightFactor(timeOfDay: number): number {
  const t = timeOfDay;
  if (t >= 8 && t < 20) return 0;
  if (t >= 20 && t < 21) return t - 20;
  if (t >= 7 && t < 8) return 8 - t;
  return 1;
}

/**
 * A unit vector pointing at the sun. It rises in the east at 6 in the morning,
 * crosses the sky, and sets in the west at 8 at night. Between those it is
 * below the horizon, which is what puts the moon light in charge.
 */
export function sunPosition(timeOfDay: number): [number, number, number] {
  const dayProgress = (((timeOfDay - 6) % 24) + 24) % 24 / 14;
  const angle = Math.PI * dayProgress;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const z = 0.28;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/** Pick tomorrow's weather. Sunny most days, the rest now and then. */
export function rollWeather(rand: () => number): Weather {
  const roll = rand();
  if (roll < 0.62) return "sunny";
  if (roll < 0.77) return "rainy";
  if (roll < 0.88) return "foggy";
  return "snowy";
}

/** How thick the air is, 0 clear to 1 soup. */
export function fogDensity(timeOfDay: number, weather: Weather): number {
  const night = nightFactor(timeOfDay);
  const base = weather === "foggy" ? 0.8 : weather === "snowy" ? 0.45 : weather === "rainy" ? 0.35 : 0.12;
  return clamp01(base + night * 0.18);
}

/** Snow builds up while it snows and melts away once it stops. */
export function updateSnowLevel(
  snowLevel: number,
  weather: Weather,
  dtSeconds: number
): number {
  if (weather === "snowy") {
    return Math.min(1, snowLevel + dtSeconds * SNOW_FALL_PER_SECOND);
  }
  return Math.max(0, snowLevel - dtSeconds * SNOW_MELT_PER_SECOND);
}

// ============================================================================
// COLOURS
// ============================================================================

type Rgb = [number, number, number];

/** The day palette, before night and weather move it. */
const DAY = {
  skyTop: [0.29, 0.56, 0.89] as Rgb,
  skyBottom: [0.72, 0.86, 0.98] as Rgb,
  fog: [0.76, 0.86, 0.95] as Rgb,
};

/** The night palette. Deep blue, never pitch black, so kids can still see. */
const NIGHT = {
  skyTop: [0.03, 0.05, 0.16] as Rgb,
  skyBottom: [0.08, 0.11, 0.26] as Rgb,
  fog: [0.06, 0.09, 0.2] as Rgb,
};

/** How each kind of weather pulls the colours around. */
const WEATHER_TINT: Record<Weather, { color: Rgb; amount: number }> = {
  sunny: { color: [1, 1, 1], amount: 0 },
  rainy: { color: [0.34, 0.4, 0.48], amount: 0.55 },
  foggy: { color: [0.82, 0.84, 0.86], amount: 0.6 },
  snowy: { color: [0.86, 0.9, 0.96], amount: 0.5 },
};

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function toHex(color: Rgb): string {
  const part = (value: number) =>
    Math.round(clamp01(value) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(color[0])}${part(color[1])}${part(color[2])}`;
}

/** Everything the sky, the fog and the lights need for one moment in time. */
export type SkyPalette = {
  skyTop: string;
  skyBottom: string;
  fog: string;
  ambientIntensity: number;
  sunIntensity: number;
  fogNear: number;
  fogFar: number;
};

/** The colours and light levels for a time of day and a kind of weather. */
export function skyColors(timeOfDay: number, weather: Weather): SkyPalette {
  const night = nightFactor(timeOfDay);
  const tint = WEATHER_TINT[weather];

  const blend = (day: Rgb, dark: Rgb): string =>
    toHex(mix(mix(day, dark, night), tint.color, tint.amount * (1 - night * 0.5)));

  const density = fogDensity(timeOfDay, weather);

  return {
    skyTop: blend(DAY.skyTop, NIGHT.skyTop),
    skyBottom: blend(DAY.skyBottom, NIGHT.skyBottom),
    fog: blend(DAY.fog, NIGHT.fog),
    // Full night is 62 percent darker, the same drop the 2D game uses.
    ambientIntensity: lerp(0.85, 0.85 * 0.38, night) * (1 - tint.amount * 0.3),
    sunIntensity: lerp(1.5, 0.0, night) * (1 - tint.amount * 0.5),
    fogNear: lerp(180, 25, density),
    fogFar: lerp(1400, 190, density),
  };
}

// ============================================================================
// THE CLOCK BADGE
// ============================================================================

/** The clock as a kid reads it, like "8:00 AM". */
export function formatClock(timeOfDay: number): string {
  const wrapped = ((timeOfDay % 24) + 24) % 24;
  const hour24 = Math.floor(wrapped);
  const minute = Math.floor((wrapped - hour24) * 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return `${hour12}:${minute < 10 ? "0" : ""}${minute} ${suffix}`;
}

/** The badge emoji: the weather if there is any, otherwise the sun or moon. */
export function clockIcon(timeOfDay: number, weather: Weather): string {
  if (weather === "rainy") return "🌧️";
  if (weather === "snowy") return "❄️";
  if (weather === "foggy") return "🌫️";
  return timeOfDay >= 8 && timeOfDay < 20 ? "☀️" : "🌙";
}
