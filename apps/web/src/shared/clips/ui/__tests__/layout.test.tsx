/**
 * Layout checks at 390x844 (a common phone) and 320x568 (the smallest
 * phone we support). jsdom draws nothing, so these checks read what the
 * markup declares: no element asks for a phone-size width wider than the
 * screen, every row the toast planner builds fits, and the sheets scroll
 * inside instead of running off the screen. The real pixels are checked
 * later in a browser.
 */

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

import { useClipUi } from "../ClipUiProvider";
import {
  CHIP_FULL_WIDTH_PX,
  CHIP_ICON_WIDTH_PX,
  planToastSlot,
  RECORD_PILL_WIDTH_PX,
  STAR_WIDTH_PX,
  TOAST_GAP_PX,
  TOAST_SLOT_PAD_PX,
  ToastSlot,
} from "../ToastSlot";
import { makeRecord } from "./fakeClipService";
import { flush, renderWithClips, stubObjectUrls } from "./renderClips";

const VIEWPORTS: Array<[number, number]> = [
  [390, 844],
  [320, 568],
];

const REAL_WIDTH = window.innerWidth;
const REAL_HEIGHT = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

/** Widths an element asks for on a phone (classes without a breakpoint prefix, and inline styles). */
function declaredWidthsPx(element: Element): number[] {
  const out: number[] = [];
  for (const token of (element.getAttribute("class") ?? "").split(/\s+/)) {
    if (!token || token.includes(":")) continue; // sm:, md:, @min-...: not the phone layout
    const scale = /^(?:min-)?w-(\d+(?:\.\d+)?)$/.exec(token);
    if (scale) out.push(Number(scale[1]) * 4);
    const arbitrary = /^(?:min-)?w-\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(token);
    if (arbitrary) out.push(Number(arbitrary[1]) * (arbitrary[2] === "rem" ? 16 : 1));
  }
  const style = (element as HTMLElement).style;
  for (const value of [style?.width, style?.minWidth]) {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(value ?? "");
    if (px) out.push(Number(px[1]));
  }
  return out;
}

function widestDeclared(root: ParentNode): { width: number; element: Element | null } {
  let widest = { width: 0, element: null as Element | null };
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const width of declaredWidthsPx(element)) {
      if (width > widest.width) widest = { width, element };
    }
  }
  return widest;
}

function OpenSheets() {
  const ui = useClipUi();
  return (
    <>
      <button type="button" data-testid="open-menu" onClick={() => ui?.openMenu(null, "pointer")}>
        m
      </button>
      <button type="button" data-testid="open-viewer" onClick={() => ui?.openViewer({ kind: "clip", id: "c1" })}>
        v
      </button>
      <button type="button" data-testid="open-list" onClick={() => ui?.openViewer({ kind: "game", gameId: "snake" })}>
        l
      </button>
      <button type="button" data-testid="reply" onClick={() => ui?.store.showReply("A very long reply that has to wrap on a small phone screen so nothing runs off the edge.", true)}>
        r
      </button>
    </>
  );
}

beforeEach(() => {
  stubObjectUrls();
  installSpeechMock();
  // A browser with a share sheet, so the viewer shows every action.
  Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: vi.fn() });
});

afterEach(() => {
  removeSpeechMock();
  setViewport(REAL_WIDTH, REAL_HEIGHT);
  delete (navigator as { share?: unknown }).share;
});

