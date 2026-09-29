import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { keyBelongsToTarget } from "@/shared/lib/keyboardTarget";

import { ClipServiceContext } from "../../service/context";
import { HOLD_FOR_MENU_MS, type ClipButtonState } from "../../service/contract";
import { ClipButton } from "../ClipButton";
import { BUTTON_NAMES, buttonTooltip, deferredMenuText, MENU_COPY, REASON_COPY, RESULT_COPY } from "../copy";
import { ToastSlot } from "../ToastSlot";
import { createFakeClipService } from "./fakeClipService";
import { flush, pointer, renderWithClips } from "./renderClips";

const TIMERS = {
  toFake: [
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "performance",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const,
};

function button() {
  return screen.getByTestId("clip-button");
}

function face() {
  return button().querySelector("svg") as SVGSVGElement;
}

function menu() {
  return screen.queryByRole("dialog", { name: MENU_COPY.title });
}

/** Press the button like a finger, hold for `ms`, and let go. */
async function pressFor(ms: number, target: HTMLElement = button()) {
  fireEvent.pointerDown(target, pointer());
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  fireEvent.pointerUp(target, pointer());
  await flush();
}

let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...TIMERS.toFake] });
  animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: animate });
});

afterEach(() => {
  vi.useRealTimers();
  removeSpeechMock();
  // @ts-expect-error - remove the stub again
  delete HTMLElement.prototype.animate;
});

