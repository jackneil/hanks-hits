import { render } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  readAloudNotesIn,
  shellHasPlay,
  useBreakSlot,
  useGameBreaks,
  useGameShellMounted,
  useRegisterBreakSlot,
} from "../gameBreaks";

beforeEach(() => {
  useGameBreaks.setState({ shells: 0, slots: [] });
});

describe("shellHasPlay", () => {
  it.each([["/games/snake"], ["/games/oregon-trail/"], ["/"], ["/login"]])(
    "counts %s as a page with play",
    (path) => {
      expect(shellHasPlay(path)).toBe(true);
    }
  );

  it.each([["/apps/weather"], ["/apps/drum-machine/"], ["/apps"]])(
    "counts the app page %s as a page with no play",
    (path) => {
      expect(shellHasPlay(path)).toBe(false);
    }
  );

  it("does not mistake a game whose id starts with 'apps' for an app page", () => {
    expect(shellHasPlay("/appsilly")).toBe(true);
    expect(shellHasPlay("/games/apps-and-more")).toBe(true);
  });
});

describe("readAloudNotesIn", () => {
  it("reads the data-read-aloud words in DOM order and skips empty ones", () => {
    const box = document.createElement("div");
    const note = (tag: string, words: string) => {
      const el = document.createElement(tag);
      el.setAttribute("data-read-aloud", words);
      return el;
    };
    const nested = document.createElement("p");
    nested.appendChild(note("span", "Second."));
    box.append(note("div", "First."), note("div", "  "), nested);
    expect(readAloudNotesIn(box)).toEqual(["First.", "Second."]);
    expect(readAloudNotesIn(null)).toEqual([]);
  });
});

let lastReadNotes: (() => string[]) | null = null;
const keepReadNotes = (readNotes: () => string[]) => {
  lastReadNotes = readNotes;
};

function Surface({
  note,
  onReadNotes = keepReadNotes,
}: {
  note?: string;
  onReadNotes?: (readNotes: () => string[]) => void;
}) {
  const { slotRef, readNotes } = useRegisterBreakSlot();
  useEffect(() => {
    onReadNotes(readNotes);
  }, [onReadNotes, readNotes]);
  return (
    <div ref={slotRef} data-testid="slot">
      {note && <div data-read-aloud={note} />}
    </div>
  );
}

function Probe() {
  const slot = useBreakSlot();
  const mounted = useGameShellMounted();
  return (
    <output data-testid="probe">
      {slot ? slot.getAttribute("data-testid") : "none"}:{String(mounted)}
    </output>
  );
}

describe("useRegisterBreakSlot", () => {
  it("adds the slot while mounted and removes it on unmount", () => {
    const { getByTestId, unmount } = render(<Surface />);
    expect(useGameBreaks.getState().slots).toEqual([getByTestId("slot")]);

    unmount();
    expect(useGameBreaks.getState().slots).toEqual([]);
  });

  it("makes the newest slot the one that nudges use", () => {
    const first = render(<Surface />);
    const second = render(<Surface />);
    const probe = render(<Probe />);
    const slotOf = (r: ReturnType<typeof render>) =>
      r.container.querySelector('[data-testid="slot"]');

    const slots = useGameBreaks.getState().slots;
    expect(slots).toHaveLength(2);
    expect(slots[1]).toBe(slotOf(second));
    expect(probe.getByTestId("probe")).toHaveTextContent("slot:false");

    second.unmount();
    expect(useGameBreaks.getState().slots).toEqual([slotOf(first)]);
  });

  it("reads the notes inside its own slot, at call time", () => {
    const { rerender, unmount } = render(<Surface />);
    expect(lastReadNotes?.()).toEqual([]);

    rerender(<Surface note="Play full screen!" />);
    expect(lastReadNotes?.()).toEqual(["Play full screen!"]);

    unmount();
    expect(lastReadNotes?.()).toEqual([]);
  });
});
