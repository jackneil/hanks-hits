/**
 * The seam between the clips lab and the clip service implementation.
 *
 * The lab uses only the service contract (service/contract.ts): it attaches
 * with ClipServiceApi.attach, registers its canvas with
 * AttachedGame.registerCanvas, and clips with clipLast, startRecording,
 * stopRecording and library.file. That is the same public API that every
 * clip surface uses, so the lab exercises the full stack: flag, service,
 * capture runtime, encode worker, io worker and library.
 *
 * This function gives the tab's clip service, or null when clips are off.
 * It does the same load that ClipProvider does (defaultLoadService): it
 * reads the clips flag, and when the flag turns capture on, it starts the
 * tab's ClipService.
 *
 * With ?aac=wasm (labParams.ts) the lab's service gets a capture engine whose
 * capability probe says "no native AAC" (wasmAacOnly): the tier is W+, and
 * the encode worker encodes the game sound with the WASM AAC encoder
 * (encode.worker.ts defaultAacKinds reads arm.caps.audioEncoderAac). Every
 * later probe of that engine (each arm) is masked the same way.
 *
 * Every import is dynamic: the capture runtime and the workers must load
 * only when clips are on (plan 4.1).
 */
import type { CapabilityReport } from "../runtime/capabilities";
import type { ClipServiceApi } from "../service/contract";
import type { ClipsLabOptions } from "./labParams";

/** Loads the clip service. The lab calls it once, after the page mounts. */
export type LabServiceLoader = () => Promise<ClipServiceApi | null>;

/**
 * The report with native AAC masked: no AudioEncoder AAC, so tier W becomes
 * W+ (a VideoEncoder with the WASM AAC encoder). Other tiers stay.
 */
export function wasmAacOnly(report: CapabilityReport): CapabilityReport {
  return {
    ...report,
    caps: { ...report.caps, audioEncoderAac: false, tier: report.caps.tier === "W" ? "W+" : report.caps.tier },
    audio: { ...report.audio, aac: false },
  };
}

export const loadLabService: LabServiceLoader = async () => {
  const { loadClipsVerdict } = await import("../config");
  const verdict = await loadClipsVerdict();
  if (!verdict.capture) return null;
  const { startClipService } = await import("../service/ClipService");
  return startClipService();
};

/** The lab's service with the WASM AAC encoder forced (?aac=wasm). */
export const loadLabServiceWasmAac: LabServiceLoader = async () => {
  const { loadClipsVerdict } = await import("../config");
  const verdict = await loadClipsVerdict();
  if (!verdict.capture) return null;
  const { startClipService } = await import("../service/ClipService");
  return startClipService({
    loadEngine: async () => {
      const [{ loadCaptureEngine }, { probeCapabilityReport }] = await Promise.all([
        import("../service/loadEngine"),
        import("../runtime/capabilities"),
      ]);
      return loadCaptureEngine({ probe: async (options) => wasmAacOnly(await probeCapabilityReport(options)) });
    },
  });
};

/** The loader for the lab's options. */
export function labServiceLoader(options: Pick<ClipsLabOptions, "aac">): LabServiceLoader {
  return options.aac === "wasm" ? loadLabServiceWasmAac : loadLabService;
}
