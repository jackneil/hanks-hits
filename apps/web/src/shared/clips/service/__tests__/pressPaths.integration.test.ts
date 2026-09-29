/**
 * The UI press paths against the REAL ClipService (not the UI fake).
 *
 * Contract (contract.ts PressOutcome): a cancelled endPress commits nothing,
 * whatever the press length. Every UI path that lets a token go without a
 * clip sends a cancelled endPress. Each of these tests counts library rows,
 * so a service that treats a short cancel as a tap makes them fail:
 * - the result chip's take-then-release (uiStore.beginResultMark);
 * - the Capture menu (pressGesture.openMenu, the hold, and the menu row);
 * - the controller gate (gamepad.ts: a short Back press stays the game's
 *   own button, a sheet that opens or a controller that goes away ends the
 *   press with no clip, and a Back hold makes exactly one clip);
 * - a browser cancel (Mac Ctrl-click) and an unmount while a finger is down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGamepadPoller, BACK_BUTTON_INDEX, BACK_HOLD_MS, type PadLike } from "../../ui/gamepad";
import { createClipPress, type TapOutcome } from "../../ui/pressGesture";
import { createClipUiController, createClipUiStore } from "../../ui/uiStore";
import { resetClipServiceForTests } from "../ClipService";
import { HOLD_FOR_MENU_MS } from "../contract";
import { disposeWorlds, flush, makeWorld, ready, type World } from "./serviceWorld";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  disposeWorlds();
  resetClipServiceForTests();
  vi.useRealTimers();
});

function pressMachine(w: World) {
  const outcomes: TapOutcome[] = [];
  const press = createClipPress({
    service: () => w.service,
    snapshot: () => w.service.getSnapshot(),
    onOutcome: (o) => outcomes.push(o),
    now: () => Date.now(),
  });
  return { press, outcomes };
}

function controllerFor(w: World) {
  const store = createClipUiStore();
  const controller = createClipUiController({
    store,
    service: () => w.service,
    snapshot: () => w.service.getSnapshot(),
    host: () => ({ pauseGame: () => undefined, resumeGame: () => undefined }),
    platform: () => "computer",
    now: () => Date.now(),
  });
  return { store, controller };
}

/** A standard-mapping controller with no Share button: Back (buttons[8]) held for 1 s clips. */
function padWorld(w: World, options: { enabled?: () => boolean } = {}) {
  const { press, outcomes } = pressMachine(w);
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  const pad: PadLike = { index: 0, connected: true, mapping: "standard", id: "Generic pad", buttons };
  const pads: Array<PadLike | null> = [pad];
  let frame: (() => void) | null = null;
  const poller = createGamepadPoller({
    press,
    enabled: options.enabled,
    getGamepads: () => pads,
    now: () => Date.now(),
    requestFrame: (cb) => {
      frame = cb;
      return 1;
    },
    cancelFrame: () => {
      frame = null;
    },
  });
  poller.start();
  const tick = () => {
    const run = frame;
    frame = null;
    run?.();
  };
  const setBack = (down: boolean) => {
    buttons[BACK_BUTTON_INDEX] = { pressed: down };
  };
  return { press, outcomes, poller, tick, setBack, pads };
}

describe("result chip: take-then-release", () => {
  it("freezing the end of the run makes zero library rows", async () => {
    const w = makeWorld();
    const game = await ready(w);
    w.engine.play(20);
    game.runPhase("end");
    game.setAtBreak(true);
    await flush();
    const { store, controller } = controllerFor(w);
    controller.beginResultMark();
    await flush();
    expect(store.getState().resultMark?.token).not.toBeNull();
    expect(w.engine.clipRequests).toHaveLength(0);
    expect(w.rows.size).toBe(0);
    expect(w.service.getSnapshot().unwatchedClipId).toBeNull();
    expect(w.service.getSnapshot().button).not.toBe("made");
  });

  it("Watch the whole run then clips once: from the run's start to the frozen end", async () => {
    const w = makeWorld();
    const game = await ready(w);
    w.engine.play(20);
    // A restart: the run that the chip shows starts here.
    game.runPhase("end");
    game.runPhase("start");
    const startUs = w.engine.mediaEnd;
    w.engine.play(12);
    game.runPhase("end");
    game.setAtBreak(true);
    await flush();
    const { store, controller } = controllerFor(w);
    controller.beginResultMark();
    const frozen = store.getState().resultMark?.token;
    expect(frozen?.run).toEqual({ startUs, endUs: startUs + 12e6 });
    w.engine.play(3);
    controller.clipRun("whole");
    controller.clipRun("whole"); // a second tap while it is made
    await flush();
    expect(w.rows.size).toBe(1);
    expect(w.engine.clipRequests).toHaveLength(1);
    expect(w.engine.clipRequests[0]).toMatchObject({ seconds: 12, endAtUs: frozen?.endAtUs, notBeforeUs: startUs });
  });
});

