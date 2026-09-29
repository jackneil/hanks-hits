/**
 * Picks the capture engine for this device (plan 5), behind the CaptureEngine
 * seam (engine.ts). ClipService loads this module with a dynamic import, only
 * when a clip-enabled game attaches and clips are on.
 *
 * - The capability probe runs once here (while no encoder session is live).
 * - Tier M or V: the MediaRecorder engine (engine/recorder/), with this
 *   probe's report.
 * - Every other tier: the WebCodecs engine (engineHost.ts). Its prepare()
 *   gets this probe's report, and each later arm probes again (plan 5:
 *   probes re-run at every arm). A device with no tier gets the WebCodecs
 *   engine too; its prepare() says "not supported" (the "no-tier" state).
 * Each engine module loads with its own dynamic import, so a device loads
 * only the engine it uses.
 */

import { probeCapabilityReport, type CapabilityReport } from "../runtime/capabilities";
import type { CaptureEngine } from "./engine";

type Probe = (options: { force?: boolean }) => Promise<CapabilityReport>;

export interface LoadEngineDeps {
  probe?: Probe;
  loadRecorderEngine?: (report: CapabilityReport) => Promise<CaptureEngine>;
  loadHostEngine?: (probe: Probe) => Promise<CaptureEngine>;
}

function defaultRecorder(report: CapabilityReport): Promise<CaptureEngine> {
  return import("../engine/recorder/recorderEngine").then(({ RecorderEngine }) => new RecorderEngine({ report }));
}

function defaultHost(probe: Probe): Promise<CaptureEngine> {
  return import("./engineHost").then(({ EngineHost }) => new EngineHost({ probe }));
}

/**
 * A probe that gives `report` to its first call (prepare()), and runs a real
 * probe for every later call (each arm) and for a forced call.
 */
export function probeOnceFrom(report: CapabilityReport, probe: Probe): Probe {
  let first: CapabilityReport | null = report;
  return (options) => {
    const kept = first;
    first = null;
    if (kept && !options.force) return Promise.resolve(kept);
    return probe(options);
  };
}

export async function loadCaptureEngine(deps: LoadEngineDeps = {}): Promise<CaptureEngine> {
  const probe = deps.probe ?? ((options) => probeCapabilityReport(options));
  const report = await probe({});
  const tier = report.caps.tier;
  if (tier === "M" || tier === "V") return (deps.loadRecorderEngine ?? defaultRecorder)(report);
  return (deps.loadHostEngine ?? defaultHost)(probeOnceFrom(report, probe));
}
