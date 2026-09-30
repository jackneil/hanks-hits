import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { GAME_METADATA } from "../../lib/gameMetadata.generated";
import { useShellOverlays } from "../../lib/shellOverlays";
import { useStartOverlayPresence } from "../../lib/startOverlayPresence";
import {
  ORIENTATION_TIP_COPY,
  ORIENTATION_TIP_KEEP_PLAYING,
  OrientationWarning,
  orientationOf,
  orientationTipKey,
  preferredOrientationFor,
} from "../OrientationWarning";

const DEFAULT_WIDTH = window.innerWidth;
const DEFAULT_HEIGHT = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  mockPointer(true);
  useShellOverlays.setState({ count: 0 });
  useStartOverlayPresence.setState({ count: 0 });
  sessionStorage.clear();
});

afterEach(() => {
  act(() => setViewport(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  resetPointerMock();
  removeSpeechMock();
});

describe("OrientationWarning (the orientation tip)", () => {
  it("asks for sideways on a phone held upright, and counts as a shell overlay while it shows", () => {
    setViewport(375, 549);
    render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    expect(screen.getByRole("heading", { name: ORIENTATION_TIP_COPY.landscape.title })).toBeInTheDocument();
    expect(useShellOverlays.getState().count).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(ORIENTATION_TIP_KEEP_PLAYING) }));
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    expect(useShellOverlays.getState().count).toBe(0);
  });

  it("asks for upright on a phone held sideways", () => {
    setViewport(844, 340);
    render(<OrientationWarning preferred="portrait" gameId="flappy-bird" />);
    expect(screen.getByRole("heading", { name: ORIENTATION_TIP_COPY.portrait.title })).toBeInTheDocument();
    expect(screen.getByText(ORIENTATION_TIP_COPY.portrait.body)).toBeInTheDocument();
  });

  it("waits until the start card has left, then shows", () => {
    setViewport(375, 549);
    useStartOverlayPresence.getState().enter();
    render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    act(() => useStartOverlayPresence.getState().leave());
    expect(screen.getByTestId("orientation-tip")).toBeInTheDocument();
  });

  it("remembers that it showed, per game, for the session", () => {
    setViewport(375, 549);
    const first = render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    expect(sessionStorage.getItem(orientationTipKey("platformer"))).toBe("1");
    first.unmount();

    render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    expect(screen.queryByTestId("orientation-tip")).toBeNull();

    // Another game gets its own tip.
    render(<OrientationWarning preferred="landscape" gameId="endless-runner" />);
    expect(screen.getByTestId("orientation-tip")).toBeInTheDocument();
  });

  it("does not fire on a tablet held upright, or with a mouse", () => {
    setViewport(768, 1024);
    const tablet = render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    tablet.unmount();

    mockPointer(false);
    setViewport(375, 549);
    render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
  });

  it("goes away by itself when the phone is turned", () => {
    setViewport(375, 549);
    render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    expect(screen.getByTestId("orientation-tip")).toBeInTheDocument();
    act(() => setViewport(667, 311));
    expect(screen.queryByTestId("orientation-tip")).toBeNull();
    expect(useShellOverlays.getState().count).toBe(0);
  });

  it("reads the whole tip out loud, its button included", async () => {
    const synth = installSpeechMock();
    setViewport(375, 549);
    render(<OrientationWarning preferred="landscape" gameId="platformer" />);
    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toBe(
      "Turn your phone sideways. This game is bigger when your phone is sideways. Keep playing."
    );
  });

  it("stacks at z-100 (above the start card, below the header) and portals to document.body", () => {
    setViewport(375, 549);
    render(
      <div data-testid="game-root" className="fixed inset-0 bg-black">
        <OrientationWarning preferred="landscape" gameId="platformer" />
      </div>
    );
    const tip = screen.getByTestId("orientation-tip");
    expect(tip.className).toMatch(/z-\[100\]/);
    expect(tip.parentElement).toBe(document.body);
    expect(screen.getByTestId("game-root")).not.toContainElement(tip);
  });

  it("uses kid words with no em dash", () => {
    for (const copy of Object.values(ORIENTATION_TIP_COPY)) {
      expect(copy.title).not.toMatch(/—/);
      expect(copy.body).not.toMatch(/—/);
      expect(copy.body.split(" ").length).toBeLessThanOrEqual(12);
    }
  });
});

describe("orientationOf and preferredOrientationFor", () => {
  it("reads the orientation from the screen size, a square counts as upright", () => {
    expect(orientationOf(375, 549)).toBe("portrait");
    expect(orientationOf(667, 311)).toBe("landscape");
    expect(orientationOf(400, 400)).toBe("portrait");
  });

  it("reads the game's preference from the metadata by appId, then by the route id", () => {
    expect(preferredOrientationFor(GAME_METADATA, { appId: "platformer" })).toBe("landscape");
    expect(preferredOrientationFor(GAME_METADATA, { appId: "flappy-bird" })).toBe("portrait");
    expect(preferredOrientationFor(GAME_METADATA, { routeId: "endless-runner" })).toBe("landscape");
    expect(preferredOrientationFor(GAME_METADATA, { appId: "hill-climb" })).toBeNull();
    expect(preferredOrientationFor(GAME_METADATA, { appId: "no-such-game" })).toBeNull();
    expect(preferredOrientationFor(GAME_METADATA, { appId: "constructor" })).toBeNull();
    expect(preferredOrientationFor({ x: { preferredOrientation: "any" } }, { appId: "x" })).toBeNull();
  });
});
