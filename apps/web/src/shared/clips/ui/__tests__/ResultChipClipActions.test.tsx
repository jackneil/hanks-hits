import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HIDDEN_SNAPSHOT, type ClipSnapshot } from "../../service/contract";
import { MENU_COPY, RESULT_ACTION_COPY, VIEWER_TITLES, wholeRunLabel } from "../copy";
import {
  ResultChipClipActions,
  resultChipClipActions,
  useResultChipClipSpokenExtras,
} from "../ResultChipClipActions";
import { createFakeClipService, makeRecord, PLAYING } from "./fakeClipService";
import { flush, renderWithClips, stubObjectUrls } from "./renderClips";

beforeEach(() => {
  stubObjectUrls();
});

afterEach(() => {
  window.localStorage.clear();
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
    }
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
  });

  it("fits limited states: record only has no instant clips, the breaker has no capture", () => {
    expect(resultChipClipActions(snapshot({ button: "record-only" })).map((action) => action.id)).toEqual(["record", "picture"]);
    expect(resultChipClipActions(snapshot({ button: "disabled" }))).toEqual([]);
    expect(resultChipClipActions(snapshot({ button: "disabled", unwatchedClipId: "c1" })).map((action) => action.id)).toEqual([
      "watch",
    ]);
    expect(resultChipClipActions(snapshot({ button: "hidden" }))).toEqual([]);
  });

  /** Writes the spoken words into the page, the way ResultChip receives them. */
  function SpokenProbe({ runSeconds, withButtons }: { runSeconds?: number; withButtons: boolean }) {
    const spoken = useResultChipClipSpokenExtras({ runSeconds });
    return (
      <>
        <output data-testid="spoken">{JSON.stringify(spoken)}</output>
        {withButtons && <ResultChipClipActions runSeconds={runSeconds} />}
      </>
    );
  }

  function spoken(): string[] {
    return JSON.parse(screen.getByTestId("spoken").textContent ?? "null");
  }

  it("gives the same words, in the same order, for the chip's spokenExtras", () => {
    renderWithClips(<SpokenProbe runSeconds={30} withButtons />, { snapshot: AT_GAME_OVER });
    expect(spoken()).toEqual(labels());
    expect(spoken()[1]).toBe(wholeRunLabel("0:30"));
  });

  it("says nothing without a clip service", () => {
    render(<SpokenProbe withButtons={false} />);
    expect(spoken()).toEqual([]);
  });

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

  it("Watch clips the last 30 seconds and opens it when there is no new clip", async () => {
    const { fake } = renderWithClips(<ResultChipClipActions />, { snapshot: AT_GAME_OVER });
    fireEvent.click(screen.getByRole("button", { name: RESULT_ACTION_COPY.watch }));
    await flush(6);
    expect(fake.service.clipLast).toHaveBeenCalledWith(30);
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
    expect(fake.service.library.file).toHaveBeenCalledWith(fake.records[0].id);
  });

  it("Make the whole run a video clips the run length and opens it", async () => {
    const { fake } = renderWithClips(<ResultChipClipActions runSeconds={41.2} />, { snapshot: AT_GAME_OVER });
    fireEvent.click(screen.getByRole("button", { name: wholeRunLabel("0:41") }));
    await flush(6);
    expect(fake.service.clipLast).toHaveBeenCalledWith(42);
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
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
