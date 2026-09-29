import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIRM_CHECK_MIN_REM, CONFIRM_MS, CONFIRM_TEXT_MIN_REM, InPlayConfirm } from "../InPlayConfirm";
import { RESULT_COPY } from "../copy";
import { createFakeClipService } from "./fakeClipService";
import { renderWithClips } from "./renderClips";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The header title region the integration mounts it in. */
function TitleRegion() {
  return (
    <div data-testid="title-region" className="relative flex-1 min-w-0">
      <span>Snake</span>
      <InPlayConfirm />
    </div>
  );
}

describe("InPlayConfirm (plan 11.1)", () => {
  it("shows a check mark and a small pill for 1.2 s after a clip, then goes", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
    await act(async () => {
      await fake.service.clipLast();
    });
    const confirm = screen.getByTestId("in-play-confirm");
    expect(confirm.querySelector('[data-glyph="check"]')).not.toBeNull();
    expect(screen.getByTestId("in-play-confirm-text")).toHaveTextContent(RESULT_COPY.clip);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_MS - 1);
    });
    expect(screen.getByTestId("in-play-confirm")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
  });

  it("uses the plan's words for each kind of result", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    await act(async () => {
      await fake.service.takePicture();
    });
    expect(screen.getByTestId("in-play-confirm-text")).toHaveTextContent(RESULT_COPY.picture);
    await act(async () => {
      await fake.service.startRecording();
      await fake.service.stopRecording();
    });
    expect(screen.getByTestId("in-play-confirm-text")).toHaveTextContent(RESULT_COPY.record);
  });

  it("stays in the title region, over no control, and takes no taps", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    await act(async () => {
      await fake.service.clipLast();
    });
    const confirm = screen.getByTestId("in-play-confirm");
    expect(confirm.parentElement).toBe(screen.getByTestId("title-region"));
    expect(confirm.className).toContain("absolute");
    expect(confirm.className).toContain("inset-0");
    expect(confirm.className).toContain("overflow-hidden");
    expect(confirm.className).toContain("pointer-events-none");
    expect(confirm.className).toContain("z-[1000]");
    expect(confirm.getAttribute("aria-hidden")).toBe("true");
  });

  it("fits a narrow title region: words only when there is room, the check alone below that", async () => {
    const { fake } = renderWithClips(<TitleRegion />);
    await act(async () => {
      await fake.service.clipLast();
    });
    const confirm = screen.getByTestId("in-play-confirm");
    expect(confirm.className).toContain("@container");
    const text = screen.getByTestId("in-play-confirm-text");
    expect(text.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(text.className).toContain(`@min-[${CONFIRM_TEXT_MIN_REM}rem]:inline`);
    const pill = text.parentElement!;
    expect(pill.className).toContain(`@max-[${CONFIRM_CHECK_MIN_REM}rem]:hidden`);
    expect(pill.className).toContain("max-w-full");
  });

  it("does not show a result made before it appeared, or a failure", async () => {
    const fake = createFakeClipService();
    await fake.service.clipLast();
    renderWithClips(<TitleRegion />, { fake });
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
    fake.failNext("mux-failed");
    await act(async () => {
      await fake.service.clipLast();
    });
    expect(screen.queryByTestId("in-play-confirm")).toBeNull();
  });
});