describe("ClipButton rendering", () => {
  it("renders nothing without a service, without a provider, or when hidden", () => {
    const { container, unmount } = render(<ClipButton />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    const fake = createFakeClipService();
    const noProvider = render(
      <ClipServiceContext.Provider value={fake.service}>
        <ClipButton />
      </ClipServiceContext.Provider>,
    );
    expect(noProvider.container).toBeEmptyDOMElement();
    noProvider.unmount();

    renderWithClips(<ClipButton />, { snapshot: { button: "hidden" } });
    expect(screen.queryByTestId("clip-button")).toBeNull();
  });

  const LOOKS: Array<[Exclude<ClipButtonState, "hidden">, Record<string, string | undefined>, string]> = [
    ["warming", { glyph: "clip", ring: "progress", progress: "0.40", slashed: "false", dot: "false" }, "1"],
    ["ready", { glyph: "clip", ring: "static", slashed: "false", dot: "false" }, "1"],
    ["saving", { glyph: "clip", ring: "progress", progress: "0.70" }, "1"],
    ["made", { glyph: "check", ring: "full" }, "1"],
    ["recording", { glyph: "stop", ring: "none" }, "1"],
    ["resting", { glyph: "clip", ring: "none", slashed: "true" }, "0.6"],
    ["suspended", { glyph: "clip", ring: "none", slashed: "false" }, "1"],
    ["source-lost", { glyph: "clip", ring: "progress", progress: "0.00" }, "1"],
    ["recovering", { glyph: "clip", ring: "progress", progress: "0.40" }, "1"],
    ["exporting", { glyph: "clip", ring: "progress", progress: "0.70" }, "1"],
    ["record-only", { glyph: "clip", ring: "static", dot: "true" }, "1"],
    ["disabled", { glyph: "clip", ring: "none", slashed: "true" }, "0.4"],
    ["error", { glyph: "alert", ring: "amber" }, "1"],
  ];

  it.each(LOOKS)("draws the %s state with its accessible name and glyph", (state, attrs, opacity) => {
    // Mounting straight into a state shows its own look (nothing to keep "unchanged").
    renderWithClips(<ClipButton />, { snapshot: { button: state, warmProgress: 0.4, savingProgress: 0.7 } });
    expect(button()).toHaveAccessibleName(BUTTON_NAMES[state]);
    expect(button().getAttribute("data-state")).toBe(state);
    for (const [name, value] of Object.entries(attrs)) {
      expect(face().getAttribute(`data-${name}`), `${state} ${name}`).toBe(value);
    }
    expect(face().style.opacity).toBe(opacity);
    // A drawn glyph, never an emoji character.
    expect(button().textContent).toBe("");
    expect(face().querySelectorAll("path, circle, rect").length).toBeGreaterThan(0);
  });

  it("is a 44 px control, white on the dark header, with no tap delay or callout", () => {
    renderWithClips(<ClipButton />);
    const classes = button().className;
    expect(classes).toMatch(/(^|\s)h-11(\s|$)/);
    expect(classes).toMatch(/(^|\s)w-11(\s|$)/);
    expect(classes).toContain("text-white");
    expect(classes).toContain("touch-none");
    expect(classes).toContain("[-webkit-touch-callout:none]");
    expect(face().getAttribute("width")).toBe("44");
  });

  it("fills the warming ring from the snapshot, with a transition only without reduced motion", () => {
    const { fake } = renderWithClips(<ClipButton />, { snapshot: { button: "warming", warmProgress: 0.25 } });
    const progress = () => face().querySelector('[data-part="progress"]') as SVGCircleElement;
    expect(face().getAttribute("data-progress")).toBe("0.25");
    expect(progress().style.transition).toContain("stroke-dashoffset");
    act(() => fake.set({ warmProgress: 0.75 }));
    expect(face().getAttribute("data-progress")).toBe("0.75");
    const length = Number(progress().getAttribute("stroke-dasharray"));
    expect(Number(progress().getAttribute("stroke-dashoffset"))).toBeCloseTo(length * 0.25, 3);
  });

  it("keeps the old look for 1.5 s after the source is lost, then empties the ring", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    expect(face().getAttribute("data-ring")).toBe("static");
    act(() => fake.set({ button: "source-lost" }));
    expect(button()).toHaveAccessibleName(BUTTON_NAMES["source-lost"]);
    expect(face().getAttribute("data-ring")).toBe("static");
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(face().getAttribute("data-ring")).toBe("static");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(face().getAttribute("data-ring")).toBe("progress");
    expect(face().getAttribute("data-progress")).toBe("0.00");
  });

  it("keeps the look for 3 s when recovering, then looks like warming", async () => {
    const { fake } = renderWithClips(<ClipButton />, { snapshot: { warmProgress: 0.2 } });
    act(() => fake.set({ button: "recovering" }));
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(face().getAttribute("data-ring")).toBe("static");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(face().getAttribute("data-ring")).toBe("progress");
    expect(face().getAttribute("data-progress")).toBe("0.20");
  });

  it("shows the check mark at most 1.2 s and the amber ! at most 3 s", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    act(() => fake.set({ button: "made" }));
    expect(face().getAttribute("data-glyph")).toBe("check");
    await act(async () => {
      vi.advanceTimersByTime(1199);
    });
    expect(face().getAttribute("data-glyph")).toBe("check");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(face().getAttribute("data-glyph")).toBe("clip");
    expect(face().getAttribute("data-ring")).toBe("static");

    act(() => fake.set({ button: "error", reason: "mux-failed" }));
    expect(face().getAttribute("data-glyph")).toBe("alert");
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(face().getAttribute("data-ring")).toBe("amber");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(face().getAttribute("data-glyph")).toBe("clip");
    // The name still says what a tap does in this state.
    expect(button()).toHaveAccessibleName(BUTTON_NAMES.error);
  });

  it("does not keep a stale look: back to ready inside the hold shows ready", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    act(() => fake.set({ button: "source-lost" }));
    act(() => fake.set({ button: "ready" }));
    expect(face().getAttribute("data-ring")).toBe("static");
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(face().getAttribute("data-ring")).toBe("static");
  });
});

