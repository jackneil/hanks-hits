/**
 * Capability probe worker. capabilities.ts starts it with
 * new Worker(new URL("./capabilities.worker.ts", import.meta.url), { type: "module" }).
 * It answers one ProbeRequest with one ProbeResponse. The logic is in
 * capabilityProbe.ts, so tests run it without a worker.
 */
import { globalProbeEnv, runProbe, type ProbeRequest, type ProbeResponse } from "./capabilityProbe";

interface WorkerScope {
  onmessage: ((event: MessageEvent<ProbeRequest>) => void) | null;
  postMessage(message: ProbeResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  if (event.data?.t !== "probe") return;
  runProbe(globalProbeEnv("worker"), event.data).then(
    (report) => scope.postMessage({ t: "probe-result", report }),
    (error: unknown) => scope.postMessage({ t: "probe-error", error: String(error) }),
  );
};
