import type { AppProgressData } from "@hank-neil/db/schema";

export type ProgressRead<T> = {
  data: T | null;
  lastSyncedAt: string | null;
  protocol?: number;
  revision?: string | null;
};

export type ContinuationContext<T> = {
  ownerId: string;
  canonical: ProgressRead<T>;
  live: T;
  maySave: () => boolean;
};

/** Opt-in per-game recovery policy. Other games retain their existing sync. */
export interface ProgressContinuation<T extends AppProgressData> {
  readonly active: boolean;
  recover(context: ContinuationContext<T>): boolean;
  begin(context: ContinuationContext<T>, related: boolean): void;
  save(data: T): Promise<{ ok: boolean; status: number | null }>;
  flush(data: T): void;
  observeOtherTab(data: T): void;
  deactivate(): void;
}
