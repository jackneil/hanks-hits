import { describe, expect, it } from "vitest";

import type { EngineState } from "../contract";
import { TRANSITIONS, deriveButton, transition, WARM_SECONDS, type ButtonInput, type MachineEvent } from "../machine";

/** The plan 7 diagram, edge by edge, as written in the plan. */
const DIAGRAM: Array<[EngineState, MachineEvent, EngineState, string]> = [
  ["idle", "source-registered", "warming", "IDLE --> WARMING: source registered"],
  ["warming", "output-ok", "buffering", "WARMING --> BUFFERING: output + calibration ok"],
  ["warming", "no-output", "bridged", "WARMING --> BRIDGED: no output after 2.5 s (Chromium only)"],
  ["bridged", "hardware-ready", "buffering", "BRIDGED --> BUFFERING: hardware ready (new epoch)"],
  ["buffering", "record", "recording", "BUFFERING --> RECORDING: Record"],
  ["recording", "governor-severe", "resting", "RECORDING --> RESTING: governor severe (keeps recording at low-power rung)"],
  ["recording", "hidden", "suspended", "RECORDING --> SUSPENDED: hidden (fragment finalized)"],
  ["recording", "encoder-error", "recovering", "RECORDING --> RECOVERING: encoder error (part closed)"],
  ["recording", "canvas-gone", "source-lost", "RECORDING --> SOURCE_LOST: canvas gone (part finalized)"],
  ["buffering", "governor-severe", "resting", "BUFFERING --> RESTING: governor severe"],
  ["resting", "record", "recording", "RESTING --> RECORDING: Record (low-power rung)"],
  ["resting", "probe-passes", "buffering", "RESTING --> BUFFERING: probe passes"],
  ["buffering", "suspend", "suspended", "BUFFERING --> SUSPENDED: hidden / paused / start card"],
  ["suspended", "resume", "buffering", "SUSPENDED --> BUFFERING: visible + playing"],
  ["buffering", "export", "exporting", "BUFFERING --> EXPORTING: export (encoder closed)"],
  ["exporting", "export-done", "buffering", "EXPORTING --> BUFFERING: done (new epoch)"],
  ["buffering", "canvas-gone", "source-lost", "BUFFERING --> SOURCE_LOST: canvas gone"],
  ["source-lost", "re-registered", "buffering", "SOURCE_LOST --> BUFFERING: re-registered within 1.5 s"],
  ["source-lost", "grace-over", "idle", "SOURCE_LOST --> IDLE: grace over"],
  ["buffering", "encoder-error", "recovering", "BUFFERING --> RECOVERING: encoder error"],
  ["recovering", "recreated", "buffering", "RECOVERING --> BUFFERING: recreated (new epoch)"],
  ["recovering", "disable", "disabled", "RECOVERING --> DISABLED: 4 failures in 60 s, or breaker"],
  ["idle", "device-fallback", "record-only", "IDLE --> RECORD_ONLY: device fallback"],
  ["buffering", "owner-change", "idle", "BUFFERING --> IDLE: owner change (purge rules)"],
];

const ALL_STATES = Object.keys(TRANSITIONS) as EngineState[];
const ALL_EVENTS: MachineEvent[] = [
  "source-registered",
  "output-ok",
  "no-output",
  "hardware-ready",
  "record",
  "stop",
  "governor-severe",
  "probe-passes",
  "suspend",
  "hidden",
  "resume",
  "export",
  "export-done",
  "canvas-gone",
  "re-registered",
  "grace-over",
  "encoder-error",
  "recreated",
  "disable",
  "breaker",
  "device-fallback",
  "owner-change",
];

