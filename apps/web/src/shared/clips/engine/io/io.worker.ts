/**
 * IO worker entry: mux, roll-group patch, posters and the OPFS library (plan 4, 8.1).
 *
 * Load it as a module worker:
 *   new Worker(new URL("./io.worker.ts", import.meta.url), { type: "module" })
 *
 * The message loop starts only in a real worker scope. Importing this file in a
 * window, on the server or in a test does nothing.
 */

import type { IoCmd, IoEvent } from "../../protocol";
import { type IoHandler, type IoHandlerEnv, createIoHandler } from "./ioHandler";

/** The parts of a DedicatedWorkerGlobalScope that the io worker uses. */
export interface IoWorkerScope {
  postMessage(message: IoEvent): void;
  addEventListener(type: "message", listener: (event: { data: IoCmd }) => void): void;
  addEventListener(type: "messageerror", listener: (event: unknown) => void): void;
}

/** Connects the command loop to a worker scope. */
export function installIoWorker(scope: IoWorkerScope, env: Omit<IoHandlerEnv, "post"> = {}): IoHandler {
  const handler = createIoHandler({ ...env, post: (event) => scope.postMessage(event) });
  scope.addEventListener("message", (event) => {
    void handler.handle(event.data);
  });
  scope.addEventListener("messageerror", () => {
    scope.postMessage({ t: "error", code: "mux-failed", detail: "the io worker could not read a message" });
  });
  // Startup check (plan 8.1) runs at once, not at the first command.
  void handler.start();
  return handler;
}

/** True only inside a dedicated or shared worker. */
export function isWorkerScope(scope: unknown = globalThis): boolean {
  const WorkerScope = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;
  return typeof WorkerScope === "function" && scope instanceof WorkerScope;
}

if (isWorkerScope()) {
  installIoWorker(globalThis as unknown as IoWorkerScope);
}
