import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CLIP_SECONDS, HOLD_FOR_MENU_MS, type ClipButtonState } from "../../service/contract";
import {
  createClipPress,
  forwardPress,
  outcomeForPress,
  outcomeForState,
  PRESS_SLOP_PX,
  RELEASE_SLOP_PX,
  releasedOff,
  type TapOutcome,
} from "../pressGesture";
import { createFakeClipService, type FakeClipService } from "./fakeClipService";

let fake: FakeClipService;
let outcomes: TapOutcome[];

function makePress() {
  outcomes = [];
  return createClipPress({
    service: () => fake.service,
    snapshot: () => fake.snapshot(),
    onOutcome: (outcome) => outcomes.push(outcome),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  fake = createFakeClipService();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("drag off to cancel (releasedOff)", () => {
  const rect = { left: 100, top: 10, right: 144, bottom: 54 };

  it("keeps a release inside the button or within RELEASE_SLOP_PX of it", () => {
    expect(RELEASE_SLOP_PX).toBe(48);
    for (const [x, y] of [
      [120, 30],
      [144 + 48, 30],
      [100 - 48, 30],
      [120, 54 + 48],
      [120, 10 - 48],
      [100 - 48, 54 + 48],
    ]) {
      expect(releasedOff(rect, x, y), `${x},${y}`).toBe(false);
    }
  });

  it("cancels a release more than RELEASE_SLOP_PX outside the button on either axis", () => {
    for (const [x, y] of [
      [144 + 49, 30],
      [100 - 49, 30],
      [120, 54 + 49],
      [120, 10 - 49],
      [100 - 49, 54 + 49],
    ]) {
      expect(releasedOff(rect, x, y), `${x},${y}`).toBe(true);
    }
  });
});

describe("clip press (plan 11.1)", () => {
  it("commits a 300 ms press as a clip", async () => {
    const press = makePress();
    expect(press.down("p1", 10, 10, "pointer")).toBe(true);
    vi.advanceTimersByTime(300);
    press.up("p1");

    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
    expect(fake.service.endPress).toHaveBeenCalledTimes(1);
    const [token, info] = vi.mocked(fake.service.endPress).mock.calls[0];
    expect(info).toEqual({ upAtMs: token.downAtMs + 300, moved: false });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe("commit");
    await Promise.resolve();
    expect(fake.records).toHaveLength(1);
  });

  it("opens the menu at the 500 ms mark of a hold, and the release does nothing more", () => {
    const press = makePress();
    press.down("p1", 10, 10, "pointer");
    vi.advanceTimersByTime(HOLD_FOR_MENU_MS - 1);
    expect(outcomes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: "menu", source: "pointer" });
    const token = vi.mocked(fake.service.beginPress).mock.results[0].value;
    expect(outcomes[0]).toMatchObject({ token });

    vi.advanceTimersByTime(100); // released at 600 ms
    press.up("p1");
    expect(fake.service.endPress).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect(fake.records).toHaveLength(0);
    expect(fake.service.clipLast).not.toHaveBeenCalled();
  });

  it("opens the menu, never a clip, when the hold timer fires a little early on a coarse clock", () => {
    // Real browsers blur performance.now() and can fire a timer early: the
    // clock may read 499.9 ms when the 500 ms timer runs.
    let clock = 1000;
    outcomes = [];
    const press = createClipPress({
      service: () => fake.service,
      snapshot: () => fake.snapshot(),
      onOutcome: (outcome) => outcomes.push(outcome),
      now: () => clock,
    });
    vi.mocked(fake.service.beginPress).mockImplementation(() => ({ pressId: "jitter", downAtMs: 1000, endAtUs: 7 }));
    vi.mocked(fake.service.endPress).mockImplementation((token, info) => {
      if (info.cancelled) return { kind: "ignored", reason: "busy" };
      if (info.upAtMs - token.downAtMs >= HOLD_FOR_MENU_MS && !info.moved) return { kind: "menu" };
      return { kind: "clip", result: fake.service.clipLast() };
    });
    press.down("p1", 0, 0, "pointer");
    clock = 1000 + 499.9;
    vi.advanceTimersByTime(HOLD_FOR_MENU_MS);
    expect(vi.mocked(fake.service.endPress).mock.calls[0][1].upAtMs).toBe(1000 + HOLD_FOR_MENU_MS);
    expect(outcomes).toEqual([expect.objectContaining({ kind: "menu", hold: true })]);
    expect(fake.service.clipLast).not.toHaveBeenCalled();
    expect(fake.records).toHaveLength(0);
  });

  it("reports a press that must not open the menu as a tap, however long it is held (a controller)", async () => {
    const press = makePress();
    press.down("pad:0", 0, 0, "gamepad", { holdToMenu: false });
    vi.advanceTimersByTime(900);
    press.up("pad:0");
    const [token, info] = vi.mocked(fake.service.endPress).mock.calls[0];
    expect(info.upAtMs - token.downAtMs).toBeLessThan(HOLD_FOR_MENU_MS);
    expect(outcomes).toEqual([expect.objectContaining({ kind: "commit", action: "clip", source: "gamepad" })]);
    await Promise.resolve();
    expect(fake.records).toHaveLength(1);
  });

  it("measures the press on its own clock, whatever clock the token uses", async () => {
    // A service whose tokens carry epoch milliseconds, not performance.now().
    const epoch = 1_760_000_000_000;
    let seq = 0;
    vi.mocked(fake.service.beginPress).mockImplementation(() => {
      seq += 1;
      return { pressId: `epoch-${seq}`, downAtMs: epoch + seq * 10_000, endAtUs: 1 };
    });
    // The service applies the hold rule on ITS clock: upAtMs - downAtMs.
    vi.mocked(fake.service.endPress).mockImplementation((token, info) => {
      const held = info.upAtMs - token.downAtMs;
      if (info.cancelled) return { kind: "ignored", reason: "busy" };
      if (held >= HOLD_FOR_MENU_MS && !info.moved) return { kind: "menu" };
      return { kind: "clip", result: fake.service.clipLast() };
    });
    const press = makePress();
    press.down("p1", 0, 0, "pointer");
    vi.advanceTimersByTime(300);
    press.up("p1");
    expect(vi.mocked(fake.service.endPress).mock.calls[0][1].upAtMs).toBe(epoch + 10_000 + 300);
    expect(outcomes[0].kind).toBe("commit");

    press.down("p2", 0, 0, "pointer");
    vi.advanceTimersByTime(HOLD_FOR_MENU_MS);
    expect(outcomes[1].kind).toBe("menu");
  });

  it("treats a press that moved past the slop as no hold", () => {
    const press = makePress();
    press.down("p1", 0, 0, "pointer");
    press.move("p1", PRESS_SLOP_PX, 0); // inside the slop: still a hold candidate
    press.move("p1", PRESS_SLOP_PX + 1, 0);
    vi.advanceTimersByTime(800);
    expect(outcomes).toEqual([]);
    press.up("p1");
    const info = vi.mocked(fake.service.endPress).mock.calls[0][1];
    expect(info.moved).toBe(true);
  });

  it("ends a cancelled press without a commit", () => {
    const press = makePress();
    press.down("p1", 0, 0, "pointer");
    vi.advanceTimersByTime(100);
    press.cancel("p1");
    expect(vi.mocked(fake.service.endPress).mock.calls[0][1]).toMatchObject({ cancelled: true });
    expect(outcomes).toEqual([{ kind: "none", source: "pointer" }]);
    expect(fake.records).toHaveLength(0);
    expect(fake.openPressCount()).toBe(0);
  });

  it("acts once per press: a second finger and a second release do nothing", () => {
    const press = makePress();
    expect(press.down("p1", 0, 0, "pointer")).toBe(true);
    expect(press.down("p2", 0, 0, "pointer")).toBe(false);
    press.up("p2");
    press.up("p1");
    press.up("p1");
    expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
    expect(fake.service.endPress).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
  });

  it("extends the last clip within 5 s", async () => {
    const press = makePress();
    press.tap("pointer");
    await Promise.resolve();
    vi.advanceTimersByTime(2000);
    press.tap("pointer");
    expect(outcomes.map((outcome) => outcome.kind === "commit" && outcome.action)).toEqual(["clip", "extend"]);
  });

  it("stops the video instead of pressing while recording", () => {
    fake.set({ button: "recording", recording: { recordingId: "r", startedAtMs: 0, elapsedSec: 3, stars: 0 } });
    const press = makePress();
    press.down("p1", 0, 0, "pointer");
    vi.advanceTimersByTime(900); // no hold menu while recording
    expect(outcomes).toEqual([]);
    press.up("p1");
    expect(fake.service.beginPress).not.toHaveBeenCalled();
    expect(fake.service.stopRecording).toHaveBeenCalledTimes(1);
    expect(outcomes[0].kind).toBe("stop");
  });

  it("maps ignored reasons to replies and menus", () => {
    const cases: Array<[ClipButtonState, Partial<TapOutcome>]> = [
      ["warming", { kind: "reply", reason: "warming", pulse: true }],
      ["source-lost", { kind: "reply", reason: "warming", pulse: true }],
      ["recovering", { kind: "reply", reason: "warming", pulse: true }],
      ["resting", { kind: "menu", hold: false }],
      ["record-only", { kind: "menu", hold: false }],
      ["disabled", { kind: "reply", reason: "breaker" }],
      ["saving", { kind: "none" }],
      ["exporting", { kind: "none" }],
    ];
    for (const [button, expected] of cases) {
      fake = createFakeClipService({ snapshot: { button } });
      const press = makePress();
      press.tap("pointer");
      expect(outcomes, button).toHaveLength(1);
      expect(outcomes[0], button).toMatchObject(expected);
      expect(fake.records, button).toHaveLength(0);
    }
  });

  it("uses the button state when the service gives no token", () => {
    fake = createFakeClipService({ snapshot: { button: "warming" } });
    vi.mocked(fake.service.beginPress).mockReturnValue(null);
    const press = makePress();
    press.tap("keyboard");
    expect(outcomes).toEqual([{ kind: "reply", reason: "warming", pulse: true, source: "keyboard" }]);
    // A hold with no token still opens the menu.
    press.down("p1", 0, 0, "pointer");
    vi.advanceTimersByTime(HOLD_FOR_MENU_MS);
    expect(outcomes[1]).toEqual({ kind: "menu", token: null, source: "pointer", hold: true });
  });

  it("clips the footage from before the pause on a Suspended tap with no token (plan 11.3)", async () => {
    fake = createFakeClipService({ snapshot: { button: "suspended", reason: "hidden", atBreak: true } });
    vi.mocked(fake.service.beginPress).mockReturnValue(null);
    const press = makePress();
    press.tap("pointer");
    expect(fake.service.clipLast).toHaveBeenCalledWith(DEFAULT_CLIP_SECONDS);
    expect(outcomes[0]).toMatchObject({ kind: "commit", action: "clip" });
    await Promise.resolve();
    expect(fake.records).toHaveLength(1);
  });

  it("does nothing for an ignored press whose code is not a reason (busy, or cancelled from a newer service)", () => {
    const token = { pressId: "t", downAtMs: 0, endAtUs: 0 };
    expect(outcomeForPress({ kind: "ignored", reason: "busy" }, token, "pointer")).toEqual({ kind: "none", source: "pointer" });
    const cancelled = { kind: "ignored", reason: "cancelled" } as unknown as Parameters<typeof outcomeForPress>[0];
    expect(outcomeForPress(cancelled, token, "pointer")).toEqual({ kind: "none", source: "pointer" });
    expect(outcomeForPress({ kind: "ignored", reason: "quota" }, token, "pointer")).toMatchObject({ kind: "reply", reason: "quota" });
  });

  it("does nothing when the button is hidden", () => {
    fake = createFakeClipService({ snapshot: { button: "hidden" } });
    const press = makePress();
    expect(press.down("p1", 0, 0, "pointer")).toBe(false);
    press.tap("keyboard");
    press.openMenu("pointer");
    expect(outcomes).toEqual([]);
    expect(fake.service.beginPress).not.toHaveBeenCalled();
  });

  it("opens the menu for a right-click with a frozen token and no commit", () => {
    const press = makePress();
    press.openMenu("pointer");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe("menu");
    expect(vi.mocked(fake.service.endPress).mock.calls[0][1]).toMatchObject({ cancelled: true });
    expect(fake.openPressCount()).toBe(0);
    expect(fake.records).toHaveLength(0);
  });

  it("commits a held press as a clip up to the frozen end (gamepad Back hold)", () => {
    const press = makePress();
    press.down("pad:0", 0, 0, "gamepad", { holdToMenu: false });
    vi.advanceTimersByTime(1000);
    expect(outcomes).toEqual([]); // no menu without holdToMenu
    press.commitHeld("pad:0");
    const token = vi.mocked(fake.service.beginPress).mock.results[0].value;
    expect(fake.service.clipLast).toHaveBeenCalledWith(DEFAULT_CLIP_SECONDS, token);
    expect(outcomes[0]).toMatchObject({ kind: "commit", action: "clip", source: "gamepad" });
    expect(fake.openPressCount()).toBe(0);
    press.up("pad:0");
    expect(outcomes).toHaveLength(1);
  });

  it("releases a press still down on dispose, with no outcome", () => {
    const press = makePress();
    press.down("p1", 0, 0, "pointer");
    press.dispose();
    expect(fake.openPressCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(outcomes).toEqual([]);
  });

  it("forwards to the current press, and does nothing without one", () => {
    let target: ReturnType<typeof makePress> | null = null;
    const proxy = forwardPress(() => target);
    expect(proxy.down("p", 0, 0, "pointer")).toBe(false);
    expect(proxy.isActive()).toBe(false);
    target = makePress();
    proxy.tap("keyboard");
    expect(outcomes).toHaveLength(1);
  });

  it("gives a reply for an error state and nothing for a plain ready state", () => {
    const base = fake.snapshot();
    expect(outcomeForState({ ...base, button: "error", reason: "quota" }, "pointer")).toMatchObject({
      kind: "reply",
      reason: "quota",
    });
    expect(outcomeForState({ ...base, button: "ready", reason: null }, "pointer")).toEqual({ kind: "none", source: "pointer" });
  });
});
