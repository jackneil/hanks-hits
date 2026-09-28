import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

import type { ClipRecord } from "../../protocol";
import type { ShareOutcome } from "../../service/contract";
import { ClipTile } from "../ClipTile";
import { useClipUi } from "../ClipUiProvider";
import {
  DELETE_QUESTIONS,
  MEMORY_NOTE,
  SAVE_LABELS,
  VIEWER_COPY,
  VIEWER_TITLES,
  saveReply,
  shareReply,
} from "../copy";
import { UI_PREFS_KEY, type ViewerTarget } from "../uiStore";
import { createFakeClipService, makeRecord, type FakeClipService } from "./fakeClipService";
import { flush, renderWithClips, stubObjectUrls } from "./renderClips";

const REAL_UA = navigator.userAgent;
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; SM-X230) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => ua });
}

let urls: ReturnType<typeof stubObjectUrls>;

beforeEach(() => {
  urls = stubObjectUrls();
  window.localStorage.clear();
});

afterEach(() => {
  removeSpeechMock();
  setUserAgent(REAL_UA);
});

/** Opens the viewer through the controller, at a break. */
function Open({ target }: { target: ViewerTarget }) {
  const ui = useClipUi();
  return (
    <button type="button" data-testid="open-viewer" onClick={() => ui?.openViewer(target)}>
      open
    </button>
  );
}

async function openClip(record: ClipRecord, options: { fake?: FakeClipService; records?: ClipRecord[] } = {}) {
  const fake = options.fake ?? createFakeClipService({ records: options.records ?? [record], snapshot: { atBreak: true } });
  const view = renderWithClips(<Open target={{ kind: "clip", id: record.id }} />, { fake });
  fireEvent.click(screen.getByTestId("open-viewer"));
  await flush();
  return { ...view, fake };
}

function viewer() {
  return screen.getByTestId("clip-viewer");
}

function action(name: string) {
  return viewer().querySelector(`[data-action="${name}"]`) as HTMLButtonElement;
}

describe("ClipViewer: one clip (plan 11.4)", () => {
  it("plays the stored file with its poster, names the game, and has read-aloud", async () => {
    installSpeechMock();
    const record = makeRecord({ id: "c1", gameId: "snake", durationMs: 30_000 });
    const { fake } = await openClip(record);
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.clip })).toBeInTheDocument();
    const video = screen.getByTestId("clip-viewer-video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(urls.created[0]);
    expect(video.getAttribute("poster")).toBe(record.posterDataUrl);
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(fake.service.library.file).toHaveBeenCalledWith("c1");
    expect(screen.getByTestId("clip-viewer-game")).toHaveTextContent("Snake");
    expect(screen.getByTestId("clip-viewer-game")).toHaveTextContent("0:30");
    expect(within(viewer()).getByTestId("read-aloud-button")).toBeInTheDocument();
  });

  it("marks the clip watched, so the new-clip chip goes away", async () => {
    const record = makeRecord({ id: "c1", watched: false });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true, unwatchedClipId: "c1" } });
    await openClip(record, { fake });
    expect(fake.service.markWatched).toHaveBeenCalledWith("c1");
    expect(fake.service.library.markWatched).toHaveBeenCalledWith("c1");
    expect(fake.snapshot().unwatchedClipId).toBeNull();
  });

  it("shows a picture as an image", async () => {
    const record = makeRecord({ id: "p1", kind: "picture" });
    await openClip(record);
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.picture })).toBeInTheDocument();
    expect(screen.getByTestId("clip-viewer-picture").getAttribute("src")).toBe(urls.created[0]);
    expect(screen.queryByTestId("clip-viewer-video")).toBeNull();
  });

  it("frees the blob URL when it closes", async () => {
    const record = makeRecord({ id: "c1" });
    await openClip(record);
    fireEvent.click(within(viewer()).getByRole("button", { name: VIEWER_COPY.close }));
    expect(screen.queryByTestId("clip-viewer")).toBeNull();
    expect(urls.revoked).toEqual(urls.created);
  });

  it("shows a clip whose game is unknown with the generic name and never throws", async () => {
    const record = makeRecord({ id: "u1", gameId: "unknown", posterDataUrl: "" });
    await openClip(record);
    expect(screen.getByTestId("clip-viewer-game")).toHaveTextContent(VIEWER_COPY.unknownGame);
    expect(screen.getByTestId("clip-viewer-game")).toHaveTextContent("🎮");
    // An inherited key is not a game either.
    const odd = makeRecord({ id: "u2", gameId: "constructor" });
    renderWithClips(<ClipTile record={odd} onOpen={() => {}} />);
    const tiles = screen.getAllByTestId("clip-tile");
    const tile = tiles[tiles.length - 1];
    expect(tile.getAttribute("data-known-game")).toBe("false");
    expect(tile).toHaveAccessibleName(`Clip from ${VIEWER_COPY.unknownGame}, 0:30 long`);
  });

  it("says the clip is gone when the library has no such clip", async () => {
    installSpeechMock();
    const record = makeRecord({ id: "gone" });
    const fake = createFakeClipService({ records: [], snapshot: { atBreak: true } });
    await openClip(record, { fake });
    expect(screen.getByTestId("clip-viewer-missing")).toHaveTextContent(VIEWER_COPY.missingSay);
    expect(screen.getByTestId("clip-viewer-missing")).toHaveTextContent(VIEWER_COPY.missingNext);
    expect(within(viewer()).getByTestId("read-aloud-button")).toBeInTheDocument();
  });

  it("says the clip is gone when its file cannot be read", async () => {
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true } });
    vi.mocked(fake.service.library.file).mockRejectedValueOnce(new Error("NotReadableError"));
    await openClip(record, { fake });
    expect(screen.getByTestId("clip-viewer-missing")).toBeInTheDocument();
  });

  it("shows the sticky note for a clip that lives only in memory (a private window)", async () => {
    const record = makeRecord({ id: "m1", storage: "memory" });
    await openClip(record);
    const note = screen.getByTestId("clip-viewer-memory-note");
    expect(note).toHaveTextContent(MEMORY_NOTE.computer);
    expect(note.className).toContain("sticky");
  });
});

