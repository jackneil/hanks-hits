import { ownerKeyFor } from "@/shared/clips/library/ownerKey";

/**
 * The local word store: the words that a player types in a game (a pet
 * name, a beat name, Oregon Trail names) stay on the device, one store for
 * each player (design/LOCAL_WORDS.html). The store's key is
 * "hh-words:v1:" + the player's owner key ("guest" or "u_" + a hash of the
 * user id, the same keys the clip library uses), so the raw user id never
 * reaches storage.
 *
 * The word store itself is not in this file. The key is here because
 * "Delete this account" must delete the account's words on the device that
 * deletes it (COPPA 312.6(a)(2), design/ACCOUNTS_COPPA.md).
 */
export const LOCAL_WORDS_PREFIX = "hh-words:v1:";

/** The localStorage key of one player's word store. */
export function localWordsKey(ownerKey: string): string {
  return `${LOCAL_WORDS_PREFIX}${ownerKey}`;
}

/**
 * Delete the word store of a deleted account on this device. Another
 * player's store and the guest store stay. A store that does not exist is
 * not an error. Throws only when storage is blocked; the caller decides.
 */
export async function forgetLocalWords(userId: string): Promise<void> {
  // An empty id would give the guest key: never delete the guest's words here.
  if (!userId) return;
  localStorage.removeItem(localWordsKey(await ownerKeyFor(userId)));
}
