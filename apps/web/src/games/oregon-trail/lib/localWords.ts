import { localWords, type WordEdit, type WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";
import { wordValue } from "@/lib/local-words/consumer";
import { registerWordRecovery } from "@/shared/lib/localWordRecovery";

export function mapLocalWordCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "oregon-trail") return null;
  const edits: WordEdit[] = [];
  for (const f of source.fields) {
    if (typeof f.identity.journeyId !== "string" || !f.identity.journeyId || typeof f.value !== "string") return null;
    if (f.path === "leaderName") edits.push({ entityKey: JSON.stringify(["journey", f.identity.journeyId]), field: "leaderName", value: f.value });
    else if (/^party\[\d+\]\.name$/.test(f.path) && typeof f.identity.id === "string") {
      edits.push({ entityKey: JSON.stringify(["journey", f.identity.journeyId, "member", f.identity.id]), field: "name", value: f.value });
    } else return null;
  }
  return edits;
}
export function readSetupLeader(lease: WordLease): string | undefined {
  const value = wordValue(localWords.read("oregon-trail", lease), ["setup"], "leaderName");
  return typeof value === "string" ? value : undefined;
}
export function readSetupParty(lease: WordLease): string[] | undefined {
  const value = wordValue(localWords.read("oregon-trail", lease), ["setup"], "partyNames");
  return Array.isArray(value) && value.every(v => typeof v === "string") ? value : undefined;
}
export function readJourneyLeader(lease: WordLease, journeyId: string): string | undefined {
  const value = wordValue(localWords.read("oregon-trail", lease), ["journey", journeyId], "leaderName");
  return typeof value === "string" ? value : undefined;
}
export function readMemberName(lease: WordLease, journeyId: string, memberId: string): string | undefined {
  const value = wordValue(localWords.read("oregon-trail", lease), ["journey", journeyId, "member", memberId], "name");
  return typeof value === "string" ? value : undefined;
}
export function writeSetupNames(lease: WordLease, leaderName: string, partyNames: string[]) {
  return localWords.write("oregon-trail", [
    { entityKey: JSON.stringify(["setup"]), field: "leaderName", value: leaderName },
    { entityKey: JSON.stringify(["setup"]), field: "partyNames", value: partyNames },
  ], lease);
}
export function writeJourneyNames(lease: WordLease, journeyId: string, leaderName: string, party: readonly {id:string; name:string}[]) {
  return localWords.write("oregon-trail", [
    { entityKey: JSON.stringify(["journey", journeyId]), field: "leaderName", value: leaderName },
    ...party.map(member => ({ entityKey: JSON.stringify(["journey", journeyId, "member", member.id]), field: "name", value: member.name })),
  ], lease);
}

localWords.registerMapper("oregon-trail", mapLocalWordCandidate);
registerWordRecovery("oregon-trail", { mapCandidate: mapLocalWordCandidate });

/** Only an explicit choice can bind names from a journey with no durable identity. */
export function previewUnmatchedCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "oregon-trail" || source.fields.some(field => field.identity.journeyId !== undefined)) return null;
  return mapLocalWordCandidate({ ...source, fields: source.fields.map(field => ({ ...field, identity: { ...field.identity, journeyId: "unmatched-journey" } })) });
}

export function writeSetupLeader(lease: WordLease, value: string) {
  return localWords.write("oregon-trail", [{ entityKey: JSON.stringify(["setup"]), field: "leaderName", value }], lease);
}
export function writeSetupParty(lease: WordLease, value: string[]) {
  return localWords.write("oregon-trail", [{ entityKey: JSON.stringify(["setup"]), field: "partyNames", value }], lease);
}

/** Cryptographic identity also works on local HTTP device test origins. */
export function createJourneyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