describe("ClipViewer: Share (plan 12)", () => {
  it("calls service.share synchronously in the tap, with a file named for the device", async () => {
    const record = makeRecord({ id: "c1", gameId: "snake" });
    const { fake } = await openClip(record);
    const share = action("share");
    expect(share).not.toBeDisabled();
    fireEvent.click(share);
    // No await between the tap and the call: the share sheet needs the user activation.
    expect(fake.service.share).toHaveBeenCalledTimes(1);
    const file = vi.mocked(fake.service.share).mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("hankshits-snake-20260928-1200.mp4");
    expect(file.type).toBe("video/mp4");
    await flush();
    expect(screen.getByTestId("clip-viewer-status")).toHaveTextContent("Shared!");
  });

  it("waits for the file before Share can be tapped", async () => {
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true } });
    let release: (file: File) => void = () => {};
    vi.mocked(fake.service.library.file).mockImplementationOnce(() => new Promise<File>((resolve) => (release = resolve)));
    await openClip(record, { fake });
    expect(action("share")).toBeDisabled();
    expect(viewer()).toHaveTextContent(VIEWER_COPY.loading);
    await act(async () => release(new File(["x"], "c1.bin", { type: "video/mp4" })));
    await flush();
    expect(action("share")).not.toBeDisabled();
  });

  const OUTCOMES: ShareOutcome["kind"][] = ["shared", "cancelled", "retry", "ignored", "fallback-save", "blocked", "unsupported"];

  it.each(OUTCOMES)("replies to the %s outcome the plan 12 way", async (kind) => {
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true } });
    fake.setShareOutcome({ kind } as ShareOutcome);
    await openClip(record, { fake });
    fireEvent.click(action("share"));
    await flush();
    const expected = shareReply(kind, "computer");
    expect(screen.getByTestId("clip-viewer-status").textContent).toBe(expected ?? "");
    if (kind === "ignored") expect(screen.getByTestId("clip-viewer-status").textContent).toBe("");
    if (kind === "retry") expect(action("share")).not.toBeDisabled();
  });

  it("highlights the Save button after the share type is rejected", async () => {
    setUserAgent(ANDROID_UA);
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true } });
    fake.setShareOutcome({ kind: "fallback-save" });
    await openClip(record, { fake });
    expect(action("save").className).not.toContain("btn-primary");
    fireEvent.click(action("share"));
    await flush();
    expect(screen.getByTestId("clip-viewer-status")).toHaveTextContent(`Tap ${SAVE_LABELS.phone}.`);
    expect(action("save").className).toContain("btn-primary");
  });

  it("gives a kid-word reply when share throws", async () => {
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true } });
    vi.mocked(fake.service.share).mockRejectedValueOnce(new Error("boom"));
    await openClip(record, { fake });
    fireEvent.click(action("share"));
    await flush();
    expect(screen.getByTestId("clip-viewer-status")).toHaveTextContent(shareReply("unsupported", "computer")!);
  });
});

