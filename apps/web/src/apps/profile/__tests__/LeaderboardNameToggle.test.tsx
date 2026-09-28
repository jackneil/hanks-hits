import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import {
  LEADERBOARD_NAME_LABEL,
  LeaderboardNameToggle,
  NO_GAMER_NAME_YET,
} from "../components/LeaderboardNameToggle";

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(handlers: {
  get: () => Promise<Response>;
  patch?: (body: unknown) => Promise<Response>;
}) {
  fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === "/api/gaming-profile" && (!init || !init.method || init.method === "GET")) {
      return handlers.get();
    }
    if (input === "/api/gaming-profile" && init?.method === "PATCH" && handlers.patch) {
      return handlers.patch(JSON.parse(String(init.body)));
    }
    return Promise.reject(new Error(`unexpected fetch ${input}`));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function patchCalls(): FetchCall[] {
  return (fetchMock.mock.calls as FetchCall[]).filter(([, init]) => init?.method === "PATCH");
}

async function findSwitch() {
  return screen.findByRole("switch", { name: LEADERBOARD_NAME_LABEL });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeSpeechMock();
});

describe("LeaderboardNameToggle", () => {
  it("says only 'Show my gamer name on leaderboards' and shows the gamer name", async () => {
    mockFetch({ get: () => jsonResponse({ handle: "TurboFox42", showOnLeaderboards: true }) });
    render(<LeaderboardNameToggle />);

    const toggle = await findSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    expect(screen.getByText("TurboFox42")).toBeInTheDocument();
    // The whole row is the tap target.
    expect(toggle.closest("label")).toHaveClass("min-h-[44px]");
  });

  it("writes show_on_leaderboards through PATCH /api/gaming-profile", async () => {
    mockFetch({
      get: () => jsonResponse({ handle: "TurboFox42", showOnLeaderboards: true }),
      patch: (body) =>
        jsonResponse({ success: true, ...(body as { showOnLeaderboards: boolean }) }),
    });
    render(<LeaderboardNameToggle />);
    const toggle = await findSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const [, init] = patchCalls()[0];
    expect(JSON.parse(String(init?.body))).toEqual({ showOnLeaderboards: false });
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(await screen.findByText(/leave you out now/)).toBeInTheDocument();
    expect(toggle).not.toBeChecked();

    // And back on.
    fireEvent.click(toggle);
    await waitFor(() => expect(patchCalls()).toHaveLength(2));
    expect(JSON.parse(String(patchCalls()[1][1]?.body))).toEqual({ showOnLeaderboards: true });
    expect(await screen.findByText(/Your gamer name shows on leaderboards/)).toBeInTheDocument();
    expect(toggle).toBeChecked();
  });

  it("puts the switch back and says so when the save fails", async () => {
    mockFetch({
      get: () => jsonResponse({ handle: "TurboFox42", showOnLeaderboards: true }),
      patch: () => jsonResponse({ error: "Failed to update gaming profile" }, 500),
    });
    render(<LeaderboardNameToggle />);
    const toggle = await findSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);

    expect(await screen.findByText("Oops! That did not save. Try again?")).toBeInTheDocument();
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it("shows a saved 'off' setting as off", async () => {
    mockFetch({ get: () => jsonResponse({ handle: "TurboFox42", showOnLeaderboards: false }) });
    render(<LeaderboardNameToggle />);

    const toggle = await findSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
  });

  it("explains, and stays locked, before the kid has a gamer name", async () => {
    mockFetch({ get: () => jsonResponse({ handle: null, showOnLeaderboards: true, createdAt: null }) });
    render(<LeaderboardNameToggle />);

    // True to the server: a gaming profile is made only when a game with a
    // leaderboard saves a score above 0, not on any first game.
    expect(await screen.findByText(NO_GAMER_NAME_YET)).toBeInTheDocument();
    expect(NO_GAMER_NAME_YET).toBe(
      "You get a gamer name when you score points in a game with a 🏆 leaderboard."
    );
    const toggle = await findSwitch();
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(patchCalls()).toHaveLength(0);
  });

  it("speaks why the switch is locked, for a kid who cannot read", async () => {
    const synth = installSpeechMock();
    mockFetch({ get: () => jsonResponse({ handle: null, showOnLeaderboards: true, createdAt: null }) });
    render(<LeaderboardNameToggle />);
    await screen.findByText(NO_GAMER_NAME_YET);

    fireEvent.click(screen.getByTestId("read-aloud-button"));

    const spoken = synth.lastUtterance().text;
    expect(spoken).toMatch(/^Show my gamer name on leaderboards\./);
    expect(spoken).toContain(
      "You get a gamer name when you score points in a game with a leaderboard."
    );
    // The trophy is a picture: the voice does not try to say it.
    expect(spoken).not.toMatch(/🏆/u);
  });

  it("speaks the gamer name and the save status", async () => {
    const synth = installSpeechMock();
    mockFetch({
      get: () => jsonResponse({ handle: "TurboFox42", showOnLeaderboards: true }),
      patch: () => jsonResponse({ error: "Failed to update gaming profile" }, 500),
    });
    render(<LeaderboardNameToggle />);
    const toggle = await findSwitch();
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);
    await screen.findByText("Oops! That did not save. Try again?");
    fireEvent.click(screen.getByTestId("read-aloud-button"));

    expect(synth.lastUtterance().text).toMatch(
      /Your gamer name: TurboFox42\. Oops! That did not save\. Try again\?$/
    );
  });

  it("stays locked and says so when the setting cannot load", async () => {
    mockFetch({ get: () => jsonResponse({ error: "Failed to fetch gaming profile" }, 500) });
    render(<LeaderboardNameToggle />);

    expect(
      await screen.findByText("We could not load this setting. Try again later.")
    ).toBeInTheDocument();
    expect(await findSwitch()).toBeDisabled();
  });
});
