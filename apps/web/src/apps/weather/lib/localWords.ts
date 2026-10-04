import { localWords, type WordEdit, type WordLease } from "@/lib/local-words";
import type { SourceRecord } from "@/lib/local-words/database";
import { wordValue } from "@/lib/local-words/consumer";
import { registerWordRecovery } from "@/shared/lib/localWordRecovery";

import type { GeoLocation } from "./store";
export function isGeoLocation(value: unknown): value is GeoLocation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && typeof v.latitude === "number" && Number.isFinite(v.latitude)
    && typeof v.longitude === "number" && Number.isFinite(v.longitude)
    && (v.country === undefined || typeof v.country === "string") && (v.admin1 === undefined || typeof v.admin1 === "string");
}
export function mapLocalWordCandidate(source: SourceRecord): readonly WordEdit[] | null {
  if (source.appId !== "weather") return null;
  const edits: WordEdit[] = [];
  for (const f of source.fields) {
    if (f.path === "savedLocations" && Array.isArray(f.value) && f.value.every(isGeoLocation)
      || f.path === "lastLocation" && (f.value === null || isGeoLocation(f.value))) {
      edits.push({ entityKey: JSON.stringify(["locations"]), field: f.path, value: f.value });
    } else return null;
  }
  return edits;
}
export function readSavedLocations(lease: WordLease): GeoLocation[] | undefined {
  const value = wordValue(localWords.read("weather", lease), ["locations"], "savedLocations");
  return Array.isArray(value) && value.every(isGeoLocation) ? value : undefined;
}
export function readLastLocation(lease: WordLease): GeoLocation | null | undefined {
  const value = wordValue(localWords.read("weather", lease), ["locations"], "lastLocation");
  return value === null || isGeoLocation(value) ? value : undefined;
}
export function writeSavedLocations(lease: WordLease, value: GeoLocation[]) {
  return localWords.write("weather", [{ entityKey: JSON.stringify(["locations"]), field: "savedLocations", value }], lease);
}
export function writeLastLocation(lease: WordLease, value: GeoLocation | null) {
  return localWords.write("weather", [{ entityKey: JSON.stringify(["locations"]), field: "lastLocation", value }], lease);
}

localWords.registerMapper("weather", mapLocalWordCandidate);
registerWordRecovery("weather", { mapCandidate: mapLocalWordCandidate });
