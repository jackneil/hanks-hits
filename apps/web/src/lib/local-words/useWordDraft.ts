"use client";
import { useState, useSyncExternalStore } from "react";
import { localWords } from "./index";

/** Clean drafts follow arriving words; only a user's edit pins a draft. */
export function useWordDraft<T>(entity: string, cleanValue: T): [T, (value: T) => void] {
  const snapshot = useSyncExternalStore(localWords.subscribe, localWords.getSnapshot, localWords.getSnapshot);
  const key = JSON.stringify([snapshot.ownerKey, entity]);
  const [draft, setDraft] = useState<{ key: string; value: T } | null>(null);
  if (draft && draft.key !== key) setDraft(null);
  const value = snapshot.ownerKey !== null && draft?.key === key ? draft.value : cleanValue;
  return [value, value => setDraft({ key, value })];
}
