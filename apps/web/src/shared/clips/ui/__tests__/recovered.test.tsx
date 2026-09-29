/**
 * Record videos saved from last time reach the kid (plan 8.4 crash
 * recovery): the io worker stores the journaled parts of a recording that a
 * closed or crashed tab left, and the service holds them for the UI. The
 * clip UI takes them when it starts, whenever the library says new ones
 * came back, and when My clips opens. The kid then gets the words and the
 * new-clip chip that opens the video.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

import { RECOVERED_COPY, recoveredReplyText, VIEWER_COPY, VIEWER_TITLES } from "../copy";
import { ToastSlot } from "../ToastSlot";
import { useClipUi } from "../uiContext";
import { createFakeClipService, makeRecord } from "./fakeClipService";
import { flush, pointer, renderWithClips, stubObjectUrls } from "./renderClips";

beforeEach(() => {
  stubObjectUrls();
  window.localStorage.clear();
});

afterEach(() => {
  removeSpeechMock();
});

function OpenList() {
  const ui = useClipUi();
  return (
    <button type="button" data-testid="open-list" onClick={() => ui?.openViewer({ kind: "game", gameId: "snake" })}>
      open
    </button>
  );
}

function reply() {
  return screen.queryByTestId("clip-reply");
}

const savedVideo = () => makeRecord({ id: "rec-last-time", kind: "record", gameId: "snake", durationMs: 95_000 });

describe("a Record video saved from last time (plan 8.4)", () => {
  it("when the clip UI starts: the kid hears about it, and the new-clip chip opens it", async () => {
    installSpeechMock();
    const fake = createFakeClipService({ snapshot: { atBreak: true } });
    fake.recover(savedVideo());
    renderWithClips(<ToastSlot />, { fake });
    await flush();
    expect(fake.service.takeRecovered).toHaveBeenCalled();
    expect(reply()).toHaveTextContent(recoveredReplyText());
    expect(recoveredReplyText()).toBe("Your video from last time is safe! Tap New clip to watch it.");
    // A reply the kid did not ask for still keeps its read-aloud button.
    expect(within(reply()!).getByTestId("read-aloud-button")).toBeInTheDocument();
    const chip = screen.getByTestId("clip-new-chip");
    fireEvent.pointerDown(chip, pointer());
    fireEvent.pointerUp(chip, pointer());
    await flush();
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.record })).toBeInTheDocument();
    expect(fake.service.markWatched).toHaveBeenCalledWith("rec-last-time");
  });

  it("during play the chip shows at once, and the words wait for a break", async () => {
    const fake = createFakeClipService({ snapshot: { atBreak: false, gameCanPause: true } });
    fake.recover(savedVideo());
    renderWithClips(<ToastSlot />, { fake });
    await flush();
    expect(screen.getByTestId("clip-new-chip")).toBeInTheDocument();
    expect(reply()).toBeNull();
    act(() => fake.set({ atBreak: true }));
    expect(reply()).toHaveTextContent(recoveredReplyText());
  });

  it("a video that comes back while the page is open (the library tells the UI) gets the same words, once", async () => {
    const fake = createFakeClipService({ snapshot: { atBreak: true } });
    renderWithClips(<ToastSlot />, { fake });
    await flush();
    expect(reply()).toBeNull();
    act(() => fake.recover(savedVideo()));
    await flush();
    expect(reply()).toHaveTextContent(recoveredReplyText());
    expect(fake.snapshot().unwatchedClipId).toBe("rec-last-time");
    // Other library changes do not say it again.
    act(() => fake.set({ atBreak: false }));
    act(() => fake.set({ atBreak: true }));
    await act(async () => {
      await fake.service.library.setKept("rec-last-time", true);
    });
    await flush();
    expect(fake.service.takeRecovered).toHaveBeenCalledTimes(3);
  });

  it("when My clips opens: the list shows the note with Watch it, which plays the video, and no reply follows", async () => {
    const speech = installSpeechMock();
    const fake = createFakeClipService({ snapshot: { atBreak: true } });
    renderWithClips(
      <>
        <ToastSlot />
        <OpenList />
      </>,
      { fake },
    );
    await flush();
    // It comes back with no library message (another player read it first):
    // only opening My clips finds it.
    fake.recover(savedVideo(), { notify: false });
    fireEvent.click(screen.getByTestId("open-list"));
    await flush();
    const note = screen.getByTestId("clip-viewer-recovered");
    expect(note).toHaveTextContent(RECOVERED_COPY.say);
    fireEvent.click(within(screen.getByTestId("clip-viewer")).getByTestId("read-aloud-button"));
    const spoken = speech.lastUtterance().text;
    expect(spoken).toContain(RECOVERED_COPY.say);
    expect(spoken.indexOf(RECOVERED_COPY.watch)).toBeGreaterThan(spoken.indexOf(RECOVERED_COPY.say));

    fireEvent.click(within(note).getByRole("button", { name: RECOVERED_COPY.watch }));
    await flush();
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.record })).toBeInTheDocument();
    expect(screen.queryByTestId("clip-viewer-recovered")).toBeNull();
    expect(fake.service.markWatched).toHaveBeenCalledWith("rec-last-time");
    // Back to the list: the note is gone, and closing leaves no reply behind.
    fireEvent.click(screen.getByRole("button", { name: VIEWER_COPY.backToList }));
    expect(screen.queryByTestId("clip-viewer-recovered")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: VIEWER_COPY.close }));
    await flush();
    expect(reply()).toBeNull();
  });

  it("a note the kid saw in My clips and closed without watching does not come back as a reply", async () => {
    const fake = createFakeClipService({ snapshot: { atBreak: true } });
    renderWithClips(
      <>
        <ToastSlot />
        <OpenList />
      </>,
      { fake },
    );
    await flush();
    fake.recover(savedVideo(), { notify: false });
    fireEvent.click(screen.getByTestId("open-list"));
    await flush();
    expect(screen.getByTestId("clip-viewer-recovered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: VIEWER_COPY.close }));
    await flush();
    expect(reply()).toBeNull();
    // The chip still opens it.
    expect(screen.getByTestId("clip-new-chip")).toBeInTheDocument();
  });
});
