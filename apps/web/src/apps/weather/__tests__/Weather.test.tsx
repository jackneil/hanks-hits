import type { AnchorHTMLAttributes, ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Weather } from "../Weather";
import { useWeatherStore, type GeoLocation } from "../lib/store";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({
    isAuthenticated: false,
    isGuest: true,
    syncStatus: "idle",
    lastSynced: null,
    forceSync: vi.fn(),
  }),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => null,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

const boston: GeoLocation = {
  name: "Boston",
  latitude: 42.3601,
  longitude: -71.0589,
  country: "United States",
  admin1: "Massachusetts",
};

describe("Weather", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useWeatherStore.setState({
      savedLocations: [],
      units: "fahrenheit",
      lastLocation: null,
      lastModified: Date.now(),
      currentWeather: null,
      forecast: null,
      searchResults: [],
      isLoading: false,
      isSearching: false,
      error: null,
      searchQuery: "",
      currentFact: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears stale search results when the query is emptied", () => {
    render(<Weather />);

    act(() => {
      useWeatherStore.setState({
        searchQuery: "bo",
        searchResults: [boston],
      });
    });

    expect(screen.getByText("Boston")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search for a city..."), {
      target: { value: "" },
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByText("Boston")).not.toBeInTheDocument();
  });
});
