import { act, render, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ALL_NOTES,
  readAloudNotesIn,
  shellHasPlay,
  useBreakSlot,
  useGameBreaks,
  useGameShellMounted,
  useNudgePlacement,
  useRegisterBreakSlot,
  type NoteKind,
} from "../gameBreaks";
import { useStartOverlayPresence } from "../startOverlayPresence";

beforeEach(() => {
  useGameBreaks.setState({ shells: 0, slots: [] });
  useStartOverlayPresence.setState({ count: 0, enteredOn: null, leftOn: null });
});

afterEach(() => {
  window.history.pushState({}, "", "/");
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
  holds,
  onReadNotes = keepReadNotes,
}: {
  note?: string;
  holds?: readonly NoteKind[];
  onReadNotes?: (readNotes: () => string[]) => void;
}) {
  const { slotRef, readNotes } = useRegisterBreakSlot(holds);
  useEffect(() => {
    onReadNotes(readNotes);
  }, [onReadNotes, readNotes]);
  return (
    <div ref={slotRef} data-testid="slot">
      {note && <div data-read-aloud={note} />}
    </div>
  );
}

function Probe({ kind = "tip" }: { kind?: NoteKind }) {
  const slot = useBreakSlot(kind);
  const mounted = useGameShellMounted();
  return (
    <output data-testid="probe">
      {slot ? slot.getAttribute("data-testid") : "none"}:{String(mounted)}
    </output>
  );
}

describe("useRegisterBreakSlot", () => {
  it("adds the slot while mounted, holding every note by default, and removes it on unmount", () => {
    const { getByTestId, unmount } = render(<Surface />);
    expect(useGameBreaks.getState().slots).toEqual([{ el: getByTestId("slot"), holds: ALL_NOTES }]);

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
    expect(slots[1].el).toBe(slotOf(second));
    expect(probe.getByTestId("probe")).toHaveTextContent("slot:false");

    second.unmount();
    expect(useGameBreaks.getState().slots.map((slot) => slot.el)).toEqual([slotOf(first)]);
  });

  it("gives a note only a slot that holds its kind: the result chip holds no install tip", () => {
    // The install tip is about 150 px tall. With the result chip's buttons
    // it would cover most of a phone held sideways at game over.
    render(<Surface holds={["celebration"]} />);
    const tip = render(<Probe kind="tip" />);
    const celebration = render(<Probe kind="celebration" />);
    expect(within(tip.container).getByTestId("probe")).toHaveTextContent("none:false");
    expect(within(celebration.container).getByTestId("probe")).toHaveTextContent("slot:false");
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

/** Renders the placement of one note kind as words. */
function Placement({ kind }: { kind: NoteKind }) {
  const placement = useNudgePlacement(kind);
  return (
    <output data-testid="placement">
      {placement.kind === "slot" ? `slot:${placement.slot.getAttribute("data-testid")}` : placement.kind}
    </output>
  );
}

describe("useNudgePlacement", () => {
  /** Mounts a fresh probe and reads its placement. */
  const placementOf = (kind: NoteKind) => {
    const { container } = render(<Placement kind={kind} />);
    return within(container).getByTestId("placement").textContent;
  };
  const setBreaks = (state: Partial<ReturnType<typeof useGameBreaks.getState>>) =>
    act(() => useGameBreaks.setState(state));
  const setStartCards = (state: Partial<ReturnType<typeof useStartOverlayPresence.getState>>) =>
    act(() => useStartOverlayPresence.setState(state));

  it("is the page form on a page with no shell, no start card and no slot", () => {
    expect(placementOf("tip")).toBe("page");
    expect(placementOf("celebration")).toBe("page");
  });

  it("waits while a game shell is on screen with no break surface (the kid is playing)", () => {
    setBreaks({ shells: 1 });
    expect(placementOf("tip")).toBe("wait");
    expect(placementOf("celebration")).toBe("wait");
  });

  it("is the newest slot that holds the note while a break surface is up", () => {
    setBreaks({ shells: 1 });
    render(<Surface />);
    expect(placementOf("tip")).toBe("slot:slot");
    expect(placementOf("celebration")).toBe("slot:slot");
  });

  it("waits when the only break surface does not hold the note", () => {
    // The result chip holds celebrations only: the install tip waits for
    // the start card or the pause menu, and never becomes a page form
    // under the chip.
    setBreaks({ shells: 1 });
    render(<Surface holds={["celebration"]} />);
    expect(placementOf("tip")).toBe("wait");
    expect(placementOf("celebration")).toBe("slot:slot");
  });

  it("waits while a start card with no room for a note is up, so a page form never covers Play", () => {
    setStartCards({ count: 1 });
    expect(placementOf("tip")).toBe("wait");
    expect(placementOf("celebration")).toBe("wait");
  });

  it("waits on an app page whose start card has left (the quiz is running)", () => {
    window.history.pushState({}, "", "/apps/trivia");
    setStartCards({ count: 0, leftOn: "/apps/trivia" });
    expect(placementOf("tip")).toBe("wait");
    expect(placementOf("celebration")).toBe("wait");
  });

  it("is the page form on an app page with no start card, and on another app after the quiz", () => {
    setStartCards({ count: 0, leftOn: "/apps/trivia" });
    window.history.pushState({}, "", "/apps/drawing-app");
    expect(placementOf("tip")).toBe("page");
    window.history.pushState({}, "", "/apps/weather");
    expect(placementOf("celebration")).toBe("page");
  });

  it("does not count a game page's start card leaving as an app in use: the shell decides there", () => {
    window.history.pushState({}, "", "/games/snake");
    setStartCards({ count: 0, leftOn: "/games/snake" });
    // No shell mounted (the page is gone): the page form.
    expect(placementOf("celebration")).toBe("page");
    setBreaks({ shells: 1 });
    expect(placementOf("celebration")).toBe("wait");
  });
});
