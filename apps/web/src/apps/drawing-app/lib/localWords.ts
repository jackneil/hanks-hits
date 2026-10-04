import { localWords, type WordEdit, type WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";
import { wordValue } from "@/lib/local-words/consumer";
import { registerWordRecovery } from "@/shared/lib/localWordRecovery";

import type { SavedArtwork } from "./store";
export function isSavedArtwork(value: unknown): value is SavedArtwork {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["id", "name", "thumbnail", "dataUrl", "createdAt", "editedAt"].every(key => typeof v[key] === "string");
}
export function mapLocalWordCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "drawing-app") return null;
  const edits: WordEdit[] = [];
  for (const f of source.fields) {
    if (f.path !== "savedArtworks" || !Array.isArray(f.value) || !f.value.every(isSavedArtwork)) return null;
    for (const art of f.value) edits.push({ entityKey: JSON.stringify(["artwork", art.id]), field: "artwork", value: art });
  }
  return edits;
}
export function readArtwork(lease: WordLease, id: string): SavedArtwork | null | undefined {
  const value = wordValue(localWords.read("drawing-app", lease), ["artwork", id], "artwork");
  return value === null || isSavedArtwork(value) && value.id === id ? value : undefined;
}
export function readGallery(lease: WordLease): SavedArtwork[] {
  return localWords.read("drawing-app", lease).flatMap(record => {
    const value = record.value;
    return record.field === "artwork" && isSavedArtwork(value) && record.entityKey === JSON.stringify(["artwork", value.id]) ? [value] : [];
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export function writeArtwork(lease: WordLease, id: string, value: SavedArtwork | null) {
  return localWords.write("drawing-app", [{ entityKey: JSON.stringify(["artwork", id]), field: "artwork", value }], lease);
}

localWords.registerMapper("drawing-app", mapLocalWordCandidate);
registerWordRecovery("drawing-app", { mapCandidate: mapLocalWordCandidate });
