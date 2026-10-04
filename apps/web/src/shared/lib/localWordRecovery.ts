import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import type { CandidateResult, WordAppId, WordEdit, WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";

/** Route imports register validators, never shared UI imports game stores. */
export type WordRecoveryActions = {
  mapCandidate(source: SourceRecord): readonly WordEdit[] | null;
  candidateChoices?(source: SourceRecord): readonly { label: string; edits: readonly WordEdit[] }[];
  previewCandidate?(source: SourceRecord): readonly WordEdit[] | null;
  confirmUnmatched?(source: SourceRecord, lease: WordLease): Promise<CandidateResult>;
};
const actions = new Map<WordAppId, WordRecoveryActions>();
const synced = new Map<string, WordLease>();
const listeners = new Set<() => void>();
export function registerWordRecovery(appId: WordAppId, value: WordRecoveryActions): void { actions.set(appId, value); }
export function wordRecoveryActions(appId: WordAppId): WordRecoveryActions | undefined { return actions.get(appId); }
export function markWordRecoverySynced(appId: string, lease: WordLease): void {
  if (!ownerBoundProgress.isCurrent(lease)) return;
  synced.set(appId, lease);
  for (const listener of listeners) listener();
}
export function wordRecoverySynced(appId: WordAppId, lease: WordLease | null): boolean {
  if (!lease || !ownerBoundProgress.isCurrent(lease)) return false;
  if (lease.ownerKey === "guest") return true;
  const saved = synced.get(appId);
  return saved?.ownerKey === lease.ownerKey && saved.generation === lease.generation;
}
export function subscribeWordRecovery(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
