import { readSavedLocations, readLastLocation, writeSavedLocations, writeLastLocation } from "./localWords";
import { createWordProjection } from "@/lib/progress-words";
import { localWords } from "@/lib/local-words";
import { bindWordConsumer } from "@/lib/local-words/consumer";
import { bindPersistedStore } from "@/lib/owner-bound-progress";
import { createOwnerPersistStorage } from "@/lib/owner-bound-progress/persistStorage";
/**
 * Weather App Zustand Store
 * Handles location, preferences, and persistence
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { sameProgress } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";
import type { WeatherCondition } from "./constants";

// Location data from geocoding API
export interface GeoLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string; // State/region
}

// Current weather data from API
export interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  weatherCode: number;
  condition: WeatherCondition;
  humidity: number;
  windSpeed: number;
  isDay: boolean;
}

// Forecast day data
export interface ForecastDay {
  date: string;
  dayName: string;
  tempHigh: number;
  tempLow: number;
  weatherCode: number;
  condition: WeatherCondition;
  precipChance: number;
}

// Progress data shape (for sync)
export interface WeatherProgress {
  [key: string]: unknown;
  savedLocations: GeoLocation[];
  units: "fahrenheit" | "celsius";
  lastLocation: GeoLocation | null;
  lastModified: number;
}

// Store state
interface WeatherStoreState extends WeatherProgress {
  // Current session state (not persisted in sync)
  currentWeather: CurrentWeather | null;
  forecast: ForecastDay[] | null;
  searchResults: GeoLocation[];
  isLoading: boolean;
  isSearching: boolean;
  error: string | null;
  searchQuery: string;
  currentFact: string;
}

// Store actions
interface WeatherStoreActions {
  // Location actions
  setLastLocation: (location: GeoLocation | null) => void;
  addSavedLocation: (location: GeoLocation) => void;
  removeSavedLocation: (name: string) => void;
  isSavedLocation: (name: string) => boolean;

  // Search actions
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: GeoLocation[]) => void;
  setIsSearching: (searching: boolean) => void;
  clearSearch: () => void;

  // Weather data actions
  setCurrentWeather: (weather: CurrentWeather | null) => void;
  setForecast: (forecast: ForecastDay[] | null) => void;

  // Settings
  setUnits: (units: "fahrenheit" | "celsius") => void;
  toggleUnits: () => void;

  // UI state
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentFact: (fact: string) => void;

  // Sync helpers
  getProgress: () => WeatherProgress;
  setProgress: (data: WeatherProgress) => void;
}

const STORAGE_KEY = "weather-app-progress";

const projectWords = createWordProjection<WeatherProgress>("weather");

const defaultProgress: WeatherProgress = {
  savedLocations: [],
  units: "fahrenheit",
  lastLocation: null,
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// Settings are not progress: a device that changed only a setting holds
// nothing that must win over the account (shared/lib/untouchedProgress.ts).
const UNTOUCHED = defineUntouchedProgress("weather", {
  layout: "flat",
  defaults: defaultProgress,
  ignore: ["units"],
  // The items that a player makes (addListItems: an item made here and not
  // saved yet joins progress that the page takes). `max` is the schema's
  // bound (progress-schemas.ts); addSavedLocation adds at the end.
  lists: { savedLocations: { id: "name", max: 50, order: "newestLast" } },
});

export const useWeatherStore = create<WeatherStoreState & WeatherStoreActions>()(
  persist(
    (set, get) => ({
      // Initial state
      ...defaultProgress,
      currentWeather: null,
      forecast: null,
      searchResults: [],
      isLoading: false,
      isSearching: false,
      error: null,
      searchQuery: "",
      currentFact: "",

      // Location actions
      setLastLocation: (location) => {
        // The page loads the weather of the last place on every visit: the
        // same place again is no change.
        if (sameProgress(get().lastLocation, location)) return;
        const lease = localWords.captureLease();
        if (lease) void writeLastLocation(lease, location);
        set({
          lastLocation: location,
        });
      },

      addSavedLocation: (location) => {
        const existing = get().savedLocations;
        // Don't add duplicates
        if (existing.some((l) => l.name === location.name)) return;
        const lease = localWords.captureLease();
        if (lease) void writeSavedLocations(lease, [...existing, location]);
        set({
          savedLocations: [...existing, location],
        });
      },

      removeSavedLocation: (name) => {
        if (!get().savedLocations.some((l) => l.name === name)) return;
        const lease = localWords.captureLease();
        if (lease) void writeSavedLocations(lease, get().savedLocations.filter(l => l.name !== name));
        set((state) => ({
          savedLocations: state.savedLocations.filter((l) => l.name !== name),
        }));
      },

      isSavedLocation: (name) => {
        return get().savedLocations.some((l) => l.name === name);
      },

      // Search actions
      setSearchQuery: (query) => set({ searchQuery: query }),

      setSearchResults: (results) => set({ searchResults: results }),

      setIsSearching: (searching) => set({ isSearching: searching }),

      clearSearch: () => set({ searchQuery: "", searchResults: [] }),

      // Weather data actions
      setCurrentWeather: (weather) => set({ currentWeather: weather }),

      setForecast: (forecast) => set({ forecast: forecast }),

      // Settings
      setUnits: (units) => {
        if (get().units === units) return;
        set({ units, lastModified: Date.now() });
      },

      toggleUnits: () => {
        const current = get().units;
        set({
          units: current === "fahrenheit" ? "celsius" : "fahrenheit",
          lastModified: Date.now(),
        });
      },

      // UI state
      setLoading: (loading) => set({ isLoading: loading }),

      setError: (error) => set({ error: error }),

      setCurrentFact: (fact) => set({ currentFact: fact }),

      // Sync helpers
      getProgress: (): WeatherProgress => {
        const state = get();
        return projectWords({
          savedLocations: state.savedLocations,
          units: state.units,
          lastLocation: state.lastLocation,
          lastModified: state.lastModified,
        } as WeatherProgress);
      },

      setProgress: (data) => {
        set({
          savedLocations: data.savedLocations ?? [],
          units: data.units ?? "fahrenheit",
          lastLocation: data.lastLocation ?? null,
          // Taking progress is not a player action: it keeps the time it gets.
          lastModified: typeof data.lastModified === "number" ? data.lastModified : 0,
        });
      },
    }),
    {
      storage: createOwnerPersistStorage("weather-app-progress", "weather"),
      skipHydration: true,
      name: STORAGE_KEY,
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      // Only persist user preferences, not weather data
      partialize: (state) => markSaved(projectWords({
        savedLocations: state.savedLocations,
        units: state.units,
        lastLocation: state.lastLocation,
        lastModified: state.lastModified,
      })),
    }
  )
);

bindPersistedStore("weather-app-progress", useWeatherStore.persist, () => useWeatherStore.setState({}));

bindWordConsumer("weather", useWeatherStore.subscribe, (_records, lease) => {
  const state = useWeatherStore.getState();
  const savedLocations = (lease ? readSavedLocations(lease) : undefined) ?? [];
  const lastLocation = (lease ? readLastLocation(lease) : undefined) ?? null;
  if (!sameProgress(savedLocations, state.savedLocations) || !sameProgress(lastLocation, state.lastLocation)) {
    useWeatherStore.setState({ savedLocations, lastLocation });
  }
});
