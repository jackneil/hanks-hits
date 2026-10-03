import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { SECONDARY_ACTION } from "@/shared/components/buttonStyles";

import { publishSessionUser, resetSessionBusForTests } from "../../service/registry";
import type { ClipActionResult } from "../../service/contract";
import { DEFAULT_CLIP_SECONDS } from "../../service/contract";
import { ClipsPauseEntry } from "../ClipsPauseEntry";
import { useClipUi } from "../uiContext";
import { MENU_COPY, PAUSE_ENTRY_LABEL, REASON_COPY, SETTINGS_COPY, VIEWER_COPY } from "../copy";
import { CLIP_SHEET_Z_INDEX } from "../Sheet";
import type { MenuSource } from "../uiStore";
import { createFakeClipService, makeRecord } from "./fakeClipService";
import { flush, renderWithClips, stubObjectUrls } from "./renderClips";

afterEach(() => {
  removeSpeechMock();
  resetSessionBusForTests();
});

/** Opens the menu with no press token (the pause menu and the result chip do this). */
function OpenMenu({ source = "pointer" }: { source?: MenuSource }) {
  const ui = useClipUi();
  return (
    <button type="button" data-testid="open-menu" onClick={() => ui?.openMenu(null, source)}>
      open
    </button>
  );
}

function menu() {
  return screen.getByRole("dialog", { name: MENU_COPY.title });
}

function rows() {
  return Array.from(menu().querySelectorAll("[data-row]")).map((row) => row.getAttribute("data-row"));
}

