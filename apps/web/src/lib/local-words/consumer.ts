import { localWords, type WordAppId, type WordLease } from "./index";
import type { WordRecord } from "./database";

/** Lookup stays game-typed: callers validate the unknown value before displaying it. */
export function wordValue(
  records: readonly WordRecord[],
  entity: readonly (string | number)[],
  field: string,
): unknown {
  const key = JSON.stringify(entity);
  return records.find((record) => record.entityKey === key && record.field === field)?.value;
}

/** Register only imported stores. Authority and persistence remain runtime-owned. */
export function bindWordConsumer(
  appId: WordAppId,
  subscribeStore: (listener: () => void) => () => void,
  project: (records: readonly WordRecord[], lease: WordLease | null) => void,
): () => void {
  let projecting = false;
  let preparedFor: string | null = null;
  const refresh = () => {
    if (projecting) return;
    projecting = true;
    try {
      const lease = localWords.captureLease();
      if (lease) {
        const identity = JSON.stringify([lease.ownerKey, lease.generation]);
        if (preparedFor !== identity) {
          preparedFor = identity;
          // prepare reports storage failure through its snapshot, never gates play.
          void localWords.prepare(appId, lease);
        }
      }
      project(lease ? localWords.read(appId, lease) : [], lease);
    } finally {
      projecting = false;
    }
  };
  const unsubscribeWords = localWords.subscribe(refresh);
  const unsubscribeStore = subscribeStore(refresh);
  // No hydration at import time. The installed runtime publishes owner readiness.
  return () => { unsubscribeWords(); unsubscribeStore(); };
}
