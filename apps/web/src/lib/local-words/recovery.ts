import { ownerKeyFor, sha256 } from "@/shared/clips/library/ownerKey";
import { WORD_EXTRACTION_VERSION, type WordField } from "../progress-words";
import type { SourceRecord } from "./database";
import { legacyWordSources } from "./inventory";

export type RecoveryLease = Readonly<{ ownerKey: string; generation: number }>;
export type CloudWordRecoveryResult = "captured" | "empty" | "stale" | "owner-changed" | "unavailable";
type RecoveryDatabase = {
  ownerEpoch(ownerKey: string): Promise<number>;
  capture(source: SourceRecord, expectedEpoch: number): Promise<void>;
};
type Candidate = { sourceRevision: string; extractionVersion: number; payload: { fields: WordField[] } };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function wordField(value: unknown): value is WordField {
  return object(value) && typeof value.path === "string" && value.path.length > 0
    && Object.hasOwn(value, "value") && object(value.identity)
    && Object.values(value.identity).every(id => typeof id === "string" || (typeof id === "number" && Number.isFinite(id)));
}

function candidates(value: unknown, appId: string): Candidate[] | null {
  if (!object(value) || value.appId !== appId || !Array.isArray(value.candidates)) return null;
  for (const item of value.candidates) {
    if (!object(item) || typeof item.sourceRevision !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceRevision)
      || item.extractionVersion !== WORD_EXTRACTION_VERSION || !object(item.payload)
      || !Array.isArray(item.payload.fields) || !item.payload.fields.every(wordField)) return null;
  }
  return value.candidates as Candidate[];
}

/**
 * Preserve cloud candidates for the confirmed owner, without assigning labels
 * to a journey or writing final word records. A failed later capture leaves
 * earlier committed candidates available; retry uses the same content IDs.
 */
export async function recoverCloudWords(options: {
  appId: string;
  userId: string;
  lease: RecoveryLease;
  isCurrent: (lease: RecoveryLease) => boolean;
  database: RecoveryDatabase;
  fetch?: typeof globalThis.fetch;
}): Promise<CloudWordRecoveryResult> {
  const { appId, userId, database, isCurrent } = options;
  const lease = { ...options.lease };
  if (!Object.hasOwn(legacyWordSources, appId) || !userId) return "unavailable";
  try {
    if (!isCurrent(lease)) return "stale";
    const ownerKey = await ownerKeyFor(userId);
    if (!isCurrent(lease) || ownerKey !== lease.ownerKey) return "stale";
    // Read before the request: deletion during recovery invalidates this epoch.
    // The database also refuses a permanently deleted owner's fresh epoch.
    const epoch = await database.ownerEpoch(ownerKey);
    if (!isCurrent(lease)) return "stale";
    const response = await (options.fetch ?? globalThis.fetch)(`/api/progress/${appId}/legacy-words`, {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", "x-hh-expected-owner": userId },
    });
    if (!isCurrent(lease)) return "stale";
    if (response.status === 409) {
      const body: unknown = await response.json();
      if (!isCurrent(lease)) return "stale";
      return object(body) && body.code === "owner_changed" ? "owner-changed" : "unavailable";
    }
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json();
    if (!isCurrent(lease)) return "stale";
    // Validate the complete response before capturing any candidate.
    const sources = candidates(body, appId);
    if (!sources) return "unavailable";
    let captured = false;
    for (const candidate of sources) {
      if (!candidate.payload.fields.length) continue;
      const raw = JSON.stringify(candidate.payload);
      const digest = Array.from(sha256(new TextEncoder().encode(raw)), byte => byte.toString(16).padStart(2, "0")).join("");
      if (!isCurrent(lease)) return "stale";
      const sourceKey = `cloud:${appId}:${candidate.sourceRevision}`;
      await database.capture({
        id: JSON.stringify([ownerKey, appId, sourceKey, candidate.extractionVersion, digest]),
        ownerKey, appId, sourceKey, sourceVersion: candidate.extractionVersion, digest,
        raw, fields: structuredClone(candidate.payload.fields),
      }, epoch);
      if (!isCurrent(lease)) return "stale";
      captured = true;
    }
    return captured ? "captured" : "empty";
  } catch {
    // Neither typed words nor raw server/storage errors enter logs.
    return isCurrent(lease) ? "unavailable" : "stale";
  }
}