describe("CaptureMenu (plan 11.4)", () => {
  it("lists the five rows in order, portaled at z-2500, with read-aloud", () => {
    installSpeechMock();
    renderWithClips(<OpenMenu />);
    fireEvent.click(screen.getByTestId("open-menu"));
    expect(rows()).toEqual(["clipLast", "record", "picture", "myClips", "settings"]);
    expect(within(menu()).getByRole("button", { name: MENU_COPY.clipLast })).toBeInTheDocument();
    const sheet = screen.getByTestId("capture-menu");
    expect(sheet.parentElement).toBe(document.body);
    expect(sheet.className).toContain(`z-[${CLIP_SHEET_Z_INDEX}]`);
    expect(within(menu()).getByTestId("read-aloud-button")).toBeInTheDocument();
    for (const row of menu().querySelectorAll("[data-row]")) {
      expect(row.className).toMatch(/(^|\s)min-h-14(\s|$)/);
    }
  });

  it("gives every row after the first a visible edge (3:1 on the sheet), not white on white", () => {
    renderWithClips(<OpenMenu />);
    fireEvent.click(screen.getByTestId("open-menu"));
    const [first, ...rest] = Array.from(menu().querySelectorAll("[data-row]"));
    expect(first.className.split(/\s+/)).toContain("btn-primary");
    expect(rest).toHaveLength(4);
    for (const row of rest) {
      expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(SECONDARY_ACTION.split(" ")));
      expect(row.className).not.toContain("border-base-300");
    }
  });

  it("reads the title, the rows and the close button out loud, in screen order", () => {
    const speech = installSpeechMock();
    renderWithClips(<OpenMenu />);
    fireEvent.click(screen.getByTestId("open-menu"));
    fireEvent.click(within(menu()).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text).toBe(
      [MENU_COPY.title, "Prepare a gameplay video, watch it, then choose Publish video. Nothing is published automatically", "Preview last 30 seconds to publish", MENU_COPY.clipLast, MENU_COPY.record, MENU_COPY.picture, MENU_COPY.myClips, MENU_COPY.settings, MENU_COPY.close].join(
        ". ",
      ),
    );
  });

  it('clips with the press token from the hold ("Clip the last 30 seconds")', async () => {
    // The clip button's hold: beginPress gives the token, endPress answers "menu".
    const fake = createFakeClipService();
    const token = fake.service.beginPress()!;
    expect(fake.service.endPress(token, { upAtMs: token.downAtMs + 600, moved: false })).toEqual({ kind: "menu" });
    renderWithClips(<MenuWithToken token={token} />, { fake });
    fireEvent.click(screen.getByTestId("open-with-token"));
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.clipLast }));
    await flush();
    expect(fake.service.clipLast).toHaveBeenCalledWith(DEFAULT_CLIP_SECONDS, token);
    expect(fake.records).toHaveLength(1);
    expect(screen.queryByTestId("capture-menu")).toBeNull();
  });

  it("puts Turn the clip button back on first while resting, and wakes the button", async () => {
    const { fake } = renderWithClips(<OpenMenu />, { snapshot: { button: "resting" } });
    fireEvent.click(screen.getByTestId("open-menu"));
    expect(rows()[0]).toBe("wake");
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.wake }));
    expect(fake.service.wake).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("capture-menu")).toBeNull();
  });

  it("shows only Record and Take a picture, with the reason, in the record-only state", () => {
    renderWithClips(<OpenMenu />, { snapshot: { button: "record-only" } });
    fireEvent.click(screen.getByTestId("open-menu"));
    expect(rows()).toEqual(["record", "picture"]);
    expect(screen.getByTestId("capture-menu-reason")).toHaveTextContent(
      `${REASON_COPY["record-only"].say} ${REASON_COPY["record-only"].next}`,
    );
  });

  it("offers no capture rows when the crash breaker turned clips off", () => {
    renderWithClips(<OpenMenu />, { snapshot: { button: "disabled" } });
    fireEvent.click(screen.getByTestId("open-menu"));
    expect(rows()).toEqual(["myClips", "settings"]);
    expect(screen.getByTestId("capture-menu-reason")).toHaveTextContent(REASON_COPY.breaker.say);
  });

  it("shows Stop the video while a video records", async () => {
    const { fake } = renderWithClips(<OpenMenu />, {
      snapshot: { button: "recording", engine: "recording", recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 1, stars: 0 } },
    });
    fireEvent.click(screen.getByTestId("open-menu"));
    expect(rows()).toContain("stop");
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.stopRecording }));
    await flush();
    expect(fake.service.stopRecording).toHaveBeenCalledTimes(1);
  });

  it("starts a video and takes a picture from the rows", async () => {
    const { fake } = renderWithClips(<OpenMenu />);
    fireEvent.click(screen.getByTestId("open-menu"));
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.record }));
    await flush();
    expect(fake.service.startRecording).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("open-menu"));
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.picture }));
    await flush();
    expect(fake.service.takePicture).toHaveBeenCalledTimes(1);
    expect(fake.records.map((record) => record.kind)).toEqual(["picture"]);
  });

  it('says "Back to the game" on its close control only when closing gives play back', () => {
    const speech = installSpeechMock();
    const { resumeGame } = renderWithClips(<OpenMenu />);
    // Opened by a hold during play: the menu paused the game, and closing resumes it.
    fireEvent.click(screen.getByTestId("open-menu"));
    const close = within(menu()).getByRole("button", { name: MENU_COPY.close });
    fireEvent.click(within(menu()).getByTestId("read-aloud-button"));
    expect(speech.lastUtterance().text.endsWith(`. ${MENU_COPY.close}`)).toBe(true);
    fireEvent.click(close);
    expect(resumeGame).toHaveBeenCalledTimes(1);
  });

  it('says "Back" on its close control when it opened at a break (the pause menu), and closing keeps the pause', () => {
    const speech = installSpeechMock();
    const { resumeGame } = renderWithClips(<OpenMenu source="pause-menu" />, { snapshot: { atBreak: true } });
    fireEvent.click(screen.getByTestId("open-menu"));
    expect(within(menu()).queryByRole("button", { name: MENU_COPY.close })).toBeNull();
    const back = within(menu()).getByRole("button", { name: MENU_COPY.back });
    fireEvent.click(within(menu()).getByTestId("read-aloud-button"));
    const spoken = speech.lastUtterance().text;
    expect(spoken.endsWith(`. ${MENU_COPY.back}`)).toBe(true);
    expect(spoken).not.toContain(MENU_COPY.close);
    fireEvent.click(back);
    expect(screen.queryByTestId("capture-menu")).toBeNull();
    expect(resumeGame).not.toHaveBeenCalled();
  });

  it("pauses the game when it opens during play, and resumes after a quick action", async () => {
    const { fake, pauseGame, resumeGame } = renderWithClips(<OpenMenu />);
    fireEvent.click(screen.getByTestId("open-menu"));
    expect(pauseGame).toHaveBeenCalledTimes(1);
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.clipLast }));
    await flush();
    expect(resumeGame).toHaveBeenCalledTimes(1);
    expect(fake.records).toHaveLength(1);
  });

  it("does not pause or resume when it opens at a break (the pause menu)", () => {
    const { pauseGame, resumeGame } = renderWithClips(<OpenMenu source="pause-menu" />, { snapshot: { atBreak: true } });
    fireEvent.click(screen.getByTestId("open-menu"));
    // At a break the close control goes back to the break: "Back".
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.back }));
    expect(pauseGame).not.toHaveBeenCalled();
    expect(resumeGame).not.toHaveBeenCalled();
  });

  it("opens My clips from this game and Clip settings in place, keeping the pause", async () => {
    stubObjectUrls();
    installSpeechMock();
    const { resumeGame } = renderWithClips(<OpenMenu />);
    fireEvent.click(screen.getByTestId("open-menu"));
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.myClips }));
    await flush();
    expect(screen.getByRole("dialog", { name: VIEWER_COPY.gameListTitle })).toBeInTheDocument();
    expect(screen.getByTestId("clip-viewer-empty")).toHaveTextContent(VIEWER_COPY.gameListEmptySay);
    expect(within(screen.getByTestId("clip-viewer")).getByTestId("read-aloud-button")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: VIEWER_COPY.close }));
    expect(resumeGame).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("open-menu"));
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.settings }));
    await flush();
    expect(screen.getByRole("dialog", { name: SETTINGS_COPY.title })).toBeInTheDocument();
    expect(screen.getByTestId("clip-settings-storage")).toHaveTextContent("You have no clips on this device yet.");
  });

  it("closes on Escape without letting the key reach the game shell", () => {
    const shell = vi.fn();
    window.addEventListener("keydown", shell);
    try {
      renderWithClips(<OpenMenu />);
      fireEvent.click(screen.getByTestId("open-menu"));
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      });
      expect(screen.queryByTestId("capture-menu")).toBeNull();
      expect(shell).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", shell);
    }
  });

  it("closes on a tap outside, and keeps taps inside from reaching the page", () => {
    const pageTap = vi.fn();
    renderWithClips(
      <div onPointerDown={pageTap} onClick={pageTap}>
        <OpenMenu />
      </div>,
    );
    fireEvent.click(screen.getByTestId("open-menu"));
    pageTap.mockClear();
    fireEvent.pointerDown(within(menu()).getByRole("button", { name: MENU_COPY.picture }));
    expect(pageTap).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByTestId("clip-sheet-backdrop"));
    fireEvent.click(screen.getByTestId("clip-sheet-backdrop"));
    expect(screen.queryByTestId("capture-menu")).toBeNull();
    expect(pageTap).not.toHaveBeenCalled();
  });

  it("keeps a press on the sheet from the game, and lets a press from the game end over the sheet", () => {
    const heard: string[] = [];
    const listener = (event: Event) => heard.push(event.type);
    for (const type of ["pointerup", "mouseup", "pointercancel"]) window.addEventListener(type, listener);
    try {
      renderWithClips(
        <>
          <div data-testid="game" />
          <OpenMenu />
        </>,
      );
      fireEvent.click(screen.getByTestId("open-menu"));
      const row = within(menu()).getByRole("button", { name: MENU_COPY.settings });
      // A press on a row stays with the sheet (no click: the row does not act).
      fireEvent.pointerDown(row, { pointerId: 2, pointerType: "touch" });
      fireEvent.mouseDown(row);
      fireEvent.pointerUp(row, { pointerId: 2, pointerType: "touch" });
      fireEvent.mouseUp(row);
      expect(heard).toEqual([]);
      // A finger that went down on the game before the sheet opened lifts over it.
      fireEvent.pointerDown(screen.getByTestId("game"), { pointerId: 5, pointerType: "touch" });
      fireEvent.pointerUp(row, { pointerId: 5, pointerType: "touch" });
      fireEvent.pointerDown(screen.getByTestId("game"), { pointerId: 6, pointerType: "touch" });
      fireEvent.pointerCancel(row, { pointerId: 6, pointerType: "touch" });
      fireEvent.mouseUp(row);
      expect(heard).toEqual(["pointerup", "pointercancel", "mouseup"]);
      expect(screen.getByTestId("capture-menu")).toBeInTheDocument();
    } finally {
      for (const type of ["pointerup", "mouseup", "pointercancel"]) window.removeEventListener(type, listener);
    }
  });

  it("stays open when the hold's own release lands on the backdrop", () => {
    renderWithClips(<OpenMenu />);
    fireEvent.click(screen.getByTestId("open-menu"));
    // The finger that held the clip button lets go over the new backdrop:
    // a click with no press on the backdrop first.
    fireEvent.click(screen.getByTestId("clip-sheet-backdrop"));
    expect(screen.getByTestId("capture-menu")).toBeInTheDocument();
  });

  it("focuses the first row, and gives focus back when it closes", () => {
    renderWithClips(<OpenMenu />);
    const opener = screen.getByTestId("open-menu");
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(within(menu()).getByRole("button", { name: MENU_COPY.clipLast }));
    fireEvent.click(within(menu()).getByRole("button", { name: MENU_COPY.close }));
    expect(document.activeElement).toBe(opener);
  });
});

