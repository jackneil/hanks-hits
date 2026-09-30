import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

import { useClipUi } from "../uiContext";
import { recordTimerName, TOAST_COPY, VIEWER_TITLES } from "../copy";
import { TOAST_SLOT_Z_INDEX, ToastSlot } from "../ToastSlot";
import { HOLD_TIP_AFTER_CLIPS, REPLY_MS, REPLY_READING_MS, UI_PREFS_KEY } from "../uiStore";
import { createFakeClipService, makeRecord } from "./fakeClipService";
import { flush, pointer, renderWithClips, stubObjectUrls } from "./renderClips";

const TIMERS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...TIMERS] });
  stubObjectUrls();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  removeSpeechMock();
});

function slot() {
  return screen.getByTestId("clip-toast-slot");
}

/** A probe that reaches the controller, for replies and the hold tip. */
function Controls() {
  const ui = useClipUi();
  return (
    <>
      <button type="button" data-testid="reply-tap" onClick={() => ui?.store.showReply("Play a little first!", true)}>
        a
      </button>
      <button type="button" data-testid="reply-info" onClick={() => ui?.store.showReply("Clip made!", false)}>
        b
      </button>
      <button type="button" data-testid="note-clip" onClick={() => ui?.store.noteManualClip()}>
        c
      </button>
    </>
  );
}

describe("ToastSlot placement and tap rules (plan 11.3, 11.4)", () => {
  it("portals to document.body at z-1050, directly under the header, and takes no taps itself", () => {
    renderWithClips(<ToastSlot />, { records: [makeRecord({ id: "c1" })], snapshot: { unwatchedClipId: "c1" } });
    expect(TOAST_SLOT_Z_INDEX).toBe(1050);
    expect(slot().parentElement).toBe(document.body);
    expect(slot().className).toContain("z-[1050]");
    expect(slot().className).toContain("fixed");
    // Under the header: --shell-header-h (48 px, and 44 px on a short
    // screen). Never keyed on the width (md:), an 844 px wide phone
    // sideways is not a tablet.
    expect(slot().className.split(/\s+/)).toContain("top-[var(--shell-header-h)]");
    expect(slot().className).not.toMatch(/md:top-14/);
    expect(slot().className).toContain("pointer-events-none");
  });

  it("renders nothing when there is nothing to show", () => {
    renderWithClips(<ToastSlot />);
    expect(screen.queryByTestId("clip-toast-slot")).toBeNull();
  });

  it("gives the new-clip chip its own 44 px target", () => {
    renderWithClips(<ToastSlot />, { records: [makeRecord({ id: "c1" })], snapshot: { unwatchedClipId: "c1" } });
    const chip = screen.getByRole("button", { name: TOAST_COPY.newClipName });
    expect(chip.className).toContain("pointer-events-auto");
    expect(chip.className).toMatch(/(^|\s)h-11(\s|$)/);
    expect(parseInt(chip.style.width, 10)).toBeGreaterThanOrEqual(44);
    expect(chip).toHaveTextContent(TOAST_COPY.newClip);
  });

  it("keeps a 44 px read-aloud button on a reply to the kid's own tap, and no taps on other toasts", () => {
    installSpeechMock();
    renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    fireEvent.click(screen.getByTestId("reply-tap"));
    let reply = screen.getByTestId("clip-reply");
    expect(reply.className).toContain("pointer-events-none");
    const readAloud = within(reply).getByTestId("read-aloud-button");
    expect(readAloud.className).toContain("min-h-[44px]");
    expect(readAloud.className).toContain("min-w-[44px]");
    expect(readAloud.closest(".pointer-events-auto")).not.toBeNull();

    fireEvent.click(screen.getByTestId("reply-info"));
    reply = screen.getByTestId("clip-reply");
    expect(reply.getAttribute("data-tappable")).toBe("false");
    expect(within(reply).queryByRole("button")).toBeNull();
    expect(reply.querySelector(".pointer-events-auto")).toBeNull();
  });

  it("keeps a reply up while the kid listens to it, then lets it go", () => {
    installSpeechMock();
    renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    fireEvent.click(screen.getByTestId("reply-tap"));
    act(() => {
      vi.advanceTimersByTime(REPLY_MS - 1000);
    });
    const readAloud = within(screen.getByTestId("clip-reply")).getByTestId("read-aloud-button");
    fireEvent.pointerDown(readAloud);
    fireEvent.click(readAloud);
    act(() => {
      vi.advanceTimersByTime(REPLY_MS);
    });
    expect(screen.getByTestId("clip-reply")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(REPLY_READING_MS);
    });
    expect(screen.queryByTestId("clip-reply")).toBeNull();
  });

  it("keeps taps on its controls from reaching the game", () => {
    const gameTap = vi.fn();
    renderWithClips(
      <div onPointerDown={gameTap} onClick={gameTap} onTouchStart={gameTap}>
        <ToastSlot />
      </div>,
      {
        records: [makeRecord({ id: "c1" })],
        snapshot: {
          unwatchedClipId: "c1",
          atBreak: true,
          engine: "recording",
          recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 0, stars: 0 },
        },
      },
    );
    fireEvent.pointerDown(screen.getByTestId("clip-star-button"));
    fireEvent.touchStart(screen.getByTestId("clip-star-button"));
    fireEvent.click(screen.getByTestId("clip-star-button"));
    fireEvent.pointerDown(screen.getByTestId("clip-new-chip"));
    fireEvent.click(screen.getByTestId("clip-new-chip"));
    expect(gameTap).not.toHaveBeenCalled();
  });
});