describe("Capture menu", () => {
  it("right-click or the menu key (press.openMenu) opens the menu and makes zero rows", async () => {
    const w = makeWorld();
    await ready(w);
    const { press, outcomes } = pressMachine(w);
    press.openMenu("keyboard");
    await flush();
    expect(outcomes.map((o) => o.kind)).toEqual(["menu"]);
    expect(w.engine.clipRequests).toHaveLength(0);
    expect(w.rows.size).toBe(0);
  });

  it("a hold opens the menu, and the menu row clips once from the press's frozen end", async () => {
    const w = makeWorld();
    await ready(w);
    w.engine.play(10);
    const { press, outcomes } = pressMachine(w);
    press.down("pointer:1", 0, 0, "pointer");
    await vi.advanceTimersByTimeAsync(HOLD_FOR_MENU_MS);
    press.up("pointer:1");
    await flush();
    expect(outcomes.map((o) => o.kind)).toEqual(["menu"]);
    expect(w.rows.size).toBe(0);
    const menu = outcomes[0];
    if (menu.kind !== "menu") throw new Error("no menu");
    const { controller } = controllerFor(w);
    controller.clipLastFromMenu(menu.token);
    await flush();
    expect(w.rows.size).toBe(1);
  });
});

describe("clip button cancels", () => {
  it("a browser cancel of a short press (Mac Ctrl-click) makes zero rows", async () => {
    const w = makeWorld();
    await ready(w);
    const { press, outcomes } = pressMachine(w);
    press.down("pointer:1", 0, 0, "pointer");
    vi.advanceTimersByTime(80);
    press.cancel("pointer:1");
    await flush();
    expect(outcomes.map((o) => o.kind)).toEqual(["none"]);
    expect(w.rows.size).toBe(0);
  });

  it("an unmount while a finger is down makes zero rows", async () => {
    const w = makeWorld();
    await ready(w);
    const { press, outcomes } = pressMachine(w);
    press.down("pointer:1", 0, 0, "pointer");
    vi.advanceTimersByTime(120);
    press.dispose();
    await flush();
    expect(outcomes).toHaveLength(0);
    expect(w.rows.size).toBe(0);
  });
});

describe("controller gate", () => {
  it("a short Back press stays the game's own button: zero rows", async () => {
    const w = makeWorld();
    await ready(w);
    const pad = padWorld(w);
    pad.setBack(true);
    pad.tick();
    vi.advanceTimersByTime(200);
    pad.setBack(false);
    pad.tick();
    await flush();
    expect(w.engine.clipRequests).toHaveLength(0);
    expect(w.rows.size).toBe(0);
  });

  it("a Back hold of 1 s makes exactly one clip, and the kid hears it worked", async () => {
    const w = makeWorld();
    await ready(w);
    const pad = padWorld(w);
    pad.setBack(true);
    pad.tick();
    vi.advanceTimersByTime(BACK_HOLD_MS + 100);
    pad.tick();
    await flush();
    const commit = pad.outcomes.find((o) => o.kind === "commit");
    if (!commit || commit.kind !== "commit") throw new Error("no commit");
    expect(await commit.result).toMatchObject({ ok: true, action: "clip" });
    pad.setBack(false);
    pad.tick();
    await flush();
    expect(w.rows.size).toBe(1);
  });

  it("a sheet that opens while Back is down ends the press with zero rows", async () => {
    const w = makeWorld();
    await ready(w);
    let enabled = true;
    const pad = padWorld(w, { enabled: () => enabled });
    pad.setBack(true);
    pad.tick();
    vi.advanceTimersByTime(300);
    enabled = false;
    pad.tick();
    await flush();
    expect(w.rows.size).toBe(0);
  });

  it("a controller that goes away while Back is down makes zero rows", async () => {
    const w = makeWorld();
    await ready(w);
    const pad = padWorld(w);
    pad.setBack(true);
    pad.tick();
    vi.advanceTimersByTime(300);
    const other: PadLike = { index: 1, connected: true, mapping: "", id: "other", buttons: [] };
    pad.pads.splice(0, 1, other);
    pad.tick();
    await flush();
    expect(w.rows.size).toBe(0);
  });

  it("stopping the poller while Back is down makes zero rows", async () => {
    const w = makeWorld();
    await ready(w);
    const pad = padWorld(w);
    pad.setBack(true);
    pad.tick();
    vi.advanceTimersByTime(300);
    pad.poller.stop();
    await flush();
    expect(w.rows.size).toBe(0);
  });
});