/** Opens the menu with a given token, the way a hold does. */
function MenuWithToken({ token }: { token: import("../../service/contract").PressToken }) {
  const ui = useClipUi();
  return (
    <button type="button" data-testid="open-with-token" onClick={() => ui?.openMenu(token, "pointer")}>
      open
    </button>
  );
}

describe("ClipsPauseEntry (plan 11.4)", () => {
  it("is a visible Clips button that opens the Capture menu above the pause menu", () => {
    renderWithClips(<ClipsPauseEntry />, { snapshot: { atBreak: true } });
    const entry = screen.getByRole("button", { name: PAUSE_ENTRY_LABEL });
    // The header button's own picture pairs with the word (ClipWords.test.tsx).
    expect(entry.querySelector('[data-glyph="clip-button"]')).not.toBeNull();
    expect(entry.className).toContain("btn-lg");
    fireEvent.click(entry);
    expect(screen.getByRole("dialog", { name: MENU_COPY.title })).toBeInTheDocument();
  });

  // The pause menu reads the entry's visible label out loud
  // (shell/__tests__/GameShellClipUi.test.tsx).

  it("renders nothing when clips are off for the game", () => {
    renderWithClips(<ClipsPauseEntry />, { snapshot: { button: "hidden" } });
    expect(screen.queryByTestId("clips-pause-entry")).toBeNull();
  });
});