describe.each(VIEWPORTS)("clip UI at %ix%i", (width, height) => {
  it("fits every toast slot row inside the screen", () => {
    for (const chip of [true, false]) {
      for (const recording of [true, false]) {
        const plan = planToastSlot(width, { chip, recording });
        expect(plan.available).toBe(width - 2 * TOAST_SLOT_PAD_PX);
        expect(plan.rowWidth).toBeLessThanOrEqual(plan.available);
        expect(plan.replyMaxWidth).toBeLessThanOrEqual(plan.available);
        // Phones this size keep the chip's words.
        if (chip) expect(plan.chip).toBe("full");
      }
    }
    const full = planToastSlot(width, { chip: true, recording: true });
    expect(full.rowWidth).toBe(RECORD_PILL_WIDTH_PX + TOAST_GAP_PX + STAR_WIDTH_PX + TOAST_GAP_PX + CHIP_FULL_WIDTH_PX);
  });

  it("renders the toast slot with nothing wider than the screen, and a reply that wraps", () => {
    setViewport(width, height);
    renderWithClips(
      <>
        <ToastSlot />
        <OpenSheets />
      </>,
      {
        records: [makeRecord({ id: "c1" })],
        snapshot: {
          unwatchedClipId: "c1",
          engine: "recording",
          recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 5999, stars: 12 },
        },
      },
    );
    fireEvent.click(screen.getByTestId("reply"));
    const slot = screen.getByTestId("clip-toast-slot");
    const row = screen.getByTestId("clip-toast-row");
    expect(parseFloat(row.style.maxWidth)).toBe(width - 2 * TOAST_SLOT_PAD_PX);
    const reply = screen.getByTestId("clip-reply");
    expect(parseFloat(reply.style.maxWidth)).toBeLessThanOrEqual(width - 2 * TOAST_SLOT_PAD_PX);
    expect(reply.querySelector("p")!.className).toContain("min-w-0");
    expect(reply.querySelector("p")!.className).not.toContain("whitespace-nowrap");
    const widest = widestDeclared(slot);
    expect(widest.width, widest.element?.outerHTML).toBeLessThanOrEqual(width - 2 * TOAST_SLOT_PAD_PX);
    // The longest timer ("99:59") still fits its pill.
    expect(screen.getByTestId("clip-record-pill")).toHaveTextContent("99:59");
  });

  it("keeps the Capture menu inside the screen, scrolling inside if it must", () => {
    setViewport(width, height);
    renderWithClips(<OpenSheets />);
    fireEvent.click(screen.getByTestId("open-menu"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("inset-x-0");
    expect(dialog.className).toContain("max-h-[90dvh]");
    expect(dialog.className).toContain("overflow-y-auto");
    const widest = widestDeclared(screen.getByTestId("capture-menu"));
    expect(widest.width, widest.element?.outerHTML).toBeLessThanOrEqual(width);
    // Row labels wrap instead of running off a 320 px screen.
    for (const row of Array.from(dialog.querySelectorAll("[data-row]"))) {
      expect(row.className).toContain("h-auto");
      expect(row.querySelector("span:last-child")!.className).toContain("whitespace-normal");
    }
  });

  it("fills a phone screen with the viewer, with full-width buttons that wrap", async () => {
    setViewport(width, height);
    renderWithClips(<OpenSheets />, { records: [makeRecord({ id: "c1", storage: "memory" })], snapshot: { atBreak: true } });
    fireEvent.click(screen.getByTestId("open-viewer"));
    await flush();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/(^|\s)inset-0(\s|$)/);
    expect(dialog.className).toContain("overflow-y-auto");
    const widest = widestDeclared(screen.getByTestId("clip-viewer"));
    expect(widest.width, widest.element?.outerHTML).toBeLessThanOrEqual(width);
    const actions = Array.from(dialog.querySelectorAll("[data-action]"));
    expect(actions.length).toBeGreaterThanOrEqual(4);
    for (const button of actions) {
      expect(button.className).toContain("w-full");
      expect(button.className).toContain("whitespace-normal");
      expect(button.className).toMatch(/(^|\s)min-h-14(\s|$)/);
    }
    // The video never pushes the buttons off a short screen.
    expect(screen.getByTestId("clip-viewer-video").className).toContain("max-h-[50dvh]");
  });

  it("lays the clip list out in two columns that shrink", async () => {
    setViewport(width, height);
    renderWithClips(<OpenSheets />, {
      records: [makeRecord({ id: "a" }), makeRecord({ id: "b" }), makeRecord({ id: "c" })],
      snapshot: { atBreak: true },
    });
    fireEvent.click(screen.getByTestId("open-list"));
    await flush();
    const list = screen.getByTestId("clip-viewer").querySelector("ul")!;
    expect(list.className).toContain("grid-cols-2");
    for (const item of Array.from(list.children)) expect(item.className).toContain("min-w-0");
    for (const tile of screen.getAllByTestId("clip-tile")) {
      expect(tile.className).toContain("w-full");
      expect(tile.className).toContain("min-w-0");
    }
  });
});

describe("toast slot beside a notch (844x390 landscape, plan 11.2)", () => {
  it("keeps every row inside the safe areas", () => {
    const insets = { left: 47, right: 47 };
    const plan = planToastSlot(844, { chip: true, recording: true }, insets);
    expect(plan.available).toBe(844 - 47 - 47);
    expect(plan.rowWidth).toBeLessThanOrEqual(plan.available);
    // A side with no inset still pads by the normal 12 px.
    expect(planToastSlot(390, { chip: true, recording: false }, { left: 0, right: 30 }).available).toBe(390 - TOAST_SLOT_PAD_PX - 30);
    // The CSS pads each side by the larger of 12 px and the inset, like the planner.
    renderWithClips(<ToastSlot />, { records: [makeRecord({ id: "c1" })], snapshot: { unwatchedClipId: "c1" } });
    const slot = screen.getByTestId("clip-toast-slot");
    expect(slot.className).toContain("pl-[max(0.75rem,env(safe-area-inset-left))]");
    expect(slot.className).toContain("pr-[max(0.75rem,env(safe-area-inset-right))]");
    expect(slot.className).not.toMatch(/(^|\s)px-3(\s|$)/);
  });
});

describe("toast slot below the smallest phone", () => {
  it("drops the chip's words before anything runs off the screen", () => {
    const plan = planToastSlot(280, { chip: true, recording: true });
    expect(plan.chip).toBe("icon");
    expect(plan.rowWidth).toBe(RECORD_PILL_WIDTH_PX + TOAST_GAP_PX + STAR_WIDTH_PX + TOAST_GAP_PX + CHIP_ICON_WIDTH_PX);
    expect(plan.rowWidth).toBeLessThanOrEqual(plan.available);
  });
});