describe("plan 7 state machine", () => {
  it.each(DIAGRAM)("%s --%s--> %s", (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it("RECORDING --> BUFFERING on Stop when the session did not rest", () => {
    expect(transition("recording", "stop", { rested: false })).toBe("buffering");
  });

  it("RECORDING --> RESTING on Stop when the session was rested", () => {
    expect(transition("recording", "stop", { rested: true })).toBe("resting");
  });

  it("enters DISABLED from IDLE only for the breaker at attach", () => {
    expect(transition("idle", "breaker")).toBe("disabled");
    expect(transition("buffering", "breaker")).toBeNull();
  });

  it("has no edge that the diagram (plus the breaker entry edge) does not draw", () => {
    const allowed = new Set(DIAGRAM.map(([from, event]) => `${from}|${event}`));
    allowed.add("recording|stop");
    allowed.add("idle|breaker");
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const key = `${state}|${event}`;
        if (allowed.has(key)) expect(transition(state, event), key).not.toBeNull();
        else expect(transition(state, event), key).toBeNull();
      }
    }
  });

  it("keeps DISABLED and RECORD_ONLY as end states for the session", () => {
    for (const event of ALL_EVENTS) {
      expect(transition("disabled", event)).toBeNull();
      expect(transition("record-only", event)).toBeNull();
    }
  });
});

describe("clip button (plan 11.3)", () => {
  const base: ButtonInput = {
    attached: true,
    supported: true,
    engine: "buffering",
    disabledReason: null,
    otherTab: false,
    recording: false,
    saving: false,
    made: false,
    error: null,
    warmSec: WARM_SECONDS,
    lostSource: false,
    held: null,
  };
  const b = (over: Partial<ButtonInput>) => deriveButton({ ...base, ...over });

  it("is hidden with no game, and hidden with no-tier on a device that cannot capture", () => {
    expect(b({ attached: false })).toEqual({ button: "hidden", reason: null, warmProgress: 0 });
    expect(b({ supported: false })).toEqual({ button: "hidden", reason: "no-tier", warmProgress: 0 });
  });

  it("fills the warming ring over 3 s of footage, then is Ready", () => {
    expect(b({ warmSec: 0 })).toEqual({ button: "warming", reason: "warming", warmProgress: 0 });
    expect(b({ warmSec: 1.5 })).toEqual({ button: "warming", reason: "warming", warmProgress: 0.5 });
    expect(b({ warmSec: 3 })).toEqual({ button: "ready", reason: null, warmProgress: 1 });
    expect(b({ engine: "warming" }).button).toBe("warming");
    expect(b({ engine: "bridged" }).button).toBe("warming");
    expect(b({ engine: "idle" }).button).toBe("warming");
  });

  it("shows Made, Saving and Error over Ready, and Recording over all", () => {
    expect(b({ made: true }).button).toBe("made");
    expect(b({ saving: true, made: true }).button).toBe("saving");
    expect(b({ error: "quota", made: true })).toEqual({ button: "error", reason: "quota", warmProgress: 0 });
    expect(b({ recording: true, saving: true }).button).toBe("recording");
    expect(b({ engine: "recording" }).button).toBe("recording");
  });

  it("maps every engine state", () => {
    expect(b({ engine: "resting" })).toMatchObject({ button: "resting", reason: "resting" });
    expect(b({ engine: "suspended" })).toMatchObject({ button: "suspended", reason: "hidden" });
    expect(b({ engine: "exporting" })).toMatchObject({ button: "exporting" });
    expect(b({ engine: "record-only" })).toMatchObject({ button: "record-only", reason: "record-only" });
    expect(b({ engine: "disabled", disabledReason: "breaker" })).toMatchObject({ button: "disabled", reason: "breaker" });
    expect(b({ engine: "disabled", disabledReason: "encoder-error" })).toMatchObject({ button: "disabled", reason: "encoder-error" });
  });

  it("keeps the button unchanged while a quiet period holds it, then shows the state", () => {
    expect(b({ engine: "source-lost", held: "ready" }).button).toBe("ready");
    expect(b({ engine: "source-lost", held: null })).toMatchObject({ button: "source-lost", reason: "source-lost" });
    expect(b({ engine: "recovering", held: "ready" }).button).toBe("ready");
    expect(b({ engine: "recovering", held: null })).toMatchObject({ button: "recovering", reason: "encoder-error" });
    expect(b({ engine: "idle", lostSource: true })).toMatchObject({ button: "source-lost" });
  });

  it("shows another tab's capture as suspended with reason other-tab", () => {
    expect(b({ otherTab: true })).toMatchObject({ button: "suspended", reason: "other-tab" });
  });
});
