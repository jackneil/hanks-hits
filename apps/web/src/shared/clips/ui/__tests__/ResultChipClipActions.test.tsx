import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";

import { HIDDEN_SNAPSHOT, type ClipSnapshot } from "../../service/contract";
import { MENU_COPY, RESULT_ACTION_COPY, VIEWER_TITLES, wholeRunLabel } from "../copy";
import { ResultChipClipActions, resultChipClipActions } from "../ResultChipClipActions";
import { createFakeClipService, makeRecord, PLAYING } from "./fakeClipService";
import { flush, renderWithClips, stubObjectUrls } from "./renderClips";

beforeEach(() => {
  stubObjectUrls();
});

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

const AT_GAME_OVER: Partial<ClipSnapshot> = { atBreak: true, bufferedSec: 45 };

function snapshot(overrides: Partial<ClipSnapshot> = {}): ClipSnapshot {
  return { ...HIDDEN_SNAPSHOT, ...PLAYING, ...AT_GAME_OVER, ...overrides };
}

function labels() {
  return screen.getAllByRole("button").map((button) => button.textContent);
}

describe("result chip clip actions (plan 11.4)", () => {
  it("lists Watch, Record a video and Take a picture, at the chip's button size", () => {
    renderWithClips(<ResultChipClipActions />, { snapshot: AT_GAME_OVER });
    expect(labels()).toEqual([RESULT_ACTION_COPY.watch, RESULT_ACTION_COPY.record, RESULT_ACTION_COPY.picture]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/(^|\s)min-h-14(\s|$)/);
      expect(button.className).toMatch(/(^|\s)short:min-h-11(\s|$)/);
      // White buttons on the white chip: each needs a visible edge.
      expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(SECONDARY_ACTION.split(" ")));
      // The chip's own size rule, with the two-column narrow grid.
      expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(RESULT_CHIP_BUTTON.split(" ")));
    }
  });

  it('gives the long "Make the whole run a video" button both columns of the narrow grid', () => {
    renderWithClips(<ResultChipClipActions runSeconds={30} />, { snapshot: AT_GAME_OVER });
    const wholeRun = screen.getByRole("button", { name: wholeRunLabel("0:30") });
    expect(wholeRun.className.split(/\s+/)).toContain("max-[480px]:col-span-2");
    const watch = screen.getByRole("button", { name: RESULT_ACTION_COPY.watch });
    expect(watch.className).not.toContain("col-span-2");
  });

  it('offers "Make the whole run a video (m:ss)" only when the ring holds the whole run', () => {
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), 42).map((action) => action.label)).toContain(
      wholeRunLabel("0:42"),
    );
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), 250).map((action) => action.id)).not.toContain("wholeRun");
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 })).map((action) => action.id)).not.toContain("wholeRun");
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), 0).map((action) => action.id)).not.toContain("wholeRun");
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), Number.NaN).map((action) => action.id)).not.toContain(
      "wholeRun",
    );
    // Capture that ran since the run ended pushed the ring's start on by that much.
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), 42, 3).map((action) => action.id)).toContain("wholeRun");
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), 42, 3.5).map((action) => action.id)).not.toContain("wholeRun");
  });

  it("fits limited states: record only has no instant clips, the breaker has no capture", () => {
    expect(resultChipClipActions(snapshot({ button: "record-only" })).map((action) => action.id)).toEqual(["record", "picture"]);
    expect(resultChipClipActions(snapshot({ button: "disabled" }))).toEqual([]);
    expect(resultChipClipActions(snapshot({ button: "disabled", unwatchedClipId: "c1" })).map((action) => action.id)).toEqual([
      "watch",
    ]);
    expect(resultChipClipActions(snapshot({ button: "hidden" }))).toEqual([]);
  });

  // ResultChip reads these buttons' visible labels out loud in screen order
  // (shell/__tests__/GameShellClipUi.test.tsx, "a ResultChip in the game").

  it("Watch opens the newest unwatched clip at once", async () => {
    const record = makeRecord({ id: "c1" });
    const { fake, pauseGame } = renderWithClips(<ResultChipClipActions />, {
      records: [record],
      snapshot: { ...AT_GAME_OVER, unwatchedClipId: "c1" },
    });
    fireEvent.click(screen.getByRole("button", { name: RESULT_ACTION_COPY.watch }));
    await flush();
    expect(pauseGame).not.toHaveBeenCalled();
    expect(fake.service.clipLast).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.clip })).toBeInTheDocument();
  });

  it("Watch clips the last 30 seconds OF THE RUN and opens it when there is no new clip", async () => {
    const fake = createFakeClipService({ snapshot: AT_GAME_OVER });
    const runEndUs = fake.captureUs();
    renderWithClips(<ResultChipClipActions />, { fake });
    const token = vi.mocked(fake.service.beginPress).mock.results[0].value;
    expect(token).toMatchObject({ endAtUs: runEndUs });
    // The kid stays on the result screen while capture runs on.
    fake.advanceCapture(8);
    fireEvent.click(screen.getByRole("button", { name: RESULT_ACTION_COPY.watch }));
    await flush(6);
    expect(fake.service.clipLast).toHaveBeenCalledWith(30, token);
    expect(fake.clipRequests).toEqual([{ seconds: 30, endAtUs: runEndUs, frozen: true }]);
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
    expect(fake.service.library.file).toHaveBeenCalledWith(fake.records[0].id);
    // The frozen end was taken as a press and let go at once: nothing stays open.
    expect(fake.openPressCount()).toBe(0);
  });

  it("Make the whole run a video clips the whole run, ending where the run ended", async () => {
    const fake = createFakeClipService({ snapshot: AT_GAME_OVER });
    const runEndUs = fake.captureUs();
    renderWithClips(<ResultChipClipActions runSeconds={41.2} />, { fake });
    fake.advanceCapture(2); // a short post-roll on the result screen
    fireEvent.click(screen.getByRole("button", { name: wholeRunLabel("0:41") }));
    await flush(6);
    expect(fake.clipRequests).toEqual([{ seconds: 42, endAtUs: runEndUs, frozen: true }]);
    expect(fake.records[0].durationMs).toBe(42_000);
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
  });

  it("drops the whole-run button once capture on the result screen pushes the run's start out of the ring", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const fake = createFakeClipService({ snapshot: { ...AT_GAME_OVER, engine: "buffering", bufferedSec: 45 } });
    renderWithClips(<ResultChipClipActions runSeconds={42} />, { fake });
    const wholeRun = () => screen.queryByRole("button", { name: wholeRunLabel("0:42") });
    expect(wholeRun()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(wholeRun()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000); // 4 s of capture since the run ended: 42 + 4 > 45
    });
    expect(wholeRun()).toBeNull();
  });

  it("keeps the whole-run button while capture is stopped at the break (the ring does not move)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const fake = createFakeClipService({ snapshot: { ...AT_GAME_OVER, engine: "buffering", bufferedSec: 45 } });
    renderWithClips(<ResultChipClipActions runSeconds={42} />, { fake });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => fake.set({ engine: "suspended", button: "suspended" })); // the post-roll ends
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole("button", { name: wholeRunLabel("0:42") })).not.toBeNull();
  });

  it("does not leave keyboard focus on a clip button after a mouse press", () => {
    renderWithClips(<ResultChipClipActions />, { snapshot: AT_GAME_OVER });
    const watch = screen.getByRole("button", { name: RESULT_ACTION_COPY.watch });
    // fireEvent returns false when the default (focusing the button) was prevented.
    expect(fireEvent.mouseDown(watch)).toBe(false);
  });

  it("Take a picture takes the result screen and opens it", async () => {
    const { fake } = renderWithClips(<ResultChipClipActions />, { snapshot: AT_GAME_OVER });
    fireEvent.click(screen.getByRole("button", { name: RESULT_ACTION_COPY.picture }));
    await flush(6);
    expect(fake.service.takePicture).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.picture })).toBeInTheDocument();
  });

  it("Record a video starts one, and the same button stops it", async () => {
    const fake = createFakeClipService({ snapshot: AT_GAME_OVER });
    renderWithClips(<ResultChipClipActions />, { fake });
    fireEvent.click(screen.getByRole("button", { name: RESULT_ACTION_COPY.record }));
    await flush();
    expect(fake.service.startRecording).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: MENU_COPY.stopRecording }));
    await flush();
    expect(fake.service.stopRecording).toHaveBeenCalledTimes(1);
  });

  it("gives a kid-word reply when an action fails", async () => {
    const fake = createFakeClipService({ snapshot: AT_GAME_OVER });
    fake.failNext("quota");
    const { ToastSlot } = await import("../ToastSlot");
    renderWithClips(
      <>
        <ResultChipClipActions />
        <ToastSlot />
      </>,
      { fake },
    );
    fireEvent.click(screen.getByRole("button", { name: RESULT_ACTION_COPY.picture }));
    await flush(6);
    expect(screen.queryByTestId("clip-viewer")).toBeNull();
    expect(screen.getByTestId("clip-reply")).toHaveTextContent("Your clip space is full.");
  });
});
