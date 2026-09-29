/**
 * "Clip button" always comes with a picture of the clip button (plan 11.6,
 * decision 11): the header draws the button as a clapperboard in a ring,
 * the only control there that is not a color emoji, so a pre-reader who
 * hears "tap the clip button" sees which control that is.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

import { ClipButton } from "../ClipButton";
import { ClipButtonPicture, ClipWords, namesClipButton } from "../ClipWords";
import { ClipSettingsSheet } from "../ClipSettingsSheet";
import { ClipsPauseEntry } from "../ClipsPauseEntry";
import { allCopyStrings, PAUSE_ENTRY_LABEL, reasonText, SETTINGS_COPY, TOAST_COPY, VIEWER_COPY } from "../copy";
import { ToastSlot } from "../ToastSlot";
import { useClipUi } from "../uiContext";
import { HOLD_TIP_AFTER_CLIPS } from "../uiStore";
import { flush, renderWithClips, stubObjectUrls } from "./renderClips";

beforeEach(() => {
  stubObjectUrls();
  window.localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: vi.fn() });
});

afterEach(() => {
  removeSpeechMock();
  // @ts-expect-error - remove the stub again
  delete HTMLElement.prototype.animate;
});

function pictures(root: ParentNode = document.body): Element[] {
  return Array.from(root.querySelectorAll('[data-glyph="clip-button"]'));
}

function Controls() {
  const ui = useClipUi();
  return (
    <>
      <button type="button" data-testid="reply-warming" onClick={() => ui?.store.showReply(reasonText("warming"), true)}>
        a
      </button>
      <button type="button" data-testid="reply-made" onClick={() => ui?.store.showReply("Clip made!", false)}>
        b
      </button>
      <button type="button" data-testid="note-clip" onClick={() => ui?.store.noteManualClip()}>
        c
      </button>
      <button type="button" data-testid="open-list" onClick={() => ui?.openViewer({ kind: "game", gameId: "snake" })}>
        d
      </button>
    </>
  );
}

describe("ClipWords", () => {
  it("puts the picture right after the first 'clip button', and keeps the words as they are", () => {
    const text = reasonText("resting");
    const { container } = render(
      <p>
        <ClipWords text={text} />
      </p>,
    );
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(text);
    expect(pictures(container)).toHaveLength(1);
    const picture = pictures(container)[0];
    expect(picture.getAttribute("aria-hidden")).toBe("true");
    // Beside the words "clip button".
    expect(picture.parentElement?.textContent?.trim()).toBe("clip button");
  });

  it("adds no picture to words that do not name the clip button", () => {
    const { container } = render(<ClipWords text="Clip made!" />);
    expect(pictures(container)).toHaveLength(0);
    expect(container.textContent).toBe("Clip made!");
  });

  it("draws the header button's own clapperboard, not an emoji", () => {
    renderWithClips(<ClipButton />);
    // The button face is an svg; the clapperboard is the svg inside it.
    const header = screen.getByTestId("clip-button").querySelector('svg svg[data-glyph="clip"]')!;
    const { container } = render(<ClipButtonPicture />);
    const small = container.querySelector('[data-glyph="clip-button"] [data-glyph="clip"]')!;
    expect(small.innerHTML).toBe(header.innerHTML);
    expect(container.textContent).toBe("");
  });

  it("finds the phrase in the real copy table (a control)", () => {
    const naming = allCopyStrings().filter(namesClipButton);
    expect(naming).toContain(reasonText("warming"));
    expect(naming).toContain(TOAST_COPY.holdTip);
    expect(naming).toContain(VIEWER_COPY.gameListEmptyNext);
    expect(naming).toContain(SETTINGS_COPY.tapTip);
  });
});

describe("every clip surface that says 'clip button' shows it", () => {
  it("a tap reply (warming) shows the picture; a reply that does not name it shows none", () => {
    renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    fireEvent.click(screen.getByTestId("reply-warming"));
    const reply = screen.getByTestId("clip-reply");
    expect(reply).toHaveTextContent("Then tap the clip button again.");
    expect(pictures(reply)).toHaveLength(1);
    // The live region stays words only.
    expect(pictures(screen.getByTestId("clip-toast-announcer"))).toHaveLength(0);
    fireEvent.click(screen.getByTestId("reply-made"));
    expect(pictures(screen.getByTestId("clip-reply"))).toHaveLength(0);
  });

  it("the hold tip shows the picture", () => {
    const { fake } = renderWithClips(
      <>
        <ToastSlot />
        <Controls />
      </>,
    );
    for (let i = 0; i < HOLD_TIP_AFTER_CLIPS; i++) fireEvent.click(screen.getByTestId("note-clip"));
    act(() => fake.set({ atBreak: true }));
    expect(pictures(screen.getByTestId("clip-hold-tip"))).toHaveLength(1);
  });

  it("the empty clip list shows the picture beside 'Tap the clip button while you play!'", async () => {
    renderWithClips(<Controls />, { records: [], snapshot: { atBreak: true } });
    fireEvent.click(screen.getByTestId("open-list"));
    await flush();
    const empty = screen.getByTestId("clip-viewer-empty");
    expect(empty).toHaveTextContent(VIEWER_COPY.gameListEmptyNext);
    expect(pictures(empty)).toHaveLength(1);
  });

  it("the settings tips that name the clip button show the picture", async () => {
    renderWithClips(<ClipSettingsSheet onClose={() => {}} />, { snapshot: { atBreak: true } });
    await flush();
    const sheet = screen.getByTestId("clip-settings");
    for (const tip of [SETTINGS_COPY.tapTip, SETTINGS_COPY.holdTip]) {
      const item = within(sheet).getByText((_, el) => el?.tagName === "LI" && el.textContent?.replace(/\s+/g, " ").trim() === tip);
      expect(pictures(item)).toHaveLength(1);
    }
  });

  it("the pause menu's Clips entry uses the clip button's picture, not the 🎬 emoji", () => {
    installSpeechMock();
    renderWithClips(<ClipsPauseEntry />, { snapshot: { atBreak: true } });
    const entry = screen.getByRole("button", { name: PAUSE_ENTRY_LABEL });
    expect(entry.textContent).not.toContain("🎬");
    expect(pictures(entry)).toHaveLength(1);
  });
});
