import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_EVENTS } from "@/games/oregon-trail/lib/events";
import { useOregonTrailStore } from "@/games/oregon-trail/lib/store";
import { validateProgress } from "@/lib/progress-schemas";

afterEach(() => {
  vi.restoreAllMocks();
  useOregonTrailStore.setState(useOregonTrailStore.getInitialState(), true);
});

function validateEvent(currentEvent: unknown) {
  return validateProgress("oregon-trail", {
    ...useOregonTrailStore.getState().getProgress(), currentEvent,
  });
}

describe("Oregon Trail's saved event", () => {
  it("preserves every game-authored event and no-event state", () => {
    for (const event of [null, ...ALL_EVENTS]) {
      const result = validateEvent(event);
      expect(result.success).toBe(true);
      if (result.success) expect((result.data as { currentEvent: unknown }).currentEvent).toEqual(event);
    }
  });

  it("rejects unknown fields without reflecting their names into validation logs", () => {
    const marker = "private-body-marker";
    for (const event of [
      { ...ALL_EVENTS[0], [marker]: true },
      { ...ALL_EVENTS[0], effect: { [marker]: 1 } },
      { ...ALL_EVENTS[0], choices: [{ id: "x", text: "x", effect: {}, [marker]: true }] },
    ]) {
      const result = validateEvent(event);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Unrecognized field");
        expect(result.error).not.toContain(marker);
      }
    }
  });

  it.each([
    ["ford", 0.1], ["ford", 0.5], ["ford", 0.9],
    ["caulk", 0.1], ["caulk", 0.9], ["ferry", 0.1],
  ])("keeps the real %s river-result event (roll %s)", (method, roll) => {
    vi.spyOn(Math, "random").mockReturnValue(Number(roll));
    useOregonTrailStore.setState({ currentRiver: { name: "Snake River", depth: 6 } });
    useOregonTrailStore.getState().crossRiver(String(method));
    const event = useOregonTrailStore.getState().currentEvent;
    expect(event?.id).toBe("river-crossing-result");
    const result = validateEvent(event);
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { currentEvent: unknown }).currentEvent).toEqual(event);
  });

  it("keeps bounded optional choices and their effects", () => {
    const event = { ...ALL_EVENTS[0], choices: [{
      id: "rest", text: "Rest", successChance: 0.5,
      effect: { daysLost: 2, partyHealth: "very_poor", memberLeftBehind: false },
    }] };
    const result = validateEvent(event);
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { currentEvent: unknown }).currentEvent).toEqual(event);
  });

  it.each([
    [], "arbitrary", 4, {},
    { ...ALL_EVENTS[0], extra: "unknown" },
    { ...ALL_EVENTS[0], effect: { arbitrary: { nested: true } } },
    { ...ALL_EVENTS[0], message: "x".repeat(4097) },
    { ...ALL_EVENTS[0], effect: { food: Infinity } },
    { ...ALL_EVENTS[0], choices: Array.from({ length: 33 }, () => ({ id: "x", text: "x", effect: {} })) },
    { ...ALL_EVENTS[0], choices: [{ id: "x", text: "x", effect: { arbitrary: true } }] },
    { ...ALL_EVENTS[0], choices: [{ id: "x", text: "x", effect: {}, extra: true }] },
  ])("rejects an unbounded or non-event value (%#)", (event) => {
    expect(validateEvent(event).success).toBe(false);
  });
});
