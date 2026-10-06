import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HIDDEN_SNAPSHOT, type ClipButtonState } from "../../service/contract";
import { faceFor, LOOK_HOLD_MS, sameLook } from "../buttonFace";
import { deferredMenuText, reasonText, TOAST_COPY } from "../copy";
import { clipGameInfo, formatBytes, formatDuration, UNKNOWN_GAME_EMOJI } from "../format";
import { BACK_BUTTON_INDEX, clipButtonFor, createGamepadPoller, parseVendorProduct, SHARE_BUTTON_INDEX, type PadLike } from "../gamepad";
import { ignoreForHotkey, isTextEntryTarget, matchClipHotkey } from "../hotkeys";
import { canShareHere, detectSavePlatform, isApplePlatform, pageHasBeenActive } from "../platform";
import { createClipPress, type ClipPress } from "../pressGesture";
import {
  capturedSecSince,
  createClipUiController,
  createClipUiStore,
  HOLD_TIP_AFTER_CLIPS,
  REPLY_MS,
  UI_PREFS_KEY,
  type ClipUiHost,
} from "../uiStore";
import { createFakeClipService, makeRecord, type FakeClipService } from "./fakeClipService";

describe("format helpers", () => {
  it("writes times and sizes for kids", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7.9)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("62:05");
    expect(formatDuration(-3)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(1)).toBe("1 MB");
    expect(formatBytes(2.2 * 1024 * 1024)).toBe("3 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  it("names a known game and never throws on an unknown one", () => {
    expect(clipGameInfo("snake")).toEqual({ name: "Snake", emoji: expect.any(String), known: true });
    for (const id of ["unknown", "", "constructor", "__proto__", "not-a-game", null, undefined]) {
      const info = clipGameInfo(id as string);
      expect(info.known).toBe(false);
      expect(info.emoji).toBe(UNKNOWN_GAME_EMOJI);
      expect(info.name).toBe("A game you played");
    }
  });
});