describe("in-play controls take a second finger (plan 11.3)", () => {
  // A phone sends no click for a second finger while another finger holds
  // the gas pedal: these events are all the control gets.
  function secondFingerTap(target: HTMLElement, pointerId = 7) {
    fireEvent.pointerDown(target, pointer({ pointerId, isPrimary: false }));
    fireEvent.pointerUp(target, pointer({ pointerId, isPrimary: false }));
  }

  const RECORDING = {
    button: "recording" as const,
    engine: "recording" as const,
    recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 5, stars: 0 },
  };

  it("adds a star on the pointer, with no click, and the click after it does not add a second", () => {
    const { fake } = renderWithClips(<ToastSlot />, { snapshot: RECORDING });
    const star = screen.getByTestId("clip-star-button");
    secondFingerTap(star);
    expect(fake.service.addStar).toHaveBeenCalledTimes(1);
    fireEvent.click(star); // the compatibility click of that tap
    expect(fake.service.addStar).toHaveBeenCalledTimes(1);
    // A pointer that slid onto the star from elsewhere is not a tap on it.
    fireEvent.pointerUp(star, pointer({ pointerId: 9 }));
    expect(fake.service.addStar).toHaveBeenCalledTimes(1);
    // A right-click is not a star.
    fireEvent.pointerDown(star, pointer({ pointerId: 3, pointerType: "mouse", button: 2 }));
    fireEvent.pointerUp(star, pointer({ pointerId: 3, pointerType: "mouse", button: 2 }));
    expect(fake.service.addStar).toHaveBeenCalledTimes(1);
  });

  it("adds a star once per Enter or Space (a click with no pointer)", () => {
    const { fake } = renderWithClips(<ToastSlot />, { snapshot: RECORDING });
    fireEvent.click(screen.getByTestId("clip-star-button"));
    expect(fake.service.addStar).toHaveBeenCalledTimes(1);
  });

  it("opens the newest clip from the chip on the pointer, with no click", async () => {
    const { fake } = renderWithClips(<ToastSlot />, {
      records: [makeRecord({ id: "c1" })],
      snapshot: { unwatchedClipId: "c1", gameCanPause: true, atBreak: false },
    });
    secondFingerTap(screen.getByTestId("clip-new-chip"));
    await flush();
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.clip })).toBeInTheDocument();
    expect(fake.service.markWatched).toHaveBeenCalledWith("c1");
  });

  it("reads a reply out loud on the pointer, with no click, and keeps the reply up", () => {
    const speech = installSpeechMock();
    renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    fireEvent.click(screen.getByTestId("reply-tap"));
    const readAloud = within(screen.getByTestId("clip-reply")).getByTestId("read-aloud-button");
    act(() => {
      vi.advanceTimersByTime(REPLY_MS - 500);
    });
    fireEvent.pointerDown(readAloud, pointer({ pointerId: 4, isPrimary: false }));
    act(() => {
      vi.advanceTimersByTime(1000); // a slow press: the reply must not time out under the finger
    });
    expect(screen.getByTestId("clip-reply")).toBeInTheDocument();
    fireEvent.pointerUp(readAloud, pointer({ pointerId: 4, isPrimary: false }));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.lastUtterance().text).toBe("Play a little first!");
    fireEvent.click(readAloud); // the compatibility click: no second voice, no stop
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.cancel).toHaveBeenCalledTimes(1); // speak() cancels what was playing first
  });

  it("lets a press that started on the game cross and end over the chip and the star: the game hears it, nothing taps", async () => {
    // A game that holds thrust while a finger is down (window listeners).
    let thrust = false;
    const heard: string[] = [];
    const onDown = () => (thrust = true);
    const onUp = (event: Event) => {
      thrust = false;
      heard.push(event.type);
    };
    const onOther = (event: Event) => heard.push(event.type);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onOther);
    window.addEventListener("mouseup", onOther);
    try {
      const { fake } = renderWithClips(
        <>
          <div data-testid="game" />
          <ToastSlot />
        </>,
        { records: [makeRecord({ id: "c1" })], snapshot: { ...RECORDING, unwatchedClipId: "c1" } },
      );
      const star = screen.getByTestId("clip-star-button");
      const chip = screen.getByTestId("clip-new-chip");
      // The thumb holds thrust, slides over the star and lifts on it.
      fireEvent.pointerDown(screen.getByTestId("game"), pointer({ pointerId: 4 }));
      fireEvent.pointerMove(star, pointer({ pointerId: 4 }));
      fireEvent.pointerUp(star, pointer({ pointerId: 4 }));
      expect(thrust).toBe(false);
      // Again over the chip, with a mouse this time.
      fireEvent.pointerDown(screen.getByTestId("game"), pointer({ pointerId: 1, pointerType: "mouse" }));
      fireEvent.pointerMove(chip, pointer({ pointerId: 1, pointerType: "mouse" }));
      fireEvent.pointerUp(chip, pointer({ pointerId: 1, pointerType: "mouse" }));
      fireEvent.mouseUp(chip);
      expect(thrust).toBe(false);
      expect(heard).toEqual(["pointermove", "pointerup", "pointermove", "pointerup", "mouseup"]);
      await flush();
      expect(fake.service.addStar).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onOther);
      window.removeEventListener("mouseup", onOther);
    }
  });

  it("forgets a mouse press that left the chip: a later release there from the game never opens the clip", async () => {
    const heard: string[] = [];
    const listener = (event: Event) => heard.push(event.type);
    window.addEventListener("pointerup", listener);
    try {
      const { fake } = renderWithClips(
        <>
          <div data-testid="game" />
          <ToastSlot />
        </>,
        { records: [makeRecord({ id: "c1" })], snapshot: { unwatchedClipId: "c1", gameCanPause: true, atBreak: false } },
      );
      const chip = screen.getByTestId("clip-new-chip");
      // A mouse press on the chip slides off and lets go on the game: no tap.
      fireEvent.pointerDown(chip, pointer({ pointerId: 1, pointerType: "mouse" }));
      fireEvent.pointerLeave(chip, pointer({ pointerId: 1, pointerType: "mouse" }));
      fireEvent.pointerUp(screen.getByTestId("game"), pointer({ pointerId: 1, pointerType: "mouse" }));
      // Later, a press on the game ends over the chip.
      fireEvent.pointerDown(screen.getByTestId("game"), pointer({ pointerId: 1, pointerType: "mouse" }));
      fireEvent.pointerUp(chip, pointer({ pointerId: 1, pointerType: "mouse" }));
      await flush();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(fake.service.markWatched).not.toHaveBeenCalled();
      expect(heard).toEqual(["pointerup", "pointerup"]);
    } finally {
      window.removeEventListener("pointerup", listener);
    }
  });

  it("never leaves keyboard focus on an in-play control after a pointer press", () => {
    installSpeechMock();
    renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
      { records: [makeRecord({ id: "c1" })], snapshot: { ...RECORDING, unwatchedClipId: "c1" } },
    );
    fireEvent.click(screen.getByTestId("reply-tap"));
    const controls = [
      screen.getByTestId("clip-star-button"),
      screen.getByTestId("clip-new-chip"),
      within(screen.getByTestId("clip-reply")).getByTestId("read-aloud-button"),
    ];
    for (const control of controls) {
      // false: the default action of mousedown (focus) was prevented.
      expect(fireEvent.mouseDown(control), control.getAttribute("data-testid") ?? "").toBe(false);
    }
  });
});

