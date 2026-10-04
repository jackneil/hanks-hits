import { localWords, type WordEdit, type WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";
import { wordValue } from "@/lib/local-words/consumer";
import { registerWordRecovery } from "@/shared/lib/localWordRecovery";

export function mapLocalWordCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "drum-machine") return null;
  const edits: WordEdit[] = [];
  for (const field of source.fields) {
    if (!/^savedBeats\[\d+\]\.name$/.test(field.path) || typeof field.identity.id !== "string" || typeof field.value !== "string") return null;
    edits.push({ entityKey: JSON.stringify(["beat", field.identity.id]), field: "name", value: field.value });
  }
  return edits;
}

export function readBeatName(lease: WordLease, id: string): string | undefined {
  const value = wordValue(localWords.read("drum-machine", lease), ["beat", id], "name");
  return typeof value === "string" ? value : undefined;
}

export function writeBeatName(lease: WordLease, id: string, name: string) {
  return localWords.write("drum-machine", [{ entityKey: JSON.stringify(["beat", id]), field: "name", value: name }], lease);
}

localWords.registerMapper("drum-machine", mapLocalWordCandidate);
registerWordRecovery("drum-machine", { mapCandidate: mapLocalWordCandidate });
