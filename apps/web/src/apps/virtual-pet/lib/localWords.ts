import { localWords, type WordEdit, type WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";
import { wordValue } from "@/lib/local-words/consumer";
import { registerWordRecovery } from "@/shared/lib/localWordRecovery";

export type PetIdentity = { speciesId: string; bornAt: string };
export function mapLocalWordCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "virtual-pet") return null;
  const edits: WordEdit[] = [];
  for (const f of source.fields) {
    if (!["pet.name", "settings.petName"].includes(f.path) || typeof f.value !== "string"
      || typeof f.identity.speciesId !== "string" || !f.identity.speciesId
      || typeof f.identity.bornAt !== "string" || !f.identity.bornAt) return null;
    const entityKey = JSON.stringify(["pet", f.identity.speciesId, f.identity.bornAt]);
    const existing = edits.find(edit => edit.entityKey === entityKey);
    if (existing && existing.value !== f.value) return null;
    if (!existing) edits.push({ entityKey, field: "name", value: f.value });
  }
  return edits;
}
export function readPetName(lease: WordLease, pet: PetIdentity): string | undefined {
  const value = wordValue(localWords.read("virtual-pet", lease), ["pet", pet.speciesId, pet.bornAt], "name");
  return typeof value === "string" ? value : undefined;
}
export function writePetName(lease: WordLease, pet: PetIdentity, name: string) {
  return localWords.write("virtual-pet", [{ entityKey: JSON.stringify(["pet", pet.speciesId, pet.bornAt]), field: "name", value: name }], lease);
}

localWords.registerMapper("virtual-pet", mapLocalWordCandidate);
registerWordRecovery("virtual-pet", {
  mapCandidate: mapLocalWordCandidate,
  candidateChoices(source) {
    if (source.appId !== "virtual-pet" || mapLocalWordCandidate(source) !== null) return [];
    const choices = source.fields.map(field => {
      const edits = mapLocalWordCandidate({ ...source, fields: [field] });
      return edits?.length ? { label: field.path === "pet.name" ? "Pet name" : "Name in settings", edits } : null;
    });
    return choices.every(choice => choice !== null) ? choices : [];
  },
});
