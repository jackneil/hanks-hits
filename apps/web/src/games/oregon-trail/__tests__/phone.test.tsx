/**
 * Oregon Trail on a phone (PR-G6): every screen keeps its next action on
 * screen (Next, Leave the store, Continue), the setup is readable and can
 * be read aloud, the store shows what you have and takes back a mis-tap,
 * the store will not let a wagon leave with no oxen, a finger hits a small
 * animal, the hunt ends when the bullets do, and Play again starts a new
 * journey with the same names.
 */
import "fake-indexeddb/auto";
import { localWords } from "@/lib/local-words";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installSpeechMock, removeSpeechMock } from "@/__tests__/speech-mock";
import { mockPointer, resetPointerMock } from "@/__tests__/pointer-mock";
import { fingerTap, liftAllFingers } from "@/__tests__/finger-mock";
import { DEFAULT_RESTART_GRACE_MS } from "@/shared/lib/input";

import OregonTrailGame from "../Game";
import { Hunting, MIN_HIT_RADIUS, ANIMAL_CONFIG, hitRadius } from "../components/Hunting";
import { DEFAULT_MEMBER_NAMES } from "../components/TitleScreen";
import { money } from "../components/Store";
import { STORE_PRICES } from "../lib/constants";
import { useOregonTrailStore } from "../lib/store";
import { useHuntPauseStore } from "../lib/huntPause";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: () => ({ isAuthenticated: false, isGuest: true, syncStatus: "idle", lastSynced: null, forceSync: vi.fn() }),
}));
vi.mock("@/shared/components/IOSInstallPrompt", () => ({ IOSInstallPrompt: () => null }));
vi.mock("@/shared/components/Leaderboard", () => ({ Leaderboard: () => <div>Leaderboard content</div> }));

const supplies = (over: Partial<ReturnType<typeof useOregonTrailStore.getState>["supplies"]> = {}) => ({
  food: 0,
  oxen: 0,
  clothing: 0,
  ammunition: 0,
  spareParts: { wheels: 0, axles: 0, tongues: 0 },
  money: 1600,
  ...over,
});

let clock = 1_000_000;

beforeEach(async () => {
  localWords.install();
  await ownerBoundProgress.updateSession("unauthenticated");
  await ownerBoundProgress.whenHydrated("oregon-trail-storage");
  await localWords.prepare("oregon-trail", localWords.captureLease()!);
  clock = 1_000_000;
  localStorage.clear();
  mockPointer(true);
  installSpeechMock();
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  act(() => {
    useOregonTrailStore.getState().resetGame();
    useHuntPauseStore.setState({ paused: false });
  });
});

afterEach(() => {
  liftAllFingers();
  resetPointerMock();
  removeSpeechMock();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Oregon Trail setup", () => {
  it("asks for a name (spaces are not a name), shows readable jobs, and reads the step aloud", () => {
    act(() => useOregonTrailStore.getState().setPhase("setup_name"));
    render(<OregonTrailGame />);
    const step = screen.getByTestId("oregon-setup-name");
    const next = within(screen.getByTestId("oregon-actions")).getByRole("button", { name: /next/i });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "   " } });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "Hank" } });
    expect(next).toBeEnabled();
    const jobs = within(screen.getByTestId("oregon-jobs")).getAllByRole("button");
    expect(jobs).toHaveLength(3);
    fireEvent.click(jobs[2]);
    expect(jobs[2]).toHaveAttribute("aria-pressed", "true");
    expect(within(step).getByTestId("read-aloud-button")).toBeInTheDocument();
    fireEvent.click(next);
    expect(useOregonTrailStore.getState().gamePhase).toBe("setup_party");
  });

  it("an empty family box keeps its name, and the journey starts at the store", () => {
    act(() => useOregonTrailStore.getState().setPhase("setup_name"));
    render(<OregonTrailGame />);
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: " Hank " } });
    fireEvent.click(within(screen.getByTestId("oregon-actions")).getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Family member 2" }), { target: { value: "Ava" } });
    fireEvent.click(within(screen.getByTestId("oregon-actions")).getByRole("button", { name: /next/i }));
    fireEvent.click(within(screen.getByTestId("oregon-months")).getByRole("button", { name: /May/ }));
    fireEvent.click(within(screen.getByTestId("oregon-actions")).getByRole("button", { name: /start the journey/i }));
    const s = useOregonTrailStore.getState();
    expect(s.gamePhase).toBe("store");
    expect(s.leaderName).toBe("Hank");
    expect(s.departureMonth).toBe("may");
    expect(s.party.map((m) => m.name)).toEqual([DEFAULT_MEMBER_NAMES[0], "Ava", DEFAULT_MEMBER_NAMES[2], DEFAULT_MEMBER_NAMES[3]]);
  });
});

