import { localWords, type WordEdit, type WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";
import { wordValue } from "@/lib/local-words/consumer";
import { registerWordRecovery } from "@/shared/lib/localWordRecovery";

export function mapLocalWordCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "four-wheeler-3d") return null;
  const edits: WordEdit[] = [];
  for (const f of source.fields) {
    if (typeof f.value !== "string") return null;
    if (f.path === "adventure.outfit.text") edits.push({ entityKey: JSON.stringify(["outfit"]), field: "text", value: f.value });
    else if (/^adventure\.feeders\[\d+\]\.label$/.test(f.path) && typeof f.identity.id === "string") {
      edits.push({ entityKey: JSON.stringify(["feeder", f.identity.id]), field: "label", value: f.value });
    } else return null;
  }
  return edits;
}
export function readOutfitText(lease: WordLease): string | undefined {
  const value = wordValue(localWords.read("four-wheeler-3d", lease), ["outfit"], "text");
  return typeof value === "string" ? value : undefined;
}
export function readFeederLabel(lease: WordLease, id: string): string | undefined {
  const value = wordValue(localWords.read("four-wheeler-3d", lease), ["feeder", id], "label");
  return typeof value === "string" ? value : undefined;
}
export function writeOutfitText(lease: WordLease, value: string) {
  return localWords.write("four-wheeler-3d", [{ entityKey: JSON.stringify(["outfit"]), field: "text", value }], lease);
}
export function writeFeederLabel(lease: WordLease, id: string, value: string) {
  return localWords.write("four-wheeler-3d", [{ entityKey: JSON.stringify(["feeder", id]), field: "label", value }], lease);
}

localWords.registerMapper("four-wheeler-3d", mapLocalWordCandidate);
registerWordRecovery("four-wheeler-3d", { mapCandidate: mapLocalWordCandidate });