describe("ClipViewer: Save per platform (plan 12)", () => {
  it("puts Save to computer first on a computer and copies the file to the device", async () => {
    const record = makeRecord({ id: "c1" });
    const { fake } = await openClip(record);
    const buttons = Array.from(viewer().querySelectorAll("[data-action]")).map((button) => button.getAttribute("data-action"));
    expect(buttons.slice(0, 2)).toEqual(["save", "share"]);
    expect(action("save")).toHaveTextContent(SAVE_LABELS.computer);
    expect(action("save").className).toContain("btn-primary");
    fireEvent.click(action("save"));
    expect(fake.service.saveToDevice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fake.service.saveToDevice).mock.calls[0][0].name).toBe("hankshits-snake-20260928-1200.mp4");
    await flush();
    expect(screen.getByTestId("clip-viewer-status")).toHaveTextContent(saveReply({ kind: "saved" }, "computer"));
  });

  it("says Save to phone on Android, with Share first", async () => {
    setUserAgent(ANDROID_UA);
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true } });
    fake.setSaveOutcome({ kind: "failed", reason: "blocked" });
    await openClip(record, { fake });
    const buttons = Array.from(viewer().querySelectorAll("[data-action]")).map((button) => button.getAttribute("data-action"));
    expect(buttons.slice(0, 2)).toEqual(["share", "save"]);
    expect(action("save")).toHaveTextContent(SAVE_LABELS.phone);
    fireEvent.click(action("save"));
    await flush();
    expect(screen.getByTestId("clip-viewer-status")).toHaveTextContent(saveReply({ kind: "failed", reason: "blocked" }, "phone"));
  });

  it("uses the share sheet for Save to Photos on an iPhone, with the Save Video picture for the first shares", async () => {
    setUserAgent(IPHONE_UA);
    const record = makeRecord({ id: "c1" });
    const { fake } = await openClip(record);
    expect(action("save")).toHaveTextContent(SAVE_LABELS.photos);
    const coach = screen.getByTestId("clip-viewer-coach");
    expect(coach).toHaveTextContent(VIEWER_COPY.photosCoach);
    expect(coach.querySelector('[data-glyph="save"]')).not.toBeNull();
    fireEvent.click(action("save"));
    expect(fake.service.share).toHaveBeenCalledTimes(1);
    expect(fake.service.saveToDevice).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY)!).sharesCoached).toBe(1);
  });

  it("stops the iPhone coaching after three shares", async () => {
    setUserAgent(IPHONE_UA);
    window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ manualClips: 0, holdTipShown: false, sharesCoached: 3 }));
    await openClip(makeRecord({ id: "c1" }));
    expect(screen.queryByTestId("clip-viewer-coach")).toBeNull();
  });

  it("never offers Save to Photos off Apple devices", async () => {
    await openClip(makeRecord({ id: "c1" }));
    expect(viewer()).not.toHaveTextContent(SAVE_LABELS.photos);
    expect(screen.queryByTestId("clip-viewer-coach")).toBeNull();
  });
});

describe("ClipViewer: Keep and Delete", () => {
  it("toggles Keep and Kept as a filled control", async () => {
    const record = makeRecord({ id: "c1", kept: false });
    const { fake } = await openClip(record);
    const keep = action("keep");
    expect(keep).toHaveTextContent(VIEWER_COPY.keep);
    expect(keep.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(keep);
    expect(action("keep")).toHaveTextContent(VIEWER_COPY.kept);
    expect(action("keep").getAttribute("aria-pressed")).toBe("true");
    expect(action("keep").querySelector('[data-glyph="keep"]')!.getAttribute("data-filled")).toBe("true");
    expect(fake.service.library.setKept).toHaveBeenCalledWith("c1", true);
    await flush();
    expect(fake.records[0].kept).toBe(true);
  });

  it("puts Keep back when the library refuses", async () => {
    const record = makeRecord({ id: "c1", kept: false });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: true } });
    vi.mocked(fake.service.library.setKept).mockRejectedValueOnce(new Error("locked"));
    await openClip(record, { fake });
    fireEvent.click(action("keep"));
    await flush();
    expect(action("keep")).toHaveTextContent(VIEWER_COPY.keep);
  });

  it("asks before it deletes, and No goes back", async () => {
    const record = makeRecord({ id: "c1", kind: "record" });
    const { fake } = await openClip(record);
    fireEvent.click(action("delete"));
    expect(screen.getByTestId("clip-viewer-confirm")).toHaveTextContent(DELETE_QUESTIONS.record);
    expect(fake.service.library.remove).not.toHaveBeenCalled();
    fireEvent.click(action("delete-no"));
    expect(screen.queryByTestId("clip-viewer-confirm")).toBeNull();
    expect(fake.records).toHaveLength(1);
  });

  it("deletes after Yes and closes", async () => {
    const record = makeRecord({ id: "c1" });
    const { fake } = await openClip(record);
    fireEvent.click(action("delete"));
    fireEvent.click(action("delete-yes"));
    await flush();
    expect(fake.service.library.remove).toHaveBeenCalledWith("c1");
    expect(fake.records).toHaveLength(0);
    expect(screen.queryByTestId("clip-viewer")).toBeNull();
  });
});

