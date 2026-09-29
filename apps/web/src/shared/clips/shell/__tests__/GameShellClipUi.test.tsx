/**
 * The clip UI in the real GameShell (plan 4.1, 11.2, 11.4).
 *
 * - A module without clips: true, and a clip-enabled module while the flag is
 *   off, load NO clip code: the dynamic imports of the service and of the clip
 *   UI never run (their module factories are counted), and the shell renders
 *   what it rendered before clips: no clip slot, no toast slot, no pause-menu
 *   entry.
 * - With the flag on, the clip button takes the header's clip slot, the
 *   in-play confirmation lies in the title region, the toast slot and the clip
 *   sheets portal to document.body at their z-levels, the pause menu gets the
 *   "Clips" entry and says it out loud, and a ResultChip in the game shows the
 *   clip buttons and says them too.
 * - The game under the shell never remounts when the clip UI arrives.
 *
 * The real GameShell, ClipProvider, ClipUiMount and clip UI; the service is
 * the UI tests' contract fake.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/shared/lib/gameMetadata.generated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/gameMetadata.generated")>();
  return {
    ...actual,
    getGameMetadata: (appId: string) => ({ ...actual.getGameMetadata(appId), clips: appId === "clip-game", icon: "🎯" }),
  };
});

const flag = vi.hoisted(() => ({ verdict: { mode: "on", capture: true } as { mode: string; capture: boolean } }));
vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return { ...actual, loadClipsVerdict: vi.fn(async () => flag.verdict) };
});

// Each factory runs once, at the first import of its module: a count of 0
// proves that the dynamic import never happened.
const loads = vi.hoisted(() => ({ service: 0, parts: 0, current: null as unknown }));
vi.mock("../../service/ClipService", () => {
  loads.service++;
  return { startClipService: () => loads.current };
});
vi.mock("../../ui/shellParts", async (importOriginal) => {
  loads.parts++;
  return importOriginal();
});

import { GameShell } from "@/shared/components/GameShell";
import { ResultChip } from "@/shared/components/ResultChip";
import { loadClipsVerdict } from "../../config";
import { MENU_COPY, PAUSE_ENTRY_LABEL, RESULT_ACTION_COPY, watchRunLabel } from "../../ui/copy";
import { createFakeClipService, type FakeClipService } from "../../ui/__tests__/fakeClipService";
import { pointer } from "../../ui/__tests__/renderClips";

function useFakeService(): FakeClipService {
  const fake = createFakeClipService({ snapshot: { appId: "clip-game" } });
  // ClipProvider also calls refreshGame (the ClipService extra).
  loads.current = { ...fake.service, refreshGame: vi.fn() };
  return fake;
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Waits long enough for a dynamic import to land (the "clips on" tests below
 * are the control: the same wait sees both imports there).
 */
async function settleImports() {
  await settle();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await settle();
}

/** The clip UI loads with a real dynamic import: wait for the clip button to show. */
async function clipUiLoaded(): Promise<HTMLElement> {
  const button = await screen.findByTestId("clip-button", {}, { timeout: 30_000 });
  await settle();
  return button;
}

let mounts = 0;
function GameBody({ label = "game" }: { label?: string }) {
  useEffect(() => {
    mounts++;
  }, []);
  return <p>{label}</p>;
}

beforeEach(() => {
  mounts = 0;
  flag.verdict = { mode: "on", capture: true };
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: vi.fn() });
});

afterEach(() => {
  removeSpeechMock();
  vi.clearAllMocks();
  // @ts-expect-error - remove the stub again
  delete HTMLElement.prototype.animate;
});

