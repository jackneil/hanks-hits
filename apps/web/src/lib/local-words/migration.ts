import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { PROGRESS_OWNER_KEY } from "../storage-keys";
import type { SourceRecord } from "./database";
import { extractLegacyWordSource, legacyWordSources } from "./inventory";

/** Only the coordinator removes legacy sources, after their durable capture. */
export interface MigrationDatabase {
  ownerEpoch(ownerKey: string): Promise<number>;
  capture(source: SourceRecord, expectedEpoch: number): Promise<void>;
}

export interface SourceLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export type MigrationResult = "preserved" | "empty" | "changed" | "unavailable";

function digest(raw: string): string {
  return Array.from(sha256(new TextEncoder().encode(raw)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Construct before any owner marker assignment. A missing marker means legacy
 * guest data, never the currently authenticated account. Storage reads can throw;
 * an unavailable marker is distinct from a guest marker and prohibits removal.
 *
 * This foundation does not run at import time. The bootstrap/storage integration
 * supplies it before hydration; callers must not claim capture from construction.
 */
export class LegacyWordMigration {
  private readonly marker: string | null | undefined;

  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private readonly database: MigrationDatabase,
    private readonly locks: SourceLocks | undefined,
  ) {
    try { this.marker = storage.getItem(PROGRESS_OWNER_KEY); }
    catch { this.marker = undefined; }
  }

  /** No source is changed; useful before a sign-out that starts on Home. */
  async captureAll(): Promise<Record<string, MigrationResult>> {
    const result: Record<string, MigrationResult> = {};
    for (const appId of Object.keys(legacyWordSources)) result[appId] = await this.capture(appId);
    return result;
  }

  async capture(appId: string): Promise<MigrationResult> {
    return this.withSource(appId);
  }

  /**
   * The replacement is already serialized by the owning store. Null removes the
   * key. Without a cooperating cross-tab lock, preserve the source unchanged.
   * Old releases do not cooperate: the last synchronous comparison detects their
   * writes during our awaits, but cannot prevent their subsequent destructive
   * sign-out. This API makes no universal mixed-version preservation claim.
   */
  async replace(appId: string, replacement: string | null): Promise<MigrationResult> {
    return this.withSource(appId, replacement);
  }

  private async withSource(appId: string, replacement?: string | null): Promise<MigrationResult> {
    const key = legacyWordSources[appId];
    if (!key || this.marker === undefined) return "unavailable";
    if (replacement !== undefined && !this.locks) return "unavailable";
    const work = async (): Promise<MigrationResult> => {
      try {
        if (this.storage.getItem(PROGRESS_OWNER_KEY) !== this.marker) return "changed";
        const raw = this.storage.getItem(key);
        if (raw === null) {
          if (replacement === undefined || replacement === null) return "empty";
          this.storage.setItem(key, replacement);
          return "preserved";
        }
        const extracted = extractLegacyWordSource(appId, raw);
        // An unrecognized blob might hold valuable words: never discard it.
        if (extracted === null) return "unavailable";
        if (extracted.fields.length) {
          const ownerKey = await ownerKeyFor(this.marker);
          const epoch = await this.database.ownerEpoch(ownerKey);
          const sourceDigest = digest(raw);
          const sourceVersion = 1;
          await this.database.capture({
            id: JSON.stringify([ownerKey, appId, key, sourceVersion, sourceDigest]),
            ownerKey, appId, sourceKey: key, sourceVersion, digest: sourceDigest,
            raw, fields: extracted.fields,
          }, epoch);
        }
        if (this.storage.getItem(PROGRESS_OWNER_KEY) !== this.marker || this.storage.getItem(key) !== raw) return "changed";
        if (replacement === null) this.storage.removeItem(key);
        else if (replacement !== undefined) this.storage.setItem(key, replacement);
        return "preserved";
      } catch {
        // No values or raw storage errors enter logs. The source remains durable
        // when hashing, IndexedDB, locking, or the final replacement fails.
        return "unavailable";
      }
    };
    try { return this.locks ? await this.locks.request(`hh-words:source:${key}`, work) : await work(); }
    catch { return "unavailable"; }
  }
}