describe("the reply announcer (plan 11.3)", () => {
  it("keeps one live region on the page and changes only its words", () => {
    renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    const announcer = screen.getByTestId("clip-toast-announcer");
    expect(announcer.getAttribute("role")).toBe("status");
    expect(announcer.getAttribute("aria-live")).toBe("polite");
    expect(announcer).toHaveTextContent("");
    fireEvent.click(screen.getByTestId("reply-tap"));
    expect(screen.getByTestId("clip-toast-announcer")).toBe(announcer);
    expect(announcer).toHaveTextContent("Play a little first!");
    fireEvent.click(screen.getByTestId("reply-info"));
    expect(screen.getByTestId("clip-toast-announcer")).toBe(announcer);
    expect(announcer).toHaveTextContent("Clip made!");
    // The visible toast is not a second live region.
    expect(screen.getByTestId("clip-reply").getAttribute("role")).toBeNull();
  });
});

describe("the new-clip chip (plan 11.1)", () => {
  it("pauses the game BEFORE the viewer opens, where the game can pause", async () => {
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { unwatchedClipId: "c1", gameCanPause: true, atBreak: false } });
    const order: string[] = [];
    const view = renderWithClips(<ToastSlot />, { fake });
    view.pauseGame.mockImplementation(() => {
      order.push(screen.queryByTestId("clip-viewer") ? "pause-after-open" : "pause-before-open");
      fake.set({ atBreak: true });
    });
    fireEvent.click(screen.getByTestId("clip-new-chip"));
    await flush();
    expect(order).toEqual(["pause-before-open"]);
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.clip })).toBeInTheDocument();
    // Watching it clears the chip.
    expect(fake.service.markWatched).toHaveBeenCalledWith("c1");
    expect(screen.queryByTestId("clip-new-chip")).toBeNull();
  });

  it('in a run that cannot pause, says "ready when this run ends" and opens the clip at the break', async () => {
    installSpeechMock();
    const record = makeRecord({ id: "c1" });
    const { fake, pauseGame } = renderWithClips(<ToastSlot />, {
      records: [record],
      snapshot: { unwatchedClipId: "c1", gameCanPause: false, atBreak: false },
    });
    fireEvent.click(screen.getByTestId("clip-new-chip"));
    expect(pauseGame).not.toHaveBeenCalled();
    expect(screen.queryByTestId("clip-viewer")).toBeNull();
    const reply = screen.getByTestId("clip-reply");
    expect(reply).toHaveTextContent(TOAST_COPY.readyAtRunEnd);
    expect(within(reply).getByTestId("read-aloud-button")).toBeInTheDocument();

    act(() => fake.set({ atBreak: true })); // the run ends
    await flush();
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.clip })).toBeInTheDocument();
  });

  it("opens at once at a break", async () => {
    const { pauseGame } = renderWithClips(<ToastSlot />, {
      records: [makeRecord({ id: "c1" })],
      snapshot: { unwatchedClipId: "c1", atBreak: true },
    });
    fireEvent.click(screen.getByTestId("clip-new-chip"));
    await flush();
    expect(pauseGame).not.toHaveBeenCalled();
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
  });

  it("hides while a sheet is open", async () => {
    renderWithClips(<ToastSlot />, { records: [makeRecord({ id: "c1" })], snapshot: { unwatchedClipId: "c1", atBreak: true } });
    fireEvent.click(screen.getByTestId("clip-new-chip"));
    await flush();
    expect(screen.queryByTestId("clip-new-chip")).toBeNull();
  });
});