describe("pages with clips off load no clip code (plan 4.1)", () => {
  it("a module without clips: true: no flag read, no service, no clip UI, no clip slot", async () => {
    useFakeService();
    render(
      <GameShell appId="breakout" gameName="Breakout">
        <GameBody />
      </GameShell>,
    );
    await settleImports();
    expect(loadClipsVerdict).not.toHaveBeenCalled();
    expect(loads.service).toBe(0);
    expect(loads.parts).toBe(0);
    expect(screen.queryByTestId("header-clip-slot")).toBeNull();
    expect(document.querySelector('[data-testid="clip-toast-slot"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    expect(within(screen.getByTestId("pause-menu")).queryByText(PAUSE_ENTRY_LABEL)).toBeNull();
  });

  it("a clip-enabled module while the flag is off: the flag is read, and nothing else loads", async () => {
    flag.verdict = { mode: "off", capture: false };
    useFakeService();
    render(
      <GameShell appId="clip-game" gameName="Clip Game">
        <GameBody />
      </GameShell>,
    );
    await settleImports();
    expect(loadClipsVerdict).toHaveBeenCalledTimes(1);
    expect(loads.service).toBe(0);
    expect(loads.parts).toBe(0);
    expect(screen.queryByTestId("header-clip-slot")).toBeNull();
    expect(document.querySelector('[data-testid="clip-toast-slot"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    expect(within(screen.getByTestId("pause-menu")).queryByText(PAUSE_ENTRY_LABEL)).toBeNull();
  });

  it("a ResultChip in a game without clips shows no clip buttons", async () => {
    render(
      <GameShell appId="breakout" gameName="Breakout">
        <ResultChip resultText="Game over!" onRestart={vi.fn()} graceMs={0} />
      </GameShell>,
    );
    await settle();
    expect(screen.queryByTestId("result-chip-clip-actions")).toBeNull();
    expect(screen.getByTestId("result-chip").querySelectorAll("[data-action]")).toHaveLength(0);
  });
});

describe("GameShell with clips on", () => {
  it("puts the clip button in the header's clip slot, and the game never remounts", async () => {
    useFakeService();
    render(
      <GameShell appId="clip-game" gameName="Clip Game">
        <GameBody />
      </GameShell>,
    );
    // The first render: the game is there, the clip UI is not (yet).
    expect(screen.getByText("game")).toBeInTheDocument();
    await clipUiLoaded();
    expect(loads.service).toBe(1);
    expect(loads.parts).toBe(1);
    const slot = screen.getByTestId("header-clip-slot");
    const button = within(slot).getByTestId("clip-button");
    expect(button).toBeInTheDocument();
    // The slot sits in the header's control cluster (plan 11.2), before the pause button.
    const controls = screen.getByTestId("game-shell-controls");
    expect(controls.contains(slot)).toBe(true);
    const order = Array.from(controls.children);
    expect(order.indexOf(slot)).toBeLessThan(order.indexOf(within(controls).getByRole("button", { name: "Pause game" })));
    expect(mounts).toBe(1);
  });

  it("a tap clips: the confirmation lies in the title region and the new-clip chip portals to the toast slot (z-1050)", async () => {
    const fake = useFakeService();
    render(
      <GameShell appId="clip-game" gameName="Clip Game">
        <GameBody />
      </GameShell>,
    );
    const button = await clipUiLoaded();
    fireEvent.pointerDown(button, pointer());
    fireEvent.pointerUp(button, pointer());
    await settle();
    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
    expect(fake.service.endPress).toHaveBeenCalledTimes(1);
    expect(fake.records).toHaveLength(1);

    const confirm = screen.getByTestId("in-play-confirm");
    const header = screen.getByTestId("game-shell-header");
    expect(header.contains(confirm)).toBe(true);
    // In the title region, which is `relative`, never in the control cluster.
    expect(screen.getByTestId("game-shell-controls").contains(confirm)).toBe(false);
    expect(confirm.parentElement?.className).toMatch(/\brelative\b/);
    expect(confirm.getAttribute("aria-hidden")).toBe("true");

    const toastSlot = document.querySelector('[data-testid="clip-toast-slot"]') as HTMLElement;
    expect(toastSlot).not.toBeNull();
    expect(toastSlot.className).toContain("z-[1050]");
    // Portaled: a child of document.body, not of the shell.
    expect(header.parentElement?.contains(toastSlot)).toBe(false);
    expect(within(toastSlot).getByTestId("clip-new-chip")).toBeInTheDocument();
  });

  it("the pause menu shows the Clips entry, says it out loud, and opens the Capture menu above it (z-2500, in document.body)", async () => {
    const synth = installSpeechMock();
    useFakeService();
    render(
      <GameShell appId="clip-game" gameName="Clip Game">
        <GameBody />
      </GameShell>,
    );
    await clipUiLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    const menu = screen.getByTestId("pause-menu");
    const entry = within(menu).getByTestId("clips-pause-entry");
    expect(entry).toHaveTextContent(PAUSE_ENTRY_LABEL);

    fireEvent.click(within(menu).getByTestId("read-aloud-button"));
    const spoken = synth.lastUtterance().text;
    expect(spoken.split(". ")).toContain(PAUSE_ENTRY_LABEL);
    expect(spoken.indexOf("Resume")).toBeLessThan(spoken.indexOf(PAUSE_ENTRY_LABEL));

    fireEvent.click(entry);
    await settle();
    const sheet = await screen.findByTestId("capture-menu");
    expect(sheet.closest(".z-\\[2500\\]")).not.toBeNull();
    expect(menu.contains(sheet)).toBe(false);
    expect(screen.getByRole("dialog", { name: MENU_COPY.title })).toBeInTheDocument();
  });

  it("a ResultChip in the game shows the clip buttons after its own, and speaks them", async () => {
    const synth = installSpeechMock();
    const fake = useFakeService();
    function ResultGame() {
      const [over, setOver] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOver(true)}>
            end the run
          </button>
          {over && <ResultChip resultText="Game over! You got 12 points." onRestart={vi.fn()} graceMs={0} />}
        </>
      );
    }
    render(
      <GameShell appId="clip-game" gameName="Clip Game">
        <ResultGame />
      </GameShell>,
    );
    await clipUiLoaded();
    // The game reported a 20 s run (runPhase "start" and "end").
    fake.playRun(20);
    fireEvent.click(screen.getByRole("button", { name: "end the run" }));
    await settle();
    const chip = screen.getByTestId("result-chip");
    const actions = within(chip).getByTestId("result-chip-clip-actions");
    const labels = Array.from(actions.querySelectorAll("[data-action]")).map((el) => el.textContent?.trim());
    // A run of 30 s or less: one clip button (decision D1). Record and Take a picture stay in the Capture menu.
    expect(labels).toEqual([watchRunLabel("0:20")]);

    fireEvent.click(within(chip).getByTestId("read-aloud-button"));
    const spoken = synth.lastUtterance().text;
    expect(spoken.startsWith("Game over! You got 12 points.")).toBe(true);
    // The voice says the length in words, after the chip's own buttons.
    const watchSpoken = `${RESULT_ACTION_COPY.watchRun}, 20 seconds`;
    expect(spoken).toContain(watchSpoken);
    expect(spoken).not.toContain("0:20");
    expect(spoken.indexOf("Play again")).toBeLessThan(spoken.indexOf(watchSpoken));
  });
});
