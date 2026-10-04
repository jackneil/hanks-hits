import type { ProgressLease } from "../owner-bound-progress";
import type { WordRecord, SourceRecord } from "./database";
import type { CloudWordRecoveryResult } from "./recovery";

export type WordAppId = "oregon-trail" | "weather" | "toy-finder" | "drawing-app" | "drum-machine" | "virtual-pet" | "four-wheeler-3d";
export type WordLease = ProgressLease;
export type WordEdit = Readonly<Pick<WordRecord, "entityKey" | "field" | "value">>;
export type WriteResult = "durable" | "memory-only" | "stale" | "deleted";
export type CandidateResult = WriteResult | "conflict" | "missing";
export type WordAppSnapshot = Readonly<{ status: "idle" | "loading" | "ready" | "memory-only"; revision: number; pendingWrites: boolean }>;
export type WordSnapshot = Readonly<{
  ownerKey: string | null; generation: number; status: "unresolved" | "ready" | "deleted";
  apps: Readonly<Record<WordAppId, WordAppSnapshot>>;
}>;
/** A game-owned validator maps only proven identities; null retains a candidate. */
export type WordMapper = (source: SourceRecord) => readonly WordEdit[] | null;
export interface LocalWordsRuntime {
  install(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): WordSnapshot;
  captureLease(): WordLease | null;
  isCurrent(lease: WordLease): boolean;
  prepare(appId: WordAppId, lease: WordLease): Promise<WriteResult>;
  read(appId: WordAppId, lease: WordLease): readonly WordRecord[];
  write(appId: WordAppId, edits: readonly WordEdit[], lease: WordLease): Promise<WriteResult>;
  candidates(appId: WordAppId, lease: WordLease): readonly SourceRecord[];
  commitCandidate(appId: WordAppId, sourceId: string, edits: readonly WordEdit[], lease: WordLease,
    mode: "matching-identity" | "confirmed-choice"): Promise<CandidateResult>;
  recover(appId: WordAppId, capturedUserId: string, lease: WordLease): Promise<CloudWordRecoveryResult>;
  retry(lease: WordLease, appId?: WordAppId): Promise<WriteResult>;
  registerMapper(appId: WordAppId, mapper: WordMapper): void;
  forget(capturedUserId: string): Promise<void>;
}
