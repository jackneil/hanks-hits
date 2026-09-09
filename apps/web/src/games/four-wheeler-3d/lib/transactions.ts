import { useFourWheeler3dStore } from "./store";
import type { TransactionResult } from "./economy";

/** Evaluate against the latest balance, then apply one complete save update. */
export function transact(
  action: (
    progress: ReturnType<typeof useFourWheeler3dStore.getState>["progress"],
  ) => TransactionResult,
): boolean {
  const store = useFourWheeler3dStore.getState();
  const result = action(store.progress);
  if (result.ok) store.updateProgress((p) => ({ ...p, ...result.patch }));
  store.setHint(result.message);
  return result.ok;
}
