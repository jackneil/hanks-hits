/**
 * A refused action is invisible (contract.ts ClipActionResult.refused).
 *
 * The service refuses an action for the player on screen while it reads the
 * owner again after a back-forward restore, and when the owner changes
 * while the action runs. The kid then sees nothing: no reply toast, no
 * new-clip chip, no error state, no viewer. These tests run the clip UI
 * controller and press machine against the REAL service, so the UI's reply
 * rule and the service's refusal are tested together. A normal failure
 * (warming) still gets its reply, so the tests cannot pass by showing
 * nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClipPress, type TapOutcome } from "../../ui/pressGesture";
import { createClipUiController, createClipUiStore } from "../../ui/uiStore";
import { resetClipServiceForTests } from "../ClipService";
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

function ui(w: World) {
  const store = createClipUiStore();
  const controller = createClipUiController({
    store,
    service: () => w.service,
    snapshot: () => w.service.getSnapshot(),
    host: () => ({ pauseGame: () => undefined, resumeGame: () => undefined }),
    platform: () => "computer",
    now: () => Date.now(),
  });
  const outcomes: TapOutcome[] = [];
  const press = createClipPress({
    service: () => w.service,
    snapshot: () => w.service.getSnapshot(),
    onOutcome: (o) => {
      outcomes.push(o);
      controller.handleTapOutcome(o);
    },
    now: () => Date.now(),
  });
  return { store, controller, press, outcomes };
}

/** A back-forward restore while offline: the owner cannot be read, so actions are refused. */
async function restoreOffline(w: World): Promise<void> {
  w.offline.value = true;
  const show = new Event("pageshow") as Event & { persisted: boolean };
  Object.defineProperty(show, "persisted", { value: true });
  w.win.dispatchEvent(show);
  await flush();
}

describe("a refused action shows nothing", () => {
  it("a tap while the owner is read again after a back-forward restore", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    const { store, press, outcomes } = ui(w);
    await restoreOffline(w);
    press.tap("pointer");
    await flush();
    expect(outcomes.map((o) => o.kind)).toEqual(["none"]);
    expect(store.getState().reply).toBeNull();
    expect(w.rows.size).toBe(0);
  });

  it("the menu row, Record and the result chip picture while the owner is read again", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    const { store, controller } = ui(w);
    await restoreOffline(w);
    controller.clipLastFromMenu(null);
    controller.toggleRecord();
    controller.pictureFromChip();
    controller.watch();
    await flush();
    expect(store.getState().reply).toBeNull();
    expect(store.getState().sheet).toBeNull();
    const snap = w.service.getSnapshot();
    expect(snap.lastResult).toBeNull();
    expect(snap.unwatchedClipId).toBeNull();
    expect(snap.button).not.toBe("error");
  });

  it("a clip that finishes after the owner changed", async () => {
    const w = makeWorld();
    await w.service.setSessionUser("kid-1");
    await ready(w);
    let release: () => void = () => undefined;
    const base = w.engine.clipResult;
    w.engine.clipResult = async (req) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return base(req);
    };
    const { store, press, outcomes } = ui(w);
    press.tap("pointer");
    await w.service.setSessionUser("kid-2");
    release();
    const commit = outcomes[0];
    if (!commit || commit.kind !== "commit") throw new Error("no commit");
    expect(await commit.result).toMatchObject({ ok: false, refused: true });
    await flush();
    expect(store.getState().reply).toBeNull();
    expect(w.service.getSnapshot().unwatchedClipId).toBeNull();
    expect(w.service.getSnapshot().button).not.toBe("error");
  });

  it("a normal failure still answers the kid (warming)", async () => {
    const w = makeWorld();
    const game = w.service.attach({ appId: "breakout", gameName: "Breakout", emoji: "🧱", canPause: true });
    await flush();
    game.setAtBreak(false);
    game.registerCanvas(document.createElement("canvas"));
    await flush();
    const { store, controller } = ui(w);
    controller.clipLastFromMenu(null);
    await flush();
    expect(store.getState().reply).not.toBeNull();
  });
});
