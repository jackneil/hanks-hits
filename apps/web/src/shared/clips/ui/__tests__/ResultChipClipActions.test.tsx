import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESULT_CHIP_BUTTON, SECONDARY_ACTION } from "@/shared/components/buttonStyles";

import { HIDDEN_SNAPSHOT, type ClipSnapshot, type PressToken } from "../../service/contract";
import { RESULT_ACTION_COPY, VIEWER_TITLES, watchRunLabel, wholeRunLabel } from "../copy";
import { chipRunOf, RING_REPORT_SLACK_SEC, ResultChipClipActions, resultChipClipActions, type ChipRun } from "../ResultChipClipActions";
import { createFakeClipService, makeRecord, PLAYING, type FakeClipService } from "./fakeClipService";
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

/** A fake at game over, after a run of `seconds` that ended now. */
function afterRun(seconds: number, overrides: Partial<ClipSnapshot> = {}): FakeClipService {
  const fake = createFakeClipService({ snapshot: { ...AT_GAME_OVER, ...overrides } });
  fake.playRun(seconds);
  return fake;
}

const run = (seconds: number, spanSec = seconds): ChipRun => ({ seconds, spanSec });

describe("result chip clip actions (plan 11.4, decision D1)", () => {
  it("offers one action for a run of 30 s or less: Watch the whole run (m:ss), at the chip's button size", () => {
    renderWithClips(<ResultChipClipActions />, { fake: afterRun(16.08) });
    expect(labels()).toEqual([watchRunLabel("0:16")]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/(^|\s)min-h-14(\s|$)/);
      expect(button.className).toMatch(/(^|\s)short:min-h-11(\s|$)/);
      // White buttons on the white chip: each needs a visible edge.
      expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(SECONDARY_ACTION.split(" ")));
      // The chip's own size rule, and the full width of the narrow two-column grid.
      expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(RESULT_CHIP_BUTTON.split(" ")));
      expect(button.className.split(/\s+/)).toContain("max-[480px]:col-span-2");
    }
  });

  it("offers Watch the end and Make the whole run a video (m:ss) for a longer run", () => {
    renderWithClips(<ResultChipClipActions />, { fake: afterRun(42.5) });
    expect(labels()).toEqual([RESULT_ACTION_COPY.watchEnd, wholeRunLabel("0:42")]);
  });

  it("never offers Record a video or Take a picture (they stay in the Capture menu)", () => {
    for (const seconds of [10, 30, 30.5, 55]) {
      const ids = resultChipClipActions(snapshot({ bufferedSec: 60 }), run(seconds)).map((action) => action.id);
      expect(ids.every((id) => id === "watchRun" || id === "watchEnd" || id === "wholeRun"), String(seconds)).toBe(true);
    }
    expect(resultChipClipActions(snapshot(), run(30)).map((action) => action.id)).toEqual(["watchRun"]);
    expect(resultChipClipActions(snapshot(), run(30.5)).map((action) => action.id)).toEqual(["watchEnd", "wholeRun"]);
  });

  it('offers the whole run only while the ring holds its start; a short run then gets "Watch the end"', () => {
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), run(42)).map((action) => action.id)).toEqual(["watchEnd", "wholeRun"]);
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), run(250)).map((action) => action.id)).toEqual(["watchEnd"]);
    // Capture that ran since the run ended pushed the ring's start on by that much.
    // The slack: one keyframe gap (1 s) and the age of the last ring report (1 s).
    expect(RING_REPORT_SLACK_SEC).toBe(1);
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), run(42), 5).map((action) => action.id)).toContain("wholeRun");
    expect(resultChipClipActions(snapshot({ bufferedSec: 45 }), run(42), 5.5).map((action) => action.id)).toEqual(["watchEnd"]);
    expect(resultChipClipActions(snapshot({ bufferedSec: 12 }), run(20)).map((action) => action.id)).toEqual(["watchEnd"]);
    // The first run of a page: capture started a moment after the run, and
    // the last ring report is up to a second old. The chip still offers the
    // whole run, with the length of the clip that the kid gets.
    expect(resultChipClipActions(snapshot({ bufferedSec: 22.4 }), run(23.9)).map((action) => action.label)).toEqual([watchRunLabel("0:22")]);
    expect(resultChipClipActions(snapshot({ bufferedSec: 43 }), run(44.5), 0).map((action) => action.label)).toEqual([
      RESULT_ACTION_COPY.watchEnd,
      wholeRunLabel("0:43"),
    ]);
    expect(resultChipClipActions(snapshot({ bufferedSec: 43 }), run(44.5), 0)[1].spoken).toBe("Make the whole run a video, 43 seconds");
  });

  it("offers nothing with no run, a run too short to clip, or a state with no footage", () => {
    expect(resultChipClipActions(snapshot(), null)).toEqual([]);
    // Shorter than the shortest clip plus one keyframe gap.
    expect(resultChipClipActions(snapshot(), run(3.9))).toEqual([]);
    expect(resultChipClipActions(snapshot(), run(4)).map((action) => action.id)).toEqual(["watchRun"]);
    expect(resultChipClipActions(snapshot({ replayGranularitySec: 5 }), run(7))).toEqual([]);
    for (const button of ["hidden", "record-only", "disabled", "warming", "recording", "error"] as const) {
      expect(resultChipClipActions(snapshot({ button }), run(20)), button).toEqual([]);
    }
    for (const button of ["ready", "made", "suspended", "resting", "saving"] as const) {
      expect(resultChipClipActions(snapshot({ button }), run(20)), button).toHaveLength(1);
    }
  });

  it("reads the run from the frozen end's token: its end is the earlier of the two", () => {
    const token = (endAtUs: number, span: PressToken["run"]): PressToken => ({ pressId: "p", downAtMs: 0, endAtUs, run: span });
    expect(chipRunOf(token(50e6, { startUs: 34e6, endUs: null }))).toEqual({ seconds: 16, spanSec: 16 });
    expect(chipRunOf(token(50e6, { startUs: 34e6, endUs: 49e6 }))).toEqual({ seconds: 15, spanSec: 16 });
    expect(chipRunOf(token(50e6, null))).toBeNull();
    expect(chipRunOf(null)).toBeNull();
  });

  it("gives the voice the length in words", () => {
    expect(resultChipClipActions(snapshot(), run(16.08))[0].spoken).toBe("Watch the whole run, 16 seconds");
    expect(resultChipClipActions(snapshot({ bufferedSec: 200 }), run(102)).map((action) => action.spoken)).toEqual([
      "Watch the end",
      "Make the whole run a video, 1 minute and 42 seconds",
    ]);
    renderWithClips(<ResultChipClipActions />, { fake: afterRun(16.08) });
    expect(screen.getByRole("button", { name: watchRunLabel("0:16") }).getAttribute("data-spoken")).toBe("Watch the whole run, 16 seconds");
  });

  it("Watch the whole run clips exactly the run: never footage from before its start, and not the result screen", async () => {
    const fake = createFakeClipService({ snapshot: AT_GAME_OVER });
    // An earlier run, then a restart: the new run plays 16 s and ends.
    fake.attached.runPhase("start");
    fake.advanceCapture(40);
    fake.attached.runPhase("end");
    fake.attached.runPhase("start");
    const runStartUs = fake.captureUs();
    fake.advanceCapture(16);
    fake.attached.runPhase("end");
    const runEndUs = fake.captureUs();
    renderWithClips(<ResultChipClipActions />, { fake });
    // The kid stays on the result screen while capture runs on (the post-roll).
    fake.advanceCapture(3);
    fireEvent.click(screen.getByRole("button", { name: watchRunLabel("0:16") }));
    await flush(6);
    const token = vi.mocked(fake.service.beginPress).mock.results[0].value as PressToken;
    expect(fake.service.clipRun).toHaveBeenCalledWith(token, "whole");
    expect(fake.clipRequests).toEqual([{ seconds: 16, endAtUs: runEndUs, frozen: true, notBeforeUs: runStartUs }]);
    // The clip starts at or after the new run's start.
    expect(runEndUs - fake.clipRequests[0].seconds * 1e6).toBeGreaterThanOrEqual(runStartUs);
    expect(fake.service.clipLast).not.toHaveBeenCalled();
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
    expect(fake.service.library.file).toHaveBeenCalledWith(fake.records[0].id);
    // The frozen end was taken as a press and let go at once: nothing stays open.
    expect(fake.openPressCount()).toBe(0);
  });

  it("a long run: Watch the end clips its last 30 s and Make the whole run a video clips all of it, both ending where the run ended", async () => {
    const fake = createFakeClipService({ snapshot: { ...AT_GAME_OVER, bufferedSec: 60 } });
    fake.advanceCapture(20);
    fake.attached.runPhase("start");
    const runStartUs = fake.captureUs();
    fake.advanceCapture(41.2);
    fake.attached.runPhase("end");
    const runEndUs = fake.captureUs();
    renderWithClips(<ResultChipClipActions />, { fake });
    fake.advanceCapture(2); // a short post-roll on the result screen
    fireEvent.click(screen.getByRole("button", { name: RESULT_ACTION_COPY.watchEnd }));
    await flush(6);
    expect(fake.clipRequests).toEqual([{ seconds: 30, endAtUs: runEndUs, frozen: true, notBeforeUs: runStartUs }]);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: wholeRunLabel("0:41") }));
    await flush(6);
    expect(fake.clipRequests[1]).toEqual({ seconds: expect.closeTo(41.2, 6), endAtUs: runEndUs, frozen: true, notBeforeUs: runStartUs });
    expect(fake.records[1].durationMs).toBeCloseTo(41_200, 0);
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
  });

  it("a second tap while the run clip is made does not make a second clip", async () => {
    const fake = afterRun(16);
    renderWithClips(<ResultChipClipActions />, { fake });
    const watch = screen.getByRole("button", { name: watchRunLabel("0:16") });
    fireEvent.click(watch);
    fireEvent.click(watch);
    await flush(6);
    expect(fake.service.clipRun).toHaveBeenCalledTimes(1);
    expect(fake.records).toHaveLength(1);
  });

  it("drops the whole-run button once capture on the result screen pushes the run's start out of the ring", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const fake = afterRun(42, { engine: "buffering", bufferedSec: 45 });
    renderWithClips(<ResultChipClipActions />, { fake });
    const wholeRun = () => document.querySelector('[data-action="wholeRun"]');
    expect(wholeRun()?.textContent).toBe(wholeRunLabel("0:42"));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // 4 s of capture since the run ended: the ring lost the run's first second, and the length says so.
    expect(wholeRun()?.textContent).toBe(wholeRunLabel("0:41"));
    act(() => {
      vi.advanceTimersByTime(2000); // 6 s of capture since the run ended: 42 + 6 > 45 + 1 + 1
    });
    expect(wholeRun()).toBeNull();
    expect(labels()).toEqual([RESULT_ACTION_COPY.watchEnd]);
  });

  it("keeps the whole-run button while capture is stopped at the break (the ring does not move)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const fake = afterRun(42, { engine: "buffering", bufferedSec: 45 });
    renderWithClips(<ResultChipClipActions />, { fake });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => fake.set({ engine: "suspended", button: "suspended" })); // the post-roll ends
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByRole("button", { name: wholeRunLabel("0:42") })).not.toBeNull();
  });

  it("shows nothing when the game reported no run", () => {
    renderWithClips(<ResultChipClipActions />, { snapshot: AT_GAME_OVER });
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("does not leave keyboard focus on a clip button after a mouse press", () => {
    renderWithClips(<ResultChipClipActions />, { fake: afterRun(16) });
    const watch = screen.getByRole("button", { name: watchRunLabel("0:16") });
    // fireEvent returns false when the default (focusing the button) was prevented.
    expect(fireEvent.mouseDown(watch)).toBe(false);
  });

  it("gives a kid-word reply when the clip fails, and opens no viewer", async () => {
    const fake = afterRun(16);
    fake.failNext("quota");
    const { ToastSlot } = await import("../ToastSlot");
    renderWithClips(
      <>
        <ResultChipClipActions />
        <ToastSlot />
      </>,
      { fake },
    );
    fireEvent.click(screen.getByRole("button", { name: watchRunLabel("0:16") }));
    await flush(6);
    expect(screen.queryByTestId("clip-viewer")).toBeNull();
    expect(screen.queryByRole("dialog", { name: VIEWER_TITLES.clip })).toBeNull();
    expect(screen.getByTestId("clip-reply")).toHaveTextContent("Your clip space is full.");
  });

  it("opens the run clip even when an older clip is still unwatched", async () => {
    const older = makeRecord({ id: "older" });
    const fake = createFakeClipService({ snapshot: { ...AT_GAME_OVER, unwatchedClipId: "older" }, records: [older] });
    fake.playRun(16);
    renderWithClips(<ResultChipClipActions />, { fake });
    fireEvent.click(screen.getByRole("button", { name: watchRunLabel("0:16") }));
    await flush(6);
    expect(fake.service.clipRun).toHaveBeenCalledTimes(1);
    expect(fake.service.library.file).toHaveBeenLastCalledWith(fake.records[1].id);
  });
});