describe("publish preparation lifetime", () => {
  it.each(["close", "owner"])("does not reopen a finished preparation after %s", async (change) => {
    publishSessionUser("a");
    const fake = createFakeClipService();
    let finish!: (result: ClipActionResult) => void;
    vi.mocked(fake.service.clipLast).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderWithClips(<OpenMenu />, { fake });
    fireEvent.click(screen.getByTestId("open-menu"));
    fireEvent.click(screen.getByRole("button", { name: "Preview last 30 seconds to publish" }));
    if (change === "close") fireEvent.click(screen.getByRole("button", { name: MENU_COPY.close }));
    else act(() => publishSessionUser("b"));
    await act(async () => finish({ ok: true, action: "clip", record: makeRecord(), atMs: 1 }));
    expect(screen.queryByTestId("clip-viewer")).not.toBeInTheDocument();
  });
  it("turns a thrown preparation error into a retryable explanation", async () => {
    const fake = createFakeClipService();
    vi.mocked(fake.service.clipLast).mockRejectedValue(new Error("capture failed"));
    renderWithClips(<OpenMenu />, { fake });
    fireEvent.click(screen.getByTestId("open-menu"));
    fireEvent.click(screen.getByRole("button", { name: "Preview last 30 seconds to publish" }));
    expect(await screen.findByText(/The video could not be prepared/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview last 30 seconds to publish" })).toBeEnabled();
  });
});
