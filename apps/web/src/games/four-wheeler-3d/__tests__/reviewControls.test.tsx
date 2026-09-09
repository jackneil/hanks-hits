import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { defaultProgress, useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { RidePanel } from "../components/ui/RidePanel";
import { StartScreen } from "../components/StartScreen";
import { Panel } from "../components/ui/AdventureHUD";
import { HuntingScope } from "../components/ui/HuntingPanel";
import { RaceStatus, RacePanel } from "../components/ui/RacePanel";
import { createRace } from "../lib/race";

beforeEach(() => {
  useAdventureSession.getState().reset();
  useFourWheeler3dStore.setState({
    progress: structuredClone(defaultProgress),
    mode: "vehicle",
    hasStarted: true,
    isPaused: false,
  });
});
afterEach(() => {
  cleanup();
  removeSpeechMock();
  vi.restoreAllMocks();
});
describe("discoverable controls", () => {
  it("opens race options away from the start line and requests abandoning the race", () => {
    useAdventureSession.setState({ race: createRace("atv", 22).session });
    render(
      <>
        <RaceStatus />
        <RacePanel />
      </>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Race options: resume, restart or end race",
      }),
    );
    expect(useAdventureSession.getState().panel).toBe("race");
    expect(
      screen.queryByRole("button", {
        name: "Race options: resume, restart or end race",
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "End race and free roam" }),
    );
    expect(useAdventureSession.getState().action?.name).toBe("race:abandon");
  });
  it("dispatches the ATV parachute from its rendered touch button", () => {
    render(<RidePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open ATV parachute" }));
    expect(useAdventureSession.getState().action?.name).toBe(
      "vehicle:parachute",
    );
  });
  it("reads concrete start instructions when tapped and never automatically", async () => {
    const synth = installSpeechMock();
    render(<StartScreen />);
    const button = await screen.findByTestId("read-aloud-button");
    expect(synth.speak).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(synth.lastUtterance().text).toContain("hold Gas");
    expect(synth.lastUtterance().text).toContain("arrow keys");
  });
  it("reads the current panel content, including changes since it opened", async () => {
    const synth = installSpeechMock();
    const view = render(
      <Panel title="Test shop" onClose={() => {}}>
        <p>Your balance is $20.</p>
      </Panel>,
    );
    await screen.findByTestId("read-aloud-button");
    view.rerender(
      <Panel title="Test shop" onClose={() => {}}>
        <p>Your balance is $30.</p>
      </Panel>,
    );
    fireEvent.click(screen.getByTestId("read-aloud-button"));
    expect(synth.lastUtterance().text).toContain("$30");
    expect(synth.lastUtterance().text).not.toContain("$20");
  });
  it("aims down with the keyboard before tagging from a stand", () => {
    act(() => {
      useFourWheeler3dStore.setState({ mode: "stand" });
      useAdventureSession.setState({ scope: true });
    });
    render(<HuntingScope />);
    fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
    fireEvent.keyDown(window, { code: "Enter", key: "Enter" });
    const action = useAdventureSession.getState().action!;
    expect(action.name).toBe("hunt:fire");
    expect(JSON.parse(action.payload!).y).toBeLessThan(0);
  });
  it("keeps held arrows owned by the scope even when Tag has focus, and releases them for map navigation", () => {
    act(() => {
      useFourWheeler3dStore.setState({ mode: "stand" });
      useAdventureSession.setState({ scope: true });
    });
    render(<HuntingScope />);
    const gameplay = vi.fn();
    window.addEventListener("keydown", gameplay);
    try {
      const tag = screen.getByRole("button", { name: /Tag/ });
      tag.focus();
      fireEvent.keyDown(tag, { code: "ArrowDown", key: "ArrowDown" });
      fireEvent.keyDown(tag, {
        code: "ArrowDown",
        key: "ArrowDown",
        repeat: true,
      });
      expect(gameplay).not.toHaveBeenCalled();
      fireEvent.click(tag);
      expect(
        JSON.parse(useAdventureSession.getState().action!.payload!).y,
      ).toBeLessThan(-0.1);
      act(() => useAdventureSession.getState().openPanel("map"));
      expect(useAdventureSession.getState().scope).toBe(false);
      fireEvent.keyDown(window, {
        code: "ArrowDown",
        key: "ArrowDown",
        repeat: true,
      });
      expect(gameplay).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", gameplay);
    }
  });
});