describe("Oregon Trail store", () => {
  beforeEach(() => {
    act(() => useOregonTrailStore.setState({ gamePhase: "store", gameStarted: true, supplies: supplies({ ammunition: 20 }) }));
  });

  it("will not let a wagon with no oxen leave while an ox is affordable", () => {
    render(<OregonTrailGame />);
    const leave = within(screen.getByTestId("oregon-actions")).getByRole("button", { name: /leave the store/i });
    expect(leave).toBeDisabled();
    expect(screen.getByTestId("oregon-needs-oxen")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("oregon-item-oxen")).getByRole("button", { name: /^Buy/ }));
    expect(leave).toBeEnabled();
    fireEvent.click(leave);
    expect(useOregonTrailStore.getState().gamePhase).toBe("travel");
  });

  it("lets a broke wagon leave (no ox to buy is not a trap)", () => {
    act(() => useOregonTrailStore.setState({ supplies: supplies({ money: STORE_PRICES.oxen - 1 }) }));
    render(<OregonTrailGame />);
    expect(within(screen.getByTestId("oregon-actions")).getByRole("button", { name: /leave the store/i })).toBeEnabled();
  });

  it("shows what you have, and − takes back only what was bought here, at the same price", () => {
    render(<OregonTrailGame />);
    const food = screen.getByTestId("oregon-item-food");
    const ammo = screen.getByTestId("oregon-item-ammunition");
    // The 20 bullets the wagon came in with cannot be sold.
    expect(within(ammo).getByRole("button", { name: /put back/i })).toBeDisabled();
    fireEvent.click(within(food).getByRole("button", { name: /^Buy/ }));
    fireEvent.click(within(food).getByRole("button", { name: /^Buy/ }));
    expect(food).toHaveTextContent("You have 100 lbs");
    expect(useOregonTrailStore.getState().supplies.money).toBe(1580);
    fireEvent.click(within(food).getByRole("button", { name: /put back/i }));
    expect(food).toHaveTextContent("You have 50 lbs");
    expect(useOregonTrailStore.getState().supplies.money).toBe(1590);
    expect(screen.getByTestId("oregon-money")).toHaveTextContent(money(1590));
  });
});

describe("Oregon Trail travel", () => {
  it("keeps Continue, Rest and Hunt on screen, with the family in one row", () => {
    act(() => {
      useOregonTrailStore.getState().startGame("Hank", "banker", ["A", "B", "C", "D"], "march");
      useOregonTrailStore.setState({ gamePhase: "travel", supplies: supplies({ oxen: 4, food: 200, ammunition: 40 }) });
    });
    render(<OregonTrailGame />);
    const actions = within(screen.getByTestId("oregon-actions"));
    expect(actions.getByRole("button", { name: /continue/i })).toBeInTheDocument();
    expect(actions.getByRole("button", { name: /rest/i })).toBeInTheDocument();
    expect(actions.getByRole("button", { name: /hunt/i })).toBeEnabled();
    expect(screen.getByTestId("oregon-party").children).toHaveLength(4);
    expect(within(screen.getByRole("radiogroup", { name: "Travel pace" })).getAllByRole("radio")).toHaveLength(3);
  });
});

describe("Oregon Trail hunt", () => {
  beforeEach(() => {
    act(() => useOregonTrailStore.setState({ gamePhase: "hunting", supplies: supplies({ oxen: 2, ammunition: 3 }) }));
  });

  it("a fingertip is enough to hit even the smallest animal", () => {
    expect(hitRadius("squirrel")).toBe(MIN_HIT_RADIUS);
    expect(hitRadius("buffalo")).toBe(ANIMAL_CONFIG.buffalo.size / 2);
  });

  it("ends the hunt when the last bullet is gone, and the food goes to the wagon", () => {
    render(<Hunting />);
    const field = screen.getByTestId("hunt-field");
    for (let i = 0; i < 3; i++) fingerTap(screen.getByTestId("hunt-field"), { x: 100 + i * 10, y: 200 });
    expect(field).not.toBeInTheDocument();
    expect(screen.getByTestId("oregon-hunt-done")).toHaveTextContent("Out of bullets!");
    fireEvent.click(within(screen.getByTestId("oregon-actions")).getByRole("button", { name: /take the food/i }));
    const s = useOregonTrailStore.getState();
    expect(s.gamePhase).toBe("travel");
    expect(s.supplies.ammunition).toBe(0);
  });

  it("puts the counts and the animal list in one strip at the top, and nothing over the field's bottom", () => {
    act(() => useOregonTrailStore.setState({ supplies: supplies({ oxen: 2, ammunition: 60 }) }));
    render(<Hunting />);
    expect(screen.getByTestId("hunt-legend")).toHaveTextContent("🦬 +200");
    expect(screen.queryByText(/Controls/)).toBeNull();
    expect(screen.queryByText(/Click/)).toBeNull();
  });
});

describe("Oregon Trail end of the journey", () => {
  it("Play again is a new journey with the same names already filled in", () => {
    act(() => {
      useOregonTrailStore.getState().startGame("Hank", "farmer", ["Ava", "Bo", "Cy", "Di"], "june");
      useOregonTrailStore.setState({ gamePhase: "victory", milesTraveled: 2000 });
    });
    render(<OregonTrailGame />);
    expect(screen.getByTestId("oregon-victory")).toHaveTextContent("You made it to Oregon!");
    clock += DEFAULT_RESTART_GRACE_MS + 50;
    fireEvent.click(within(screen.getByTestId("result-chip")).getByRole("button", { name: /play again/i }));
    expect(useOregonTrailStore.getState().gamePhase).toBe("setup_name");
    expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue("Hank");
    expect(within(screen.getByTestId("oregon-jobs")).getByRole("button", { name: /Farmer/ })).toHaveAttribute("aria-pressed", "true");
  });
});
