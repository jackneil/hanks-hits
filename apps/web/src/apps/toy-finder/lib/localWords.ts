import { localWords, type WordEdit, type WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";
import { wordValue } from "@/lib/local-words/consumer";
import { registerWordRecovery } from "@/shared/lib/localWordRecovery";

export function mapLocalWordCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "toy-finder") return null;
  const edits: WordEdit[] = [];
  for (const field of source.fields) {
    if (!/^wishlistItems\[\d+\]\.notes$/.test(field.path) || typeof field.identity.toyId !== "string" || typeof field.value !== "string") return null;
    edits.push({ entityKey: JSON.stringify(["toy", field.identity.toyId]), field: "notes", value: field.value });
  }
  return edits;
}

export function readToyNotes(lease: WordLease, id: string): string | undefined {
  const value = wordValue(localWords.read("toy-finder", lease), ["toy", id], "notes");
  return typeof value === "string" ? value : undefined;
}

export function writeToyNotes(lease: WordLease, id: string, notes: string) {
  return localWords.write("toy-finder", [{ entityKey: JSON.stringify(["toy", id]), field: "notes", value: notes }], lease);
}

localWords.registerMapper("toy-finder", mapLocalWordCandidate);
registerWordRecovery("toy-finder", { mapCandidate: mapLocalWordCandidate });