describe("ClipButton taps (plan 11.1)", () => {
  it("commits a 300 ms press and announces the result", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    await pressFor(300);
    expect(fake.service.endPress).toHaveBeenCalledTimes(1);
    expect(fake.records).toHaveLength(1);
    expect(screen.getByTestId("clip-button-announcer")).toHaveTextContent(RESULT_COPY.clip);
    expect(menu()).toBeNull();
  });

  it("opens the Capture menu on a 600 ms hold and calls no clip action", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    fireEvent.pointerDown(button(), pointer());
    await act(async () => {
      vi.advanceTimersByTime(HOLD_FOR_MENU_MS);
    });
    // The menu opens while the finger is still down.
    expect(menu()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerUp(button(), pointer());
    await flush();

    expect(menu()).not.toBeNull();
    expect(fake.records).toHaveLength(0);
    expect(fake.service.clipLast).not.toHaveBeenCalled();
    expect(fake.service.takePicture).not.toHaveBeenCalled();
    expect(fake.service.startRecording).not.toHaveBeenCalled();
    expect(fake.service.endPress).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fake.service.endPress).mock.results[0].value).toEqual({ kind: "menu" });
  });

  it("acts once per tap: the compatibility click after a pointer press is ignored", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    await pressFor(80);
    fireEvent.click(button());
    await flush();
    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
    expect(fake.records).toHaveLength(1);
  });

  it("clips with a finger that is not the page's first (the other thumb holds the gas pedal)", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    // Another finger is down somewhere else on the page, so this touch is not primary.
    fireEvent.pointerDown(button(), pointer({ pointerId: 5, isPrimary: false }));
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    fireEvent.pointerUp(button(), pointer({ pointerId: 5, isPrimary: false }));
    await flush();
    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
    expect(fake.records).toHaveLength(1);
  });

  it("keeps its touches, pointers and clicks from the game's window listeners (Hill Climb's gas zone)", async () => {
    const seen: string[] = [];
    const types = ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "mouseup", "click"];
    const listener = (event: Event) => seen.push(event.type);
    for (const type of types) window.addEventListener(type, listener);
    try {
      renderWithClips(<ClipButton />);
      fireEvent.touchStart(button());
      fireEvent.pointerDown(button(), pointer());
      fireEvent.mouseDown(button());
      fireEvent.touchEnd(button());
      fireEvent.pointerUp(button(), pointer());
      fireEvent.mouseUp(button());
      fireEvent.click(button());
      await flush();
      expect(seen).toEqual([]);
    } finally {
      for (const type of types) window.removeEventListener(type, listener);
    }
  });

  it("ignores a second finger while the first is down", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    fireEvent.pointerDown(button(), pointer({ pointerId: 1 }));
    fireEvent.pointerDown(button(), pointer({ pointerId: 2, isPrimary: false }));
    fireEvent.pointerUp(button(), pointer({ pointerId: 2, isPrimary: false }));
    fireEvent.pointerUp(button(), pointer({ pointerId: 1 }));
    await flush();
    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
    expect(fake.records).toHaveLength(1);
  });

  it("clips on Enter or Space (a click with no pointer), once per key press", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    fireEvent.click(button()); // Enter or Space on the focused button
    await flush();
    expect(fake.records).toHaveLength(1);

    // A held Enter repeats: the repeat keydown is stopped, so it never clicks.
    const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    button().dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    const first = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    button().dispatchEvent(first);
    expect(first.defaultPrevented).toBe(false);
  });

  it("never keeps keyboard focus after a mouse click, so Space still reaches the game", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    const gameKeys: string[] = [];
    const game = (event: KeyboardEvent) => {
      // The games' own guard (keyBelongsToTarget) hands Space to a focused button.
      if (keyBelongsToTarget(event)) return;
      gameKeys.push(event.key);
    };
    window.addEventListener("keydown", game);
    try {
      // A browser focuses a button on mousedown unless the default is prevented.
      const mouse = pointer({ pointerType: "mouse" });
      fireEvent.pointerDown(button(), mouse);
      const focusAllowed = fireEvent.mouseDown(button());
      if (focusAllowed) button().focus();
      fireEvent.pointerUp(button(), mouse);
      fireEvent.mouseUp(button());
      fireEvent.click(button());
      await flush();
      expect(focusAllowed).toBe(false);
      expect(document.activeElement).not.toBe(button());
      expect(fake.records).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1500); // past the compatibility-click window
      });
      const target = document.activeElement ?? document.body;
      fireEvent.keyDown(target, { key: " ", code: "Space" });
      fireEvent.keyUp(target, { key: " ", code: "Space" });
      await flush();
      expect(gameKeys).toEqual([" "]);
      expect(fake.records).toHaveLength(1);
    } finally {
      window.removeEventListener("keydown", game);
    }
  });

  it("drops focus that a touch gave it, and keeps focus the kid gave it with the keyboard", async () => {
    renderWithClips(<ClipButton />);
    // Some browsers focus a button on touch.
    fireEvent.pointerDown(button(), pointer());
    button().focus();
    fireEvent.pointerUp(button(), pointer());
    expect(document.activeElement).not.toBe(button());
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    // Tab put focus on the button first: a tap leaves it there.
    button().focus();
    fireEvent.pointerDown(button(), pointer({ pointerId: 2 }));
    fireEvent.pointerUp(button(), pointer({ pointerId: 2 }));
    expect(document.activeElement).toBe(button());
  });

  it("gives focus back to the game, not to itself, when a menu opened by a hold closes", async () => {
    renderWithClips(
      <>
        <ClipButton />
        <canvas tabIndex={0} data-testid="game" />
      </>,
    );
    const game = screen.getByTestId("game");
    game.focus();
    const mouse = pointer({ pointerType: "mouse" });
    fireEvent.pointerDown(button(), mouse);
    if (fireEvent.mouseDown(button())) button().focus();
    await act(async () => {
      vi.advanceTimersByTime(HOLD_FOR_MENU_MS);
    });
    expect(menu()).not.toBeNull();
    fireEvent.pointerUp(button(), mouse);
    fireEvent.click(within(menu()!).getByRole("button", { name: MENU_COPY.close }));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(game);
  });

  it("opens the menu on a Mac Control-click, with no clip", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    fireEvent.pointerDown(button(), pointer({ pointerType: "mouse", button: 0 }));
    // Control is down: the Mac fires the context menu on the press itself.
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ctrlKey: true });
    act(() => {
      button().dispatchEvent(event);
    });
    fireEvent.pointerUp(button(), pointer({ pointerType: "mouse" }));
    fireEvent.click(button());
    await flush();
    expect(menu()).not.toBeNull();
    expect(fake.records).toHaveLength(0);
    expect(fake.openPressCount()).toBe(0);
    expect(fake.service.clipLast).not.toHaveBeenCalled();
  });

  it("says Option+C on a Mac and Alt+C elsewhere", () => {
    const realUa = navigator.userAgent;
    const setUa = (ua: string) => Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => ua });
    try {
      setUa("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15");
      const mac = renderWithClips(<ClipButton />);
      expect(button().getAttribute("title")).toBe(buttonTooltip(true));
      mac.unmount();
      setUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36");
      renderWithClips(<ClipButton />);
      expect(button().getAttribute("title")).toBe(buttonTooltip(false));
    } finally {
      setUa(realUa);
    }
  });

  it("in a run that cannot pause, a hold clips the moment of the press and covers nothing", async () => {
    const { fake, pauseGame } = renderWithClips(<ClipButton />, { snapshot: { gameCanPause: false, atBreak: false } });
    await pressFor(700);
    const token = vi.mocked(fake.service.beginPress).mock.results[0].value;
    expect(fake.service.clipLast).toHaveBeenCalledWith(30, token);
    expect(fake.records).toHaveLength(1);
    expect(menu()).toBeNull();
    expect(pauseGame).not.toHaveBeenCalled();
    expect(screen.getByTestId("clip-button-announcer")).toHaveTextContent(RESULT_COPY.clip);
  });

  it("in a run that cannot pause, keeps a right-click menu for the end of the run", async () => {
    const { fake } = renderWithClips(
      <>
        <ClipButton />
        <ToastSlot />
      </>,
      { snapshot: { gameCanPause: false, atBreak: false } },
    );
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      button().dispatchEvent(event);
    });
    expect(menu()).toBeNull();
    expect(screen.getByTestId("clip-reply")).toHaveTextContent(deferredMenuText(null));
    act(() => fake.set({ atBreak: true })); // the run ends
    await flush();
    expect(menu()).not.toBeNull();
    expect(fake.records).toHaveLength(0);
  });

  it("does not act on a mouse right button press, and opens the menu on the context menu", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    fireEvent.pointerDown(button(), pointer({ pointerType: "mouse", button: 2 }));
    fireEvent.pointerUp(button(), pointer({ pointerType: "mouse", button: 2 }));
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      button().dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    expect(fake.records).toHaveLength(0);
    expect(fake.openPressCount()).toBe(0);
  });

  it("stops the video on a tap while recording", async () => {
    const { fake } = renderWithClips(<ClipButton />, {
      snapshot: { button: "recording", engine: "recording", recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 4, stars: 0 } },
    });
    expect(button()).toHaveAccessibleName(BUTTON_NAMES.recording);
    await pressFor(120);
    expect(fake.service.stopRecording).toHaveBeenCalledTimes(1);
    expect(fake.service.beginPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("clip-button-announcer")).toHaveTextContent(RESULT_COPY.record);
  });

  it("pulses once and replies with read-aloud on a warming tap", async () => {
    installSpeechMock();
    const { fake } = renderWithClips(
      <>
        <ClipButton />
        <ToastSlot />
      </>,
      { snapshot: { button: "warming", warmProgress: 0.3 } },
    );
    await pressFor(100);
    expect(animate).toHaveBeenCalledTimes(1);
    const reply = screen.getByTestId("clip-reply");
    expect(reply).toHaveTextContent(`${REASON_COPY.warming.say} ${REASON_COPY.warming.next}`);
    expect(reply.getAttribute("data-tappable")).toBe("true");
    expect(reply.querySelector('[data-testid="read-aloud-button"]')).not.toBeNull();
    expect(fake.records).toHaveLength(0);
  });

  it("does not pulse with reduced motion", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      renderWithClips(<ClipButton />, { snapshot: { button: "warming", warmProgress: 0.3 } });
      const progress = face().querySelector('[data-part="progress"]') as SVGCircleElement;
      expect(progress.style.transition).toBe("");
      await pressFor(100);
      expect(animate).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    }
  });

  it("opens the Capture menu with the resting row first on a resting tap", async () => {
    renderWithClips(<ClipButton />, { snapshot: { button: "resting" } });
    await pressFor(100);
    const dialog = menu();
    expect(dialog).not.toBeNull();
    const rows = dialog!.querySelectorAll("[data-row]");
    expect(rows[0].getAttribute("data-row")).toBe("wake");
  });

  it("releases a press that is still down when it unmounts", () => {
    const { fake, unmount } = renderWithClips(<ClipButton />);
    fireEvent.pointerDown(button(), pointer());
    expect(fake.openPressCount()).toBe(1);
    unmount();
    expect(fake.openPressCount()).toBe(0);
    expect(fake.listenerCount()).toBe(0);
  });
});

