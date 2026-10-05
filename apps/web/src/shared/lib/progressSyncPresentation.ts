import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import type { ProgressSaveResult, ProgressSyncStatus } from "./progressSyncRuntime";

export type RecoveryOption = { id: string; label: string; data: AppProgressData };
export type RecoveryDialog = {
  options: RecoveryOption[];
  cloudMissing: boolean;
  choose: (id: string) => Promise<ProgressSaveResult>;
  close: () => void;
};
export type ProgressPresentation = {
  id: string;
  appId: ValidAppId;
  ownerKey: string;
  generation: number;
  status: ProgressSyncStatus;
  localDurable: boolean;
  retry: () => Promise<void>;
  open: () => RecoveryDialog | null;
};

const listeners = new Set<() => void>();
let entries: readonly ProgressPresentation[] = [];
const empty: readonly ProgressPresentation[] = [];
const notify = () => { for (const listener of listeners) listener(); };

/** Presentation only. The mounted runtime retains all save and owner authority. */
export const progressSyncPresentation = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => entries,
  getServerSnapshot: () => empty,
  publish(entry: ProgressPresentation) {
    const previous = entries.find(row => row.id === entry.id);
    if (previous && Object.keys(entry).every(key => previous[key as keyof ProgressPresentation] === entry[key as keyof ProgressPresentation])) return;
    entries = [...entries.filter(row => row.id !== entry.id), entry];
    notify();
  },
  remove(id: string) {
    const next = entries.filter(row => row.id !== id);
    if (next.length === entries.length) return;
    entries = next; notify();
  },
};