describe("ClipViewer: My clips from this game", () => {
  it("lists this game's clips newest first as tiles, opens one, and comes back to the list", async () => {
    installSpeechMock();
    const older = makeRecord({ id: "a", gameId: "snake", createdAt: 1, watched: true, kept: true });
    const newer = makeRecord({ id: "b", gameId: "snake", createdAt: 2 });
    const other = makeRecord({ id: "c", gameId: "tetris", createdAt: 3 });
    const fake = createFakeClipService({ records: [older, newer, other], snapshot: { atBreak: true } });
    renderWithClips(<Open target={{ kind: "game", gameId: "snake" }} />, { fake });
    fireEvent.click(screen.getByTestId("open-viewer"));
    await flush();

    expect(screen.getByRole("dialog", { name: VIEWER_COPY.gameListTitle })).toBeInTheDocument();
    const tiles = screen.getAllByTestId("clip-tile");
    expect(tiles.map((tile) => tile.getAttribute("data-clip-id"))).toEqual(["b", "a"]);
    expect(within(tiles[0]).getByText(VIEWER_COPY.newMark)).toBeInTheDocument();
    expect(within(tiles[1]).queryByText(VIEWER_COPY.newMark)).toBeNull();
    expect(tiles[1].querySelector('[data-glyph="keep"]')).not.toBeNull();

    fireEvent.click(tiles[1]);
    await flush();
    expect(screen.getByRole("dialog", { name: VIEWER_TITLES.clip })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: VIEWER_COPY.backToList }));
    expect(screen.getByRole("dialog", { name: VIEWER_COPY.gameListTitle })).toBeInTheDocument();

    // Deleting a clip opened from the list goes back to the list.
    fireEvent.click(screen.getAllByTestId("clip-tile")[0]);
    await flush();
    fireEvent.click(action("delete"));
    fireEvent.click(action("delete-yes"));
    await flush();
    expect(screen.getByRole("dialog", { name: VIEWER_COPY.gameListTitle })).toBeInTheDocument();
    expect(screen.getAllByTestId("clip-tile").map((tile) => tile.getAttribute("data-clip-id"))).toEqual(["a"]);
  });

  it("shows the empty state with read-aloud", async () => {
    installSpeechMock();
    const fake = createFakeClipService({ records: [], snapshot: { atBreak: true } });
    renderWithClips(<Open target={{ kind: "game", gameId: "snake" }} />, { fake });
    fireEvent.click(screen.getByTestId("open-viewer"));
    await flush();
    expect(screen.getByTestId("clip-viewer-empty")).toHaveTextContent(VIEWER_COPY.gameListEmptySay);
    expect(screen.getByTestId("clip-viewer-empty")).toHaveTextContent(VIEWER_COPY.gameListEmptyNext);
    expect(within(viewer()).getByTestId("read-aloud-button")).toBeInTheDocument();
  });
});

describe("ClipViewer: pause before open (plan 11.1, 12)", () => {
  it("pauses a game that can pause before the viewer is on screen", async () => {
    const record = makeRecord({ id: "c1" });
    const fake = createFakeClipService({ records: [record], snapshot: { atBreak: false, gameCanPause: true } });
    const view = renderWithClips(<Open target={{ kind: "clip", id: "c1" }} />, { fake });
    const seen: boolean[] = [];
    view.pauseGame.mockImplementation(() => {
      seen.push(screen.queryByTestId("clip-viewer") !== null);
      fake.set({ atBreak: true });
    });
    fireEvent.click(screen.getByTestId("open-viewer"));
    await flush();
    expect(seen).toEqual([false]);
    expect(screen.getByTestId("clip-viewer")).toBeInTheDocument();
    // Closing the viewer leaves the game paused: the kid resumes from the pause menu.
    fireEvent.click(within(viewer()).getByRole("button", { name: VIEWER_COPY.close }));
    expect(view.resumeGame).not.toHaveBeenCalled();
  });
});