describe("ClipButton keyboard shortcuts (plan 11.2)", () => {
  function key(init: KeyboardEventInit, target: EventTarget = window) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("keeps a matched shortcut, and its repeats, from the game's own key listeners", async () => {
    const { fake } = renderWithClips(
      <>
        <ClipButton />
        <input aria-label="answer" />
      </>,
    );
    const gameSaw: string[] = [];
    const game = (event: KeyboardEvent) => gameSaw.push(`${event.altKey ? "Alt+" : ""}${event.code}${event.repeat ? " repeat" : ""}`);
    window.addEventListener("keydown", game);
    document.addEventListener("keydown", game, true);
    try {
      // Keys go to the page (the body), the way a game hears them.
      const page = document.body;
      key({ key: "ç", code: "KeyC", altKey: true }, page); // not a camera switch
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });
      key({ key: "F8", code: "F8" }, page);
      await flush();
      expect(fake.records).toHaveLength(2);
      key({ key: "®", code: "KeyR", altKey: true }, page); // not a truck reset
      key({ key: "®", code: "KeyR", altKey: true, repeat: true }, page);
      await flush();
      expect(gameSaw).toEqual([]);
      expect(fake.service.startRecording).toHaveBeenCalledTimes(1);
      expect(fake.service.stopRecording).not.toHaveBeenCalled(); // the repeat did not stop it
      // A key the shortcut leaves alone still reaches the game.
      key({ key: "c", code: "KeyC" }, page);
      // A shortcut typed into a text field belongs to the field.
      key({ key: "ç", code: "KeyC", altKey: true }, screen.getByLabelText("answer"));
      expect(gameSaw).toEqual(["KeyC", "KeyC", "Alt+KeyC", "Alt+KeyC"]);
    } finally {
      window.removeEventListener("keydown", game);
      document.removeEventListener("keydown", game, true);
    }
  });

  it("clips on Alt+C (Option+C gives ç) and on F8", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    const alt = key({ key: "ç", code: "KeyC", altKey: true });
    expect(alt.defaultPrevented).toBe(true);
    await flush();
    expect(fake.records).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(6000); // past the extend window
    });
    key({ key: "F8", code: "F8" });
    await flush();
    expect(fake.records).toHaveLength(2);
    expect(vi.mocked(fake.service.endPress).mock.results.map((result) => result.value.kind)).toEqual(["clip", "clip"]);
  });

  it("starts and stops a video on Alt+R", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    key({ key: "®", code: "KeyR", altKey: true });
    await flush();
    expect(fake.service.startRecording).toHaveBeenCalledTimes(1);
    expect(fake.snapshot().recording).not.toBeNull();
    key({ key: "®", code: "KeyR", altKey: true });
    await flush();
    expect(fake.service.stopRecording).toHaveBeenCalledTimes(1);
  });

  it("ignores AltGr (Ctrl+Alt), Meta, a bare C, a repeat, and keys typed into a text field", async () => {
    const { fake } = renderWithClips(
      <>
        <ClipButton />
        <input aria-label="answer" />
      </>,
    );
    key({ key: "c", code: "KeyC", altKey: true, ctrlKey: true });
    key({ key: "c", code: "KeyC", altKey: true, metaKey: true });
    key({ key: "c", code: "KeyC" });
    key({ key: "ç", code: "KeyC", altKey: true, repeat: true });
    key({ key: "ç", code: "KeyC", altKey: true }, screen.getByLabelText("answer"));
    await flush();
    expect(fake.service.beginPress).not.toHaveBeenCalled();
    expect(fake.records).toHaveLength(0);
  });

  it("ignores shortcuts while a clip sheet is open and when no game is attached", async () => {
    const { fake } = renderWithClips(<ClipButton />, { snapshot: { button: "resting" } });
    await pressFor(50); // resting tap opens the menu
    expect(menu()).not.toBeNull();
    key({ key: "ç", code: "KeyC", altKey: true });
    await flush();
    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);

    act(() => fake.set({ appId: null }));
    fireEvent.keyDown(window, { key: "Escape" });
    key({ key: "F8", code: "F8" });
    await flush();
    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
  });

  it("hears the shortcut inside a same-origin iframe game", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    // The iframe's load event makes the listener attach to its window.
    act(() => {
      frame.dispatchEvent(new Event("load"));
    });
    // The iframe's own realm: its KeyboardEvent and elements are not this window's.
    const inner = frame.contentWindow as Window & typeof globalThis;
    const event = new inner.KeyboardEvent("keydown", { key: "ç", code: "KeyC", altKey: true, bubbles: true, cancelable: true });
    act(() => {
      inner.document.body.dispatchEvent(event);
    });
    await flush();
    expect(fake.records).toHaveLength(1);

    // A text field inside the iframe still owns its keys.
    const input = inner.document.createElement("input");
    inner.document.body.appendChild(input);
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    act(() => {
      input.dispatchEvent(new inner.KeyboardEvent("keydown", { key: "ç", code: "KeyC", altKey: true, bubbles: true }));
    });
    await flush();
    expect(fake.records).toHaveLength(1);
    frame.remove();
  });

  it("stops listening when it unmounts", async () => {
    const { fake, unmount } = renderWithClips(<ClipButton />);
    unmount();
    key({ key: "F8", code: "F8" });
    await flush();
    expect(fake.service.beginPress).not.toHaveBeenCalled();
  });
});

