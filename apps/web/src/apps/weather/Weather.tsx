"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWeatherStore } from "./lib/store";
import type { GeoLocation, CurrentWeather, ForecastDay } from "./lib/store";
import {
  WEATHER_API,
  WEATHER_ICONS,
  DEFAULT_LOCATIONS,
  mapWeatherCode,
  getKidFriendlyDescription,
  getOutfitRecommendations,
  getRandomFact,
} from "./lib/constants";
import { useAuthSync } from "@/shared/hooks/useAuthSync";
import { IOSInstallPrompt } from "@/shared/components/IOSInstallPrompt";
import { FullscreenButton } from "@/shared/components/FullscreenButton";

/**
 * Weather App - Kid-friendly weather checker
 *
 * Features:
 * - Search for cities
 * - Big animated weather display
 * - Outfit recommendations
 * - 5-day forecast
 * - Fun weather facts
 * - Save favorite locations
 */
export function Weather() {
  const store = useWeatherStore();
  const [showSavedLocations, setShowSavedLocations] = useState(false);

  // Auth sync for logged-in users
  const { isAuthenticated, syncStatus } = useAuthSync({
    appId: "weather",
    localStorageKey: "weather-app-progress",
    getState: () => store.getProgress(),
    setState: (data) => store.setProgress(data),
    debounceMs: 2000,
  });

  // Get a random fact on mount
  useEffect(() => {
    if (!store.currentFact) {
      store.setCurrentFact(getRandomFact());
    }
  }, []);

  // Load last location on mount
  useEffect(() => {
    if (store.lastLocation && !store.currentWeather) {
      fetchWeather(store.lastLocation);
    }
  }, [store.lastLocation]);

  // Search for cities using Open-Meteo Geocoding API
  const searchLocations = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        store.setSearchResults([]);
        return;
      }

      store.setIsSearching(true);
      try {
        const response = await fetch(
          `${WEATHER_API.geocoding}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`
        );
        const data = await response.json();

        if (data.results) {
          const locations: GeoLocation[] = data.results.map(
            (r: {
              name: string;
              latitude: number;
              longitude: number;
              country?: string;
              admin1?: string;
            }) => ({
              name: r.name,
              latitude: r.latitude,
              longitude: r.longitude,
              country: r.country,
              admin1: r.admin1,
            })
          );
          store.setSearchResults(locations);
        } else {
          store.setSearchResults([]);
        }
      } catch (err) {
        console.error("Search failed:", err);
        store.setSearchResults([]);
      } finally {
        store.setIsSearching(false);
      }
    },
    [store]
  );

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchLocations(store.searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [store.searchQuery, searchLocations]);

  // Fetch weather for a location
  const fetchWeather = useCallback(
    async (location: GeoLocation) => {
      store.setLoading(true);
      store.setError(null);
      store.clearSearch();

      try {
        // Fetch current weather and forecast
        const params = new URLSearchParams({
          latitude: location.latitude.toString(),
          longitude: location.longitude.toString(),
          current:
            "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
          daily:
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
          temperature_unit: "fahrenheit",
          wind_speed_unit: "mph",
          timezone: "auto",
          forecast_days: "5",
        });

        const response = await fetch(`${WEATHER_API.forecast}?${params}`);
        const data = await response.json();

        if (data.error) {
          throw new Error(data.reason || "Failed to fetch weather");
        }

        // Parse current weather
        const weatherCode = data.current.weather_code;
        const condition = mapWeatherCode(weatherCode);
        const current: CurrentWeather = {
          temperature: Math.round(data.current.temperature_2m),
          feelsLike: Math.round(data.current.apparent_temperature),
          weatherCode: weatherCode,
          condition: condition,
          humidity: data.current.relative_humidity_2m,
          windSpeed: Math.round(data.current.wind_speed_10m),
          isDay: data.current.is_day === 1,
        };

        // Parse forecast
        const forecast: ForecastDay[] = data.daily.time.map(
          (date: string, i: number) => {
            const code = data.daily.weather_code[i];
            const dayDate = new Date(date);
            return {
              date: date,
              dayName: dayDate.toLocaleDateString("en-US", { weekday: "short" }),
              tempHigh: Math.round(data.daily.temperature_2m_max[i]),
              tempLow: Math.round(data.daily.temperature_2m_min[i]),
              weatherCode: code,
              condition: mapWeatherCode(code),
              precipChance: data.daily.precipitation_probability_max[i] || 0,
            };
          }
        );

        store.setCurrentWeather(current);
        store.setForecast(forecast);
        store.setLastLocation(location);
        store.setCurrentFact(getRandomFact());
      } catch (err) {
        console.error("Weather fetch failed:", err);
        store.setError("Oops! Couldn't get the weather. Try again!");
      } finally {
        store.setLoading(false);
      }
    },
    [store]
  );

  // Handle location selection
  const handleSelectLocation = (location: GeoLocation) => {
    fetchWeather(location);
  };

  // Toggle save location
  const handleToggleSave = () => {
    if (!store.lastLocation) return;
    if (store.isSavedLocation(store.lastLocation.name)) {
      store.removeSavedLocation(store.lastLocation.name);
    } else {
      store.addSavedLocation(store.lastLocation);
    }
  };

  // Refresh weather
  const handleRefresh = () => {
    if (store.lastLocation) {
      fetchWeather(store.lastLocation);
    }
  };

  // Temperature display based on units
  const displayTemp = (tempF: number) => {
    if (store.units === "celsius") {
      return Math.round((tempF - 32) * (5 / 9));
    }
    return tempF;
  };

  const unitLabel = store.units === "fahrenheit" ? "F" : "C";

  // Get background gradient based on weather
  const getBgGradient = () => {
    if (!store.currentWeather) {
      return "from-blue-400 via-blue-500 to-blue-600";
    }
    const icon = WEATHER_ICONS[store.currentWeather.condition];
    return icon.bgGradient;
  };

  const isSaved = store.lastLocation
    ? store.isSavedLocation(store.lastLocation.name)
    : false;

  return (
    <div
      className={`min-h-screen bg-gradient-to-b ${getBgGradient()} p-4 flex flex-col transition-all duration-700`}
    >
      {/* iOS install prompt */}
      <IOSInstallPrompt />

      {/* Fullscreen button */}
      <div className="fixed top-4 right-4 z-50">
        <FullscreenButton />
      </div>

      {/* Header */}
      <header className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-3xl hover:scale-110 transition-transform"
            aria-label="Back to home"
          >
            &#x1F3E0;
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
            Weather Buddy
          </h1>
        </div>
        <div className="flex gap-2">
          {/* Saved Locations Button */}
          <button
            onClick={() => setShowSavedLocations(true)}
            className="btn btn-circle btn-lg bg-white/20 hover:bg-white/30 border-none text-white text-2xl shadow-lg backdrop-blur-sm"
            aria-label="View saved locations"
          >
            &#x2B50;
          </button>
          {/* Settings Button (F/C Toggle) */}
          <button
            onClick={() => store.toggleUnits()}
            className="btn btn-circle btn-lg bg-white/20 hover:bg-white/30 border-none text-white font-bold text-lg shadow-lg backdrop-blur-sm"
            aria-label="Toggle temperature units"
          >
            {unitLabel}
          </button>
        </div>
      </header>

      {/* Search Bar */}
      <div className="relative mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={store.searchQuery}
              onChange={(e) => store.setSearchQuery(e.target.value)}
              placeholder="Search for a city..."
              className="input input-lg w-full bg-white/90 text-gray-800 placeholder-gray-500 rounded-full border-none shadow-lg text-lg font-medium"
            />
            {store.isSearching && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2">
                <span className="loading loading-spinner loading-md text-blue-500" />
              </span>
            )}
          </div>
          {store.lastLocation && (
            <button
              onClick={handleRefresh}
              disabled={store.isLoading}
              className="btn btn-circle btn-lg bg-white/90 text-blue-500 border-none shadow-lg hover:bg-white"
              aria-label="Refresh weather"
            >
              &#x1F504;
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {store.searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl overflow-hidden z-50">
            {store.searchResults.map((location, i) => (
              <button
                key={`${location.name}-${i}`}
                onClick={() => handleSelectLocation(location)}
                className="w-full px-4 py-3 text-left hover:bg-blue-50 flex items-center gap-3 border-b border-gray-100 last:border-none"
              >
                <span className="text-2xl">&#x1F4CD;</span>
                <div>
                  <div className="font-bold text-gray-800">{location.name}</div>
                  <div className="text-sm text-gray-500">
                    {[location.admin1, location.country]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick Location Buttons (when no weather loaded) */}
      {!store.currentWeather && !store.isLoading && (
        <div className="mb-6">
          <p className="text-white/80 text-center mb-3 font-medium">
            Or pick a city:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {DEFAULT_LOCATIONS.slice(0, 4).map((loc) => (
              <button
                key={loc.name}
                onClick={() =>
                  handleSelectLocation({
                    name: loc.name,
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                  })
                }
                className="btn btn-md bg-white/80 text-gray-800 border-none rounded-full font-bold hover:bg-white shadow-lg touch-manipulation"
              >
                {loc.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {store.isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-8xl animate-bounce mb-4">&#x2601;&#xFE0F;</div>
          <p className="text-2xl text-white font-bold">
            Checking the weather...
          </p>
        </div>
      )}

      {/* Error State */}
      {store.error && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-8xl mb-4">&#x1F61E;</div>
          <p className="text-xl text-white font-bold mb-4">{store.error}</p>
          <button
            onClick={handleRefresh}
            className="btn btn-lg bg-white text-blue-500 border-none rounded-full font-bold shadow-lg"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Weather Display */}
      {store.currentWeather && !store.isLoading && !store.error && (
        <div className="flex-1 flex flex-col">
          {/* Location Name + Save Button */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
              {store.lastLocation?.name}
              {store.lastLocation?.admin1 && `, ${store.lastLocation.admin1}`}
            </h2>
            <button
              onClick={handleToggleSave}
              className={`btn btn-circle btn-sm text-xl transition-all ${
                isSaved
                  ? "bg-yellow-400 text-white scale-110"
                  : "bg-white/30 text-white hover:bg-white/40"
              }`}
              aria-label={isSaved ? "Remove from saved" : "Save location"}
            >
              {isSaved ? "\u2B50" : "\u2606"}
            </button>
          </div>

          {/* Main Weather Card */}
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl p-6 md:p-8 max-w-lg w-full mx-auto mb-6">
            {/* Big Weather Icon */}
            <div className="text-center mb-4">
              <div
                className="text-9xl md:text-[10rem] animate-pulse"
                style={{ animationDuration: "3s" }}
              >
                {WEATHER_ICONS[store.currentWeather.condition].emoji}
              </div>
            </div>

            {/* Temperature */}
            <div className="text-center mb-4">
              <div className="text-6xl md:text-7xl font-bold text-gray-800">
                {displayTemp(store.currentWeather.temperature)}
                <span className="text-3xl">&deg;{unitLabel}</span>
              </div>
              <div className="text-lg text-gray-600">
                Feels like {displayTemp(store.currentWeather.feelsLike)}&deg;
                {unitLabel}
              </div>
            </div>

            {/* Weather Description */}
            <div className="text-center mb-6">
              <p className="text-xl md:text-2xl font-bold text-blue-600">
                {getKidFriendlyDescription(
                  store.currentWeather.condition,
                  store.currentWeather.temperature,
                  store.currentWeather.isDay
                )}
              </p>
            </div>

            {/* Quick Stats */}
            <div className="flex justify-center gap-6 text-gray-600">
              <div className="flex items-center gap-2">
                <span className="text-2xl">&#x1F4A7;</span>
                <span className="font-medium">
                  {store.currentWeather.humidity}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">&#x1F4A8;</span>
                <span className="font-medium">
                  {store.currentWeather.windSpeed} mph
                </span>
              </div>
            </div>
          </div>

          {/* Outfit Recommendations */}
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl p-4 md:p-6 max-w-lg w-full mx-auto mb-6">
            <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-2xl">&#x1F455;</span>
              What to Wear Today
            </h3>
            <ul className="space-y-2">
              {getOutfitRecommendations(
                store.currentWeather.temperature,
                store.currentWeather.condition
              )
                .slice(0, 4)
                .map((rec, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-gray-700 font-medium"
                  >
                    <span className="text-green-500">&#x2713;</span>
                    {rec}
                  </li>
                ))}
            </ul>
          </div>

          {/* 5-Day Forecast */}
          {store.forecast && (
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl p-4 md:p-6 max-w-lg w-full mx-auto mb-6">
              <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                <span className="text-2xl">&#x1F4C5;</span>
                5-Day Forecast
              </h3>
              <div className="flex justify-between">
                {store.forecast.map((day, i) => (
                  <div key={day.date} className="text-center flex-1">
                    <div className="font-bold text-gray-600 text-sm">
                      {i === 0 ? "Today" : day.dayName}
                    </div>
                    <div className="text-3xl my-2">
                      {WEATHER_ICONS[day.condition].emoji}
                    </div>
                    <div className="font-bold text-gray-800">
                      {displayTemp(day.tempHigh)}&deg;
                    </div>
                    <div className="text-gray-500 text-sm">
                      {displayTemp(day.tempLow)}&deg;
                    </div>
                    {day.precipChance > 20 && (
                      <div className="text-blue-500 text-xs mt-1">
                        &#x1F4A7; {day.precipChance}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fun Fact */}
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl p-4 md:p-6 max-w-lg w-full mx-auto mb-6">
            <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
              <span className="text-2xl">&#x1F4A1;</span>
              Fun Weather Fact
            </h3>
            <p className="text-gray-700 font-medium">{store.currentFact}</p>
            <button
              onClick={() => store.setCurrentFact(getRandomFact())}
              className="btn btn-md mt-3 bg-blue-500 text-white border-none rounded-full hover:bg-blue-600 touch-manipulation"
            >
              Tell me another!
            </button>
          </div>
        </div>
      )}

      {/* No Weather Yet - Welcome Message */}
      {!store.currentWeather && !store.isLoading && !store.error && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-9xl mb-4 animate-bounce">&#x26C5;</div>
          <h2 className="text-3xl font-bold text-white mb-2 text-center">
            Hey there, Weather Explorer!
          </h2>
          <p className="text-xl text-white/80 text-center max-w-md">
            Search for a city to see what the weather is like!
          </p>
        </div>
      )}

      {/* Saved Locations Modal */}
      {showSavedLocations && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-yellow-400 to-orange-400 p-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white">
                &#x2B50; Saved Locations
              </h2>
              <button
                onClick={() => setShowSavedLocations(false)}
                className="btn btn-circle btn-sm bg-white/20 text-white border-none hover:bg-white/30"
              >
                &#x2715;
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {store.savedLocations.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">&#x1F4CD;</div>
                  <p className="text-gray-600">
                    No saved locations yet! Tap the star to save places you
                    check often.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {store.savedLocations.map((loc) => (
                    <div
                      key={loc.name}
                      className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between"
                    >
                      <button
                        onClick={() => {
                          handleSelectLocation(loc);
                          setShowSavedLocations(false);
                        }}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        <span className="text-2xl">&#x1F4CD;</span>
                        <div>
                          <div className="font-bold text-gray-800">
                            {loc.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {[loc.admin1, loc.country]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => store.removeSavedLocation(loc.name)}
                        className="btn btn-circle btn-sm bg-red-100 text-red-500 border-none hover:bg-red-200"
                        aria-label="Remove from saved"
                      >
                        &#x2715;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Status */}
      {isAuthenticated && (
        <div className="fixed bottom-2 right-2 text-xs text-white/60">
          {syncStatus === "syncing"
            ? "Saving..."
            : syncStatus === "synced"
            ? "Saved"
            : ""}
        </div>
      )}
    </div>
  );
}

export default Weather;
