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

  // Issue #56: searchLocations listed the whole store in its deps, so it
  // was a new function after every set(). The debounce effect depends on
  // it, so each set the search made (isSearching, then the results) armed
  // the debounce again, and the app asked for the same city every ~300 ms
  // for as long as the query stayed in the box.
  it("asks the geocoding service once per query, not again on every store change", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        results: [{ name: "Boston", latitude: 42.36, longitude: -71.06, country: "United States", admin1: "Massachusetts" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<Weather />);

      fireEvent.change(screen.getByPlaceholderText("Search for a city..."), {
        target: { value: "bos" },
      });

      for (let i = 0; i < 20; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250);
        });
      }

      expect(screen.getByText("Boston")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defers home + title to the app shell (no in-app title or home link)", () => {
    render(<Weather />);

    // The shared GameShell owns the home button and centered app name now.
    expect(
      screen.queryByRole("heading", { name: /weather buddy/i })
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/"]')).toBeNull();

    // Functional controls survived the header removal.
    expect(
      screen.getByRole("button", { name: /view saved locations/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /toggle temperature units/i })
    ).toBeInTheDocument();
  });
});