describe("ClipButton game controller (plan 11.2)", () => {
  interface FakePad {
    id: string;
    index: number;
    connected: boolean;
    mapping: string;
    buttons: Array<{ pressed: boolean }>;
  }
  let pads: Array<FakePad | null>;
  let getGamepads: ReturnType<typeof vi.fn>;

  function makePad(id: string, buttonCount: number, index = 0): FakePad {
    return {
      id,
      index,
      connected: true,
      mapping: "standard",
      buttons: Array.from({ length: buttonCount }, () => ({ pressed: false })),
    };
  }

  beforeEach(() => {
    pads = [];
    getGamepads = vi.fn(() => pads);
    Object.defineProperty(navigator, "getGamepads", { configurable: true, writable: true, value: getGamepads });
  });

  afterEach(() => {
    // @ts-expect-error - remove the stub again
    delete navigator.getGamepads;
  });

  async function frames(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  function connect(pad: FakePad) {
    pads[pad.index] = pad;
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });
  }

  const XBOX = "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)";
  const GENERIC = "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)";

  it("does not poll when no controller is connected", async () => {
    renderWithClips(<ClipButton />);
    // One look at mount finds no controller, then nothing runs per frame.
    expect(getGamepads).toHaveBeenCalledTimes(1);
    await frames(200);
    expect(getGamepads).toHaveBeenCalledTimes(1);
  });

  it("clips on a short press of the Share button", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    const pad = makePad(XBOX, 18);
    connect(pad);
    pad.buttons[17].pressed = true;
    await frames(200);
    pad.buttons[17].pressed = false;
    await frames(20);
    await flush();
    expect(fake.records).toHaveLength(1);
    expect(menu()).toBeNull();
  });

  it("clips once on a long hold of the Share button, and never opens a menu it cannot close", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    const pad = makePad(XBOX, 18);
    connect(pad);
    pad.buttons[17].pressed = true;
    await frames(650);
    expect(menu()).toBeNull();
    expect(fake.records).toHaveLength(0);
    pad.buttons[17].pressed = false;
    await frames(20);
    await flush();
    expect(menu()).toBeNull();
    expect(fake.records).toHaveLength(1);
    expect(vi.mocked(fake.service.endPress).mock.results[0].value.kind).toBe("clip");
  });

  it("does nothing from a controller while a clip sheet is open", async () => {
    const { fake } = renderWithClips(<ClipButton />, { snapshot: { button: "resting" } });
    await pressFor(50); // a resting tap opens the menu
    expect(menu()).not.toBeNull();
    const pressesBefore = vi.mocked(fake.service.beginPress).mock.calls.length;
    act(() => fake.set({ button: "ready" }));
    const pad = makePad(XBOX, 18);
    connect(pad);
    pad.buttons[17].pressed = true;
    await frames(100);
    pad.buttons[17].pressed = false;
    await frames(20);
    await flush();
    expect(vi.mocked(fake.service.beginPress).mock.calls.length).toBe(pressesBefore);
    expect(fake.records).toHaveLength(0);
  });

  it("clips after a 1 s hold of Back on other controllers, and leaves a short Back press to the game", async () => {
    const { fake } = renderWithClips(<ClipButton />);
    const pad = makePad(GENERIC, 17);
    connect(pad);
    pad.buttons[8].pressed = true;
    await frames(400);
    pad.buttons[8].pressed = false;
    await frames(20);
    await flush();
    expect(fake.records).toHaveLength(0);
    expect(menu()).toBeNull();
    expect(fake.openPressCount()).toBe(0);

    pad.buttons[8].pressed = true;
    await frames(1050);
    await flush();
    expect(fake.records).toHaveLength(1);
    expect(fake.service.clipLast).toHaveBeenCalledTimes(1);
    pad.buttons[8].pressed = false;
    await frames(20);
    await flush();
    expect(fake.records).toHaveLength(1);
  });

  it("polls every frame while a controller is connected, and stops when the last one goes away", async () => {
    renderWithClips(<ClipButton />);
    const pad = makePad(GENERIC, 17);
    connect(pad);
    const before = getGamepads.mock.calls.length;
    await frames(160);
    expect(getGamepads.mock.calls.length - before).toBeGreaterThanOrEqual(8);
    pads = [];
    await frames(50);
    const afterGone = getGamepads.mock.calls.length;
    await frames(300);
    expect(getGamepads.mock.calls.length).toBe(afterGone);
  });

  it("never clips from a controller in Retro Arcade", async () => {
    const { fake } = renderWithClips(<ClipButton />, { snapshot: { appId: "retro-arcade" } });
    const pad = makePad(XBOX, 18);
    connect(pad);
    pad.buttons[17].pressed = true;
    await frames(200);
    pad.buttons[17].pressed = false;
    await frames(50);
    await flush();
    expect(fake.service.beginPress).not.toHaveBeenCalled();
  });
});

describe("ClipButton announcements", () => {
  it("announces only results made after it appeared", async () => {
    const fake = createFakeClipService();
    await fake.service.clipLast();
    renderWithClips(<ClipButton />, { fake });
    expect(screen.getByTestId("clip-button-announcer")).toHaveTextContent("");
    await act(async () => {
      await fake.service.takePicture();
    });
    expect(screen.getByTestId("clip-button-announcer")).toHaveTextContent(RESULT_COPY.picture);
  });
});