describe("save platform", () => {
  it("picks Photos on iPhone and iPad, phone on Android, computer elsewhere", () => {
    expect(detectSavePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)" })).toBe("photos");
    expect(detectSavePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe("photos");
    expect(detectSavePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).toBe("computer");
    expect(detectSavePlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X230)" })).toBe("phone");
    expect(detectSavePlatform({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)" })).toBe("computer");
    expect(detectSavePlatform({ userAgent: "", userAgentData: { mobile: true } })).toBe("phone");
    expect(detectSavePlatform(undefined)).toBe("computer");
  });

  it("knows Apple keyboards, the share sheet and a page the kid has tapped", () => {
    expect(isApplePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe(true);
    expect(isApplePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)" })).toBe(true);
    expect(isApplePlatform({ userAgent: "", userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isApplePlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
    expect(isApplePlatform({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)" })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
    expect(canShareHere({ share: () => Promise.resolve() })).toBe(true);
    expect(canShareHere({})).toBe(false);
    expect(canShareHere(undefined)).toBe(false);
    expect(pageHasBeenActive({ userActivation: { hasBeenActive: false } })).toBe(false);
    expect(pageHasBeenActive({ userActivation: { hasBeenActive: true } })).toBe(true);
    // A browser that cannot tell: the voice may try.
    expect(pageHasBeenActive({})).toBe(true);
  });
});

describe("button faces (plan 11.3)", () => {
  const snap = { warmProgress: 0.5, savingProgress: 0.25 };

  it("draws a distinct look for every visible state", () => {
    const states: ClipButtonState[] = [
      "warming",
      "ready",
      "saving",
      "made",
      "recording",
      "resting",
      "suspended",
      "record-only",
      "disabled",
      "error",
    ];
    const looks = states.map((state) => faceFor(state, snap));
    for (let i = 0; i < looks.length; i++) {
      for (let j = i + 1; j < looks.length; j++) {
        expect(sameLook(looks[i], looks[j]), `${states[i]} vs ${states[j]}`).toBe(false);
      }
    }
  });

  it("clamps progress, and holds source-lost for 1.5 s and recovering for 3 s", () => {
    expect(faceFor("warming", { warmProgress: 3, savingProgress: null }).progress).toBe(1);
    expect(faceFor("saving", { warmProgress: 0, savingProgress: null }).progress).toBe(0);
    expect(faceFor("warming", { warmProgress: Number.NaN, savingProgress: null }).progress).toBe(0);
    expect(LOOK_HOLD_MS).toEqual({ "source-lost": 1500, recovering: 3000 });
  });
});

describe("keyboard shortcut matching (plan 11.2)", () => {
  const base = { key: "", code: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  it("matches Alt+C, Option+C, F8 and Alt+R only", () => {
    expect(matchClipHotkey({ ...base, key: "c", code: "KeyC", altKey: true })).toBe("clip");
    expect(matchClipHotkey({ ...base, key: "ç", code: "KeyC", altKey: true })).toBe("clip");
    expect(matchClipHotkey({ ...base, key: "F8", code: "F8" })).toBe("clip");
    expect(matchClipHotkey({ ...base, key: "r", code: "KeyR", altKey: true })).toBe("record");
    expect(matchClipHotkey({ ...base, key: "c", code: "KeyC" })).toBeNull();
    expect(matchClipHotkey({ ...base, key: "c", code: "KeyC", altKey: true, ctrlKey: true })).toBeNull();
    expect(matchClipHotkey({ ...base, key: "c", code: "KeyC", altKey: true, metaKey: true })).toBeNull();
    expect(matchClipHotkey({ ...base, key: "C", code: "KeyC", altKey: true, shiftKey: true })).toBeNull();
    expect(matchClipHotkey({ ...base, key: "F8", code: "F8", altKey: true })).toBeNull();
  });

  it("leaves keys in text fields alone, in any realm", () => {
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.appendChild(inner);
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(inner)).toBe(true);
    expect(isTextEntryTarget(document.createElement("canvas"))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(window)).toBe(false);
    // A button owns Space and Enter only, so Alt+C on a focused button still clips.
    const button = document.createElement("button");
    document.body.appendChild(button);
    const event = new KeyboardEvent("keydown", { key: "ç", code: "KeyC", altKey: true });
    Object.defineProperty(event, "target", { value: button });
    expect(ignoreForHotkey(event)).toBe(false);
    button.remove();
  });
});

describe("game controller detection (plan 11.2)", () => {
  it("reads vendor and product ids from Chromium and Firefox ids", () => {
    expect(parseVendorProduct("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)")).toEqual({
      vendor: "045e",
      product: "0b13",
    });
    expect(parseVendorProduct("45e-b13-Xbox Wireless Controller")).toEqual({ vendor: "045e", product: "0b13" });
    expect(parseVendorProduct("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")).toEqual({
      vendor: "057e",
      product: "2009",
    });
    expect(parseVendorProduct("Some Pad")).toBeNull();
  });

  const pad = (id: string, count: number, mapping = "standard"): PadLike => ({
    id,
    index: 0,
    connected: true,
    mapping,
    buttons: Array.from({ length: count }, () => ({ pressed: false })),
  });

  it("uses the Share or Capture button on Switch Pro and Xbox Series, Back elsewhere", () => {
    expect(clipButtonFor(pad("Pro Controller (Vendor: 057e Product: 2009)", 18))).toEqual({ index: SHARE_BUTTON_INDEX, kind: "share" });
    expect(clipButtonFor(pad("Xbox (Vendor: 045e Product: 0b12)", 18))).toEqual({ index: SHARE_BUTTON_INDEX, kind: "share" });
    // An Xbox One pad has no Share button: Back hold.
    expect(clipButtonFor(pad("Xbox (Vendor: 045e Product: 02fd)", 17))).toEqual({ index: BACK_BUTTON_INDEX, kind: "back-hold" });
    // A Share pad whose browser does not expose button 17: Back hold.
    expect(clipButtonFor(pad("Xbox (Vendor: 045e Product: 0b13)", 17))).toEqual({ index: BACK_BUTTON_INDEX, kind: "back-hold" });
    // No standard mapping, no known layout: nothing.
    expect(clipButtonFor(pad("Joystick", 12, ""))).toBeNull();
  });

  it("does nothing while a clip sheet is open, and a button held across the sheet does not act when it closes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const fake = createFakeClipService();
      const outcomes: string[] = [];
      const press: ClipPress = createClipPress({
        service: () => fake.service,
        snapshot: () => fake.snapshot(),
        onOutcome: (outcome) => outcomes.push(outcome.kind),
      });
      const share = pad("Xbox (Vendor: 045e Product: 0b13)", 18);
      const frames: Array<() => void> = [];
      let sheetOpen = true;
      const poller = createGamepadPoller({
        press,
        enabled: () => !sheetOpen,
        getGamepads: () => [share],
        now: () => performance.now(),
        requestFrame: (callback) => frames.push(callback),
        cancelFrame: () => {},
      });
      poller.start();
      share.buttons[SHARE_BUTTON_INDEX].pressed = true;
      frames.shift()!();
      expect(fake.service.beginPress).not.toHaveBeenCalled();
      sheetOpen = false; // the sheet closes while the button is still down
      vi.advanceTimersByTime(100);
      frames.shift()!();
      share.buttons[SHARE_BUTTON_INDEX].pressed = false;
      frames.shift()!();
      expect(fake.service.beginPress).not.toHaveBeenCalled();
      expect(fake.records).toHaveLength(0);

      // A press that starts, then a sheet opens: it ends with no clip.
      share.buttons[SHARE_BUTTON_INDEX].pressed = true;
      frames.shift()!();
      expect(fake.openPressCount()).toBe(1);
      sheetOpen = true;
      frames.shift()!();
      expect(fake.openPressCount()).toBe(0);
      share.buttons[SHARE_BUTTON_INDEX].pressed = false;
      frames.shift()!();
      expect(fake.records).toHaveLength(0);
      expect(outcomes).toEqual(["none"]);
      poller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a held button when its controller goes away", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const fake = createFakeClipService();
      const outcomes: string[] = [];
      const press: ClipPress = createClipPress({
        service: () => fake.service,
        snapshot: () => fake.snapshot(),
        onOutcome: (outcome) => outcomes.push(outcome.kind),
      });
      let pads: Array<PadLike | null> = [pad("Generic (Vendor: 054c Product: 0ce6)", 17)];
      const frames: Array<() => void> = [];
      const poller = createGamepadPoller({
        press,
        getGamepads: () => pads,
        now: () => performance.now(),
        requestFrame: (callback) => frames.push(callback),
        cancelFrame: () => {},
      });
      poller.start();
      pads[0]!.buttons[8].pressed = true;
      frames.shift()!();
      expect(fake.openPressCount()).toBe(1);
      pads = [];
      frames.shift()!();
      expect(fake.openPressCount()).toBe(0);
      expect(outcomes).toEqual(["none"]);
      expect(poller.isRunning()).toBe(false);
      expect(frames).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("clip UI store and controller", () => {
  let fake: FakeClipService;
  let host: ClipUiHost & { pauseGame: ReturnType<typeof vi.fn>; resumeGame: ReturnType<typeof vi.fn> };

  function makeController() {
    const store = createClipUiStore();
    const controller = createClipUiController({
      store,
      service: () => fake.service,
      snapshot: () => fake.snapshot(),
      host: () => host,
      platform: () => "computer",
    });
    return { store, controller };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    window.localStorage.clear();
    fake = createFakeClipService();
    host = {
      pauseGame: vi.fn(() => fake.set({ atBreak: true })),
      resumeGame: vi.fn(() => fake.set({ atBreak: false })),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears a reply after REPLY_MS, and a newer reply replaces an older one", () => {
    const { store } = makeController();
    const first = store.showReply("one", true);
    vi.advanceTimersByTime(REPLY_MS - 10);
    const second = store.showReply("two", false);
    expect(store.getState().reply).toEqual({ id: second, text: "two", tappable: false });
    vi.advanceTimersByTime(20);
    expect(store.getState().reply?.id).toBe(second);
    store.clearReply(first); // an old id changes nothing
    expect(store.getState().reply?.id).toBe(second);
    vi.advanceTimersByTime(REPLY_MS);
    expect(store.getState().reply).toBeNull();
  });

  it("makes the hold tip due after the third clip and shows it only once, across reloads", () => {
    let { store } = makeController();
    for (let i = 0; i < HOLD_TIP_AFTER_CLIPS - 1; i++) store.noteManualClip();
    expect(store.getState().holdTip).toBe("none");
    store.noteManualClip();
    expect(store.getState().holdTip).toBe("due");
    store.showHoldTip();
    expect(store.getState().holdTip).toBe("showing");
    store.dismissHoldTip();
    ({ store } = makeController()); // a new page
    store.noteManualClip();
    expect(store.getState().holdTip).toBe("none");
    expect(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY)!)).toMatchObject({ manualClips: 4, holdTipShown: true });
  });

  it("survives broken stored preferences", () => {
    window.localStorage.setItem(UI_PREFS_KEY, "{not json");
    const { store } = makeController();
    store.noteManualClip();
    expect(store.sharesCoached()).toBe(0);
    window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ manualClips: -4, sharesCoached: "x" }));
    const again = makeController().store;
    expect(again.sharesCoached()).toBe(0);
  });

  it("counts only clips made with the clip button, and replies to a failed commit", async () => {
    const { store, controller } = makeController();
    const press = createClipPress({
      service: () => fake.service,
      snapshot: () => fake.snapshot(),
      onOutcome: (outcome) => controller.handleTapOutcome(outcome),
    });
    press.tap("pointer");
    await vi.runAllTimersAsync();
    press.tap("pointer"); // an extend does not count
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY)!).manualClips).toBe(1);
    vi.advanceTimersByTime(6000);
    fake.failNext("quota");
    press.tap("pointer");
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().reply?.text).toBe(reasonText("quota"));
  });

  it("replies with a kid reason when an action throws, and logs a values-free reason (plan 12)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { store, controller } = makeController();
      vi.mocked(fake.service.clipLast).mockRejectedValueOnce(Object.assign(new Error("worker died on clip-7"), { name: "AbortError" }));
      controller.clipLastFromMenu(null);
      await Promise.resolve();
      await Promise.resolve();
      expect(store.getState().reply?.text).toBe(reasonText("mux-failed"));
      // A worker crash is told apart from a normal mux failure, and no id leaks into the log.
      expect(warn).toHaveBeenCalledWith("[clips] ui: clip failed (AbortError)");
      warn.mockClear();
      fake.failNext("quota");
      controller.pictureFromMenu();
      await Promise.resolve();
      await Promise.resolve();
      expect(warn).toHaveBeenCalledWith("[clips] ui: picture failed (quota)");
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/clip-\d/);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not open a second sheet over the first", () => {
    const { store, controller } = makeController();
    controller.openMenu(null, "pointer");
    controller.openMenu(null, "gamepad");
    controller.openSettings();
    expect(store.getState().sheet).toMatchObject({ kind: "menu", source: "pointer" });
    expect(host.pauseGame).toHaveBeenCalledTimes(1);
  });

  it("defers the chip's clip in a run that cannot pause, and opens it at the break", () => {
    fake.set({ gameCanPause: false, unwatchedClipId: "c9" });
    fake.records.push(makeRecord({ id: "c9" }));
    const { store, controller } = makeController();
    controller.openNewestClip();
    expect(store.getState().sheet).toBeNull();
    expect(store.getState().pendingOpenId).toBe("c9");
    expect(store.getState().reply?.text).toBe(TOAST_COPY.readyAtRunEnd);
    controller.flushPendingOpen(); // still in the run
    expect(store.getState().sheet).toBeNull();
    fake.set({ atBreak: true });
    controller.flushPendingOpen();
    expect(store.getState().sheet).toEqual({ kind: "viewer", target: { kind: "clip", id: "c9" }, pausedByUs: false });
    expect(store.getState().pendingOpenId).toBeNull();
  });

  it("never opens the viewer over a running game that the page gives no pause for", () => {
    host = {} as typeof host;
    fake.set({ gameCanPause: true });
    const { store, controller } = makeController();
    controller.openViewer({ kind: "clip", id: "x" });
    // No way to pause: it waits for the break instead of covering a running game.
    expect(store.getState().sheet).toBeNull();
    expect(store.getState().pendingOpenId).toBe("x");
  });

  describe("in a run that cannot pause (plan 11.1: never interrupt play)", () => {
    beforeEach(() => {
      fake.set({ gameCanPause: false, atBreak: false });
    });

    function pressFor(ms: number, controller: ReturnType<typeof makeController>["controller"]) {
      const press = createClipPress({
        service: () => fake.service,
        snapshot: () => fake.snapshot(),
        onOutcome: (outcome) => controller.handleTapOutcome(outcome),
      });
      press.down("p1", 0, 0, "pointer");
      vi.advanceTimersByTime(ms);
      press.up("p1");
    }

    it("clips a 600 ms hold at the moment of the press and opens no sheet", async () => {
      const { store, controller } = makeController();
      pressFor(600, controller);
      await Promise.resolve();
      await Promise.resolve();
      const token = vi.mocked(fake.service.beginPress).mock.results[0].value;
      expect(vi.mocked(fake.service.endPress).mock.results[0].value).toEqual({ kind: "menu" });
      expect(fake.service.clipLast).toHaveBeenCalledWith(30, token);
      expect(fake.records).toHaveLength(1);
      expect(store.getState().sheet).toBeNull();
      expect(host.pauseGame).not.toHaveBeenCalled();
      expect(JSON.parse(window.localStorage.getItem(UI_PREFS_KEY)!).manualClips).toBe(1);
    });

    it("keeps a right-click menu for the end of the run, says so, and opens it at the break", () => {
      const { store, controller } = makeController();
      const press = createClipPress({
        service: () => fake.service,
        snapshot: () => fake.snapshot(),
        onOutcome: (outcome) => controller.handleTapOutcome(outcome),
      });
      press.openMenu("pointer");
      expect(store.getState().sheet).toBeNull();
      expect(store.getState().pendingMenu).toBe(true);
      expect(store.getState().reply).toMatchObject({ text: deferredMenuText(null), tappable: true });
      expect(fake.records).toHaveLength(0);
      controller.flushPendingOpen(); // still in the run
      expect(store.getState().sheet).toBeNull();
      fake.set({ atBreak: true });
      controller.flushPendingOpen();
      expect(store.getState().sheet).toMatchObject({ kind: "menu", pausedByUs: false });
      expect(store.getState().pendingMenu).toBe(false);
    });

    it("explains a startup timeout while its menu waits for a break", () => {
      fake.set({ button: "resting", reason: "warmup-timeout" });
      const { store, controller } = makeController();
      controller.openMenu(null, "pointer");
      expect(store.getState().sheet).toBeNull();
      expect(store.getState().pendingMenu).toBe(true);
      expect(store.getState().reply?.text).toBe(deferredMenuText("warmup-timeout"));
    });

    it.each(["resting", "suspended"] as const)("defers retry for a timeout hold without attempting an empty clip (%s)", (button) => {
      fake.set({ button, reason: "warmup-timeout" });
      const { store, controller } = makeController();
      pressFor(600, controller);
      expect(fake.service.clipLast).not.toHaveBeenCalled();
      expect(store.getState().sheet).toBeNull();
      expect(store.getState().pendingMenu).toBe(true);
      expect(store.getState().reply?.text).toBe(deferredMenuText("warmup-timeout"));
      fake.set({ atBreak: true });
      controller.flushPendingOpen();
      expect(store.getState().sheet).toMatchObject({ kind: "menu", pausedByUs: false });
    });

    it("says why a resting button waits, and never covers the run", () => {
      fake.set({ button: "resting" });
      const { store, controller } = makeController();
      pressFor(100, controller);
      expect(store.getState().sheet).toBeNull();
      expect(store.getState().reply?.text).toBe(deferredMenuText("resting"));
      controller.openSettings();
      controller.openMenu(null, "result-chip");
      expect(store.getState().sheet).toBeNull();
    });
  });

  describe("the result chip's frozen run end (plan 11.4)", () => {
    it("takes one released token, and counts only the time capture runs", () => {
      fake.set({ atBreak: true, engine: "buffering" });
      const { store, controller } = makeController();
      controller.beginResultMark();
      controller.beginResultMark(); // one mark per result chip
      expect(fake.service.beginPress).toHaveBeenCalledTimes(1);
      expect(fake.openPressCount()).toBe(0);
      const token = vi.mocked(fake.service.beginPress).mock.results[0].value;
      expect(store.getState().resultMark?.token).toBe(token);

      vi.advanceTimersByTime(1500);
      controller.tickResultMark();
      expect(capturedSecSince(store.getState().resultMark)).toBeCloseTo(1.5, 5);
      vi.advanceTimersByTime(500);
      controller.noteEngine("suspended"); // capture stops (a post-roll ended)
      expect(capturedSecSince(store.getState().resultMark)).toBeCloseTo(2, 5);
      vi.advanceTimersByTime(10_000);
      controller.tickResultMark();
      expect(capturedSecSince(store.getState().resultMark)).toBeCloseTo(2, 5);
      controller.noteEngine("buffering");
      vi.advanceTimersByTime(1000);
      controller.tickResultMark();
      expect(capturedSecSince(store.getState().resultMark)).toBeCloseTo(3, 5);

      controller.endResultMark();
      expect(store.getState().resultMark).toBeNull();
      expect(capturedSecSince(null)).toBe(0);
    });

    it("starts with a stopped count when capture is paused at the break", () => {
      fake.set({ atBreak: true, engine: "suspended" });
      const { store, controller } = makeController();
      controller.beginResultMark();
      vi.advanceTimersByTime(5000);
      controller.tickResultMark();
      expect(capturedSecSince(store.getState().resultMark)).toBe(0);
    });
  });

  it("keeps the menu's pause when it swaps to the viewer, and resumes only after a menu", () => {
    const { store, controller } = makeController();
    controller.openMenu(null, "pointer");
    controller.replaceSheet({ kind: "viewer", target: { kind: "game", gameId: "snake" } });
    expect(store.getState().sheet).toMatchObject({ kind: "viewer", pausedByUs: true });
    controller.closeSheet();
    expect(host.resumeGame).not.toHaveBeenCalled();

    fake.set({ atBreak: false });
    controller.openMenu(null, "pointer");
    controller.wakeFromMenu();
    expect(fake.service.wake).toHaveBeenCalledTimes(1);
    expect(host.resumeGame).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a service", () => {
    const store = createClipUiStore();
    const controller = createClipUiController({
      store,
      service: () => null,
      snapshot: () => HIDDEN_SNAPSHOT,
      host: () => host,
      platform: () => "computer",
    });
    controller.openMenu(null, "pointer");
    controller.openViewer({ kind: "clip", id: "x" });
    controller.openSettings();
    controller.clipRun("whole");
    controller.toggleRecord();
    expect(store.getState().sheet).toBeNull();
    expect(host.pauseGame).not.toHaveBeenCalled();
  });
});
