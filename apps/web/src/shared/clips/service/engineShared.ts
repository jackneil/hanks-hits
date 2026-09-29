/**
 * What both capture engines use (plan 5): the WebCodecs engine of tiers W
 * and W+ (engineHost.ts) and the MediaRecorder engine of tiers M and V
 * (engine/recorder/recorderEngine.ts).
 *
 * It is its own small module so that each engine loads only its own code: a
 * tier M or V device never loads the WebCodecs engine host (its frame pump,
 * audio tap and encode worker glue), and a tier W device never loads the
 * MediaRecorder engine. Types and a few values only; nothing here touches
 * the browser at import.
 */

import type { ContentKind } from "../runtime/capabilities";
import type { PowerState, PressureState } from "../runtime/governor";
import type { ContextType } from "../sources/canvasActivity";

/** Wait before arming again after a fatal encoder failure, so a bad config cannot spin. It doubles for each failure in a row. */
export const REARM_DELAY_MS = 1000;
/** The longest wait between two arms after failures. */
export const REARM_MAX_DELAY_MS = 30_000;
/** Arms in a row that fail before any output. After this many the engine stops ("unavailable"). */
export const ARM_FAILURE_LIMIT = 6;
/**
 * Longest wait for a game draw before a picture. After it, a 2D canvas is read
 * anyway (it keeps its pixels); a WebGL canvas gives no picture (snapshotPng).
 */
export const PICTURE_WAIT_MS = 500;

/** Power signals for the governor (plan 7). */
export interface PowerSource {
  subscribe(listener: (state: PowerState) => void): () => void;
}

/** "3d" for a WebGL context (plan 5.1: 3D games get the higher bitrate), else "2d". */
export function contentKindOf(type: ContextType): ContentKind {
  return type === "webgl" || type === "webgl2" ? "3d" : "2d";
}

/** Compute Pressure (Chromium) and Battery Status (Chromium), where they exist. */
export function browserPowerSource(): PowerSource {
  return {
    subscribe(listener) {
      const stops: Array<() => void> = [];
      const g = globalThis as unknown as {
        PressureObserver?: new (cb: (records: Array<{ state: PressureState }>) => void) => {
          observe(source: "cpu", options?: { sampleInterval?: number }): Promise<void>;
          disconnect(): void;
        };
        navigator?: { getBattery?: () => Promise<EventTarget & { level: number; charging: boolean }> };
      };
      if (typeof g.PressureObserver === "function") {
        try {
          const observer = new g.PressureObserver((records) => {
            const last = records[records.length - 1];
            if (last) listener({ pressure: last.state });
          });
          observer.observe("cpu", { sampleInterval: 1000 }).catch(() => undefined);
          stops.push(() => observer.disconnect());
        } catch {
          // No permission or no source: no pressure signal.
        }
      }
      let stopped = false;
      g.navigator
        ?.getBattery?.()
        .then((battery) => {
          if (stopped) return;
          const push = () => listener({ batteryLevel: battery.level, charging: battery.charging });
          push();
          battery.addEventListener("levelchange", push);
          battery.addEventListener("chargingchange", push);
          stops.push(() => {
            battery.removeEventListener("levelchange", push);
            battery.removeEventListener("chargingchange", push);
          });
        })
        .catch(() => undefined);
      return () => {
        stopped = true;
        for (const stop of stops.splice(0)) stop();
      };
    },
  };
}
