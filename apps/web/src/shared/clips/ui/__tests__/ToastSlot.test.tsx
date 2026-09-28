import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

import { useClipUi } from "../ClipUiProvider";
import { recordTimerName, TOAST_COPY, VIEWER_TITLES } from "../copy";
import { TOAST_SLOT_Z_INDEX, ToastSlot } from "../ToastSlot";
import { HOLD_TIP_AFTER_CLIPS, REPLY_MS, REPLY_READING_MS, UI_PREFS_KEY } from "../uiStore";
import { createFakeClipService, makeRecord } from "./fakeClipService";
import { flush, renderWithClips, stubObjectUrls } from "./renderClips";

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
    expect(slot().className).toMatch(/(^|\s)top-12(\s|$)/);
    expect(slot().className).toMatch(/(^|\s)md:top-14(\s|$)/);
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
    expect(reply.getAttribute("role")).toBe("status");
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