describe("Record timer and star (plan 8.4)", () => {
  it("counts the video time on between service updates and stops while paused", async () => {
    const { fake } = renderWithClips(<ToastSlot />, {
      snapshot: {
        button: "recording",
        engine: "recording",
        recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 62, stars: 0 },
      },
    });
    const pill = () => screen.getByTestId("clip-record-pill");
    expect(pill()).toHaveAccessibleName(recordTimerName("1:02", 0));
    expect(pill().className).toContain("pointer-events-none");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(pill()).toHaveTextContent("1:05");
    // Paused: the time stops where it was (paused time is not video time).
    act(() => fake.set({ engine: "suspended" }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(pill()).toHaveTextContent("1:05");
    // Play again: it goes on from 1:05, not back to the last service time.
    act(() => fake.set({ engine: "recording" }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(pill()).toHaveTextContent("1:07");
    // A new time from the service wins.
    act(() => fake.set({ recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 70, stars: 0 } }));
    expect(pill()).toHaveTextContent("1:10");
  });

  it("adds a star with the 44 px star button and shows the count", () => {
    const { fake } = renderWithClips(<ToastSlot />, {
      snapshot: {
        button: "recording",
        engine: "recording",
        recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 5, stars: 0 },
      },
    });
    const star = screen.getByRole("button", { name: TOAST_COPY.addStar });
    expect(star.className).toMatch(/(^|\s)h-11(\s|$)/);
    expect(star.style.width).toBe("44px");
    fireEvent.click(star);
    fireEvent.click(star);
    expect(fake.service.addStar).toHaveBeenCalledTimes(2);
    expect(star).toHaveTextContent("2");
    expect(screen.getByTestId("clip-record-pill")).toHaveAccessibleName(recordTimerName("0:05", 2));
  });
});

describe("the one-time hold tip (plan 11.4)", () => {
  it(`shows after the ${HOLD_TIP_AFTER_CLIPS}rd clip, only at a break, with read-aloud, and never again`, async () => {
    installSpeechMock();
    const { fake } = renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    for (let i = 0; i < HOLD_TIP_AFTER_CLIPS; i++) fireEvent.click(screen.getByTestId("note-clip"));
    // During play it waits.
    expect(screen.queryByTestId("clip-hold-tip")).toBeNull();
    act(() => fake.set({ atBreak: true }));
    const tip = screen.getByTestId("clip-hold-tip");
    expect(tip).toHaveTextContent(TOAST_COPY.holdTip);
    expect(within(tip).getByTestId("read-aloud-button")).toBeInTheDocument();
    fireEvent.click(within(tip).getByRole("button", { name: TOAST_COPY.holdTipDone }));
    expect(screen.queryByTestId("clip-hold-tip")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY)!)).toMatchObject({ holdTipShown: true, manualClips: 3 });

    // More clips never bring it back.
    fireEvent.click(screen.getByTestId("note-clip"));
    act(() => fake.set({ atBreak: false }));
    act(() => fake.set({ atBreak: true }));
    expect(screen.queryByTestId("clip-hold-tip")).toBeNull();
  });

  it("keeps a press on the tip to itself, and lets a press from the game end over it", () => {
    const heard: string[] = [];
    const listener = (event: Event) => heard.push(event.type);
    window.addEventListener("pointerup", listener);
    window.addEventListener("mouseup", listener);
    try {
      const { fake } = renderWithClips(
        <>
          <div data-testid="game" />
          <ToastSlot />
          <Controls />
        </>,
      );
      for (let i = 0; i < HOLD_TIP_AFTER_CLIPS; i++) fireEvent.click(screen.getByTestId("note-clip"));
      act(() => fake.set({ atBreak: true }));
      const words = screen.getByTestId("clip-hold-tip").querySelector("p")!;
      expect(words.textContent?.replace(/\s+/g, " ").trim()).toBe(TOAST_COPY.holdTip);
      // A press on the tip's words stays with the tip.
      fireEvent.pointerDown(words, pointer({ pointerId: 2 }));
      fireEvent.mouseDown(words);
      fireEvent.pointerUp(words, pointer({ pointerId: 2 }));
      fireEvent.mouseUp(words);
      expect(heard).toEqual([]);
      // A press from the game that ends over the tip reaches the game.
      fireEvent.pointerDown(screen.getByTestId("game"), pointer({ pointerId: 3 }));
      fireEvent.pointerUp(words, pointer({ pointerId: 3 }));
      fireEvent.mouseUp(words);
      expect(heard).toEqual(["pointerup", "mouseup"]);
    } finally {
      window.removeEventListener("pointerup", listener);
      window.removeEventListener("mouseup", listener);
    }
  });

  it("waits for a break where the kid can see it (the pause menu covers the strip)", () => {
    const cover = document.createElement("div");
    document.body.appendChild(cover);
    let covered = true;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      writable: true,
      value: () => (covered ? cover : document.querySelector('[data-testid="clip-hold-tip"] p')),
    });
    try {
      const { fake } = renderWithClips(
        <>
          <ToastSlot />
          <Controls />
        </>,
      );
      for (let i = 0; i < HOLD_TIP_AFTER_CLIPS; i++) fireEvent.click(screen.getByTestId("note-clip"));
      act(() => fake.set({ atBreak: true })); // the pause menu is open over the strip
      expect(screen.getByTestId("clip-hold-tip").getAttribute("data-tip")).toBe("due");
      expect(window.localStorage.getItem(UI_PREFS_KEY)).not.toContain('"holdTipShown":true');

      act(() => fake.set({ atBreak: false })); // play again
      expect(screen.queryByTestId("clip-hold-tip")).toBeNull();
      covered = false;
      act(() => fake.set({ atBreak: true })); // game over: nothing covers the strip
      expect(screen.getByTestId("clip-hold-tip").getAttribute("data-tip")).toBe("showing");
      expect(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY)!).holdTipShown).toBe(true);
    } finally {
      // @ts-expect-error - remove the stub again
      delete document.elementFromPoint;
      cover.remove();
    }
  });

  it("speaks the tip once when it shows (a spoken tip, plan 11.4)", () => {
    const speech = installSpeechMock();
    const { fake } = renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    for (let i = 0; i < HOLD_TIP_AFTER_CLIPS; i++) fireEvent.click(screen.getByTestId("note-clip"));
    expect(speech.speak).not.toHaveBeenCalled(); // not during play
    act(() => fake.set({ atBreak: true }));
    expect(screen.getByTestId("clip-hold-tip").getAttribute("data-tip")).toBe("showing");
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.lastUtterance().text).toBe(TOAST_COPY.holdTip);
    // Later changes do not say it again.
    act(() => fake.set({ bufferedSec: 12 }));
    expect(speech.speak).toHaveBeenCalledTimes(1);
    // The tip's button shares the tip's voice: while it speaks, a tap stops it.
    const button = within(screen.getByTestId("clip-hold-tip")).getByTestId("read-aloud-button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    const cancelsBefore = speech.cancel.mock.calls.length;
    fireEvent.click(button);
    expect(speech.cancel.mock.calls.length).toBe(cancelsBefore + 1);
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("stays quiet when the page has not been tapped yet (the browser would block the voice)", () => {
    const speech = installSpeechMock();
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: false } });
    try {
      const { fake } = renderWithClips(
        <>
          <ToastSlot />
          <Controls />
        </>,
      );
      for (let i = 0; i < HOLD_TIP_AFTER_CLIPS; i++) fireEvent.click(screen.getByTestId("note-clip"));
      act(() => fake.set({ atBreak: true }));
      expect(screen.getByTestId("clip-hold-tip")).toBeInTheDocument();
      expect(speech.speak).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { userActivation?: unknown }).userActivation;
    }
  });

  it("does not show before the third clip", () => {
    const { fake } = renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    fireEvent.click(screen.getByTestId("note-clip"));
    fireEvent.click(screen.getByTestId("note-clip"));
    act(() => fake.set({ atBreak: true }));
    expect(screen.queryByTestId("clip-hold-tip")).toBeNull();
  });
});
