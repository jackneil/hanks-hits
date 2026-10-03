import { isClipId, isOwnerKey } from "../library/ownerKey";
import { getIoClient, type IoClient } from "./ioClient";

const KEY = "hh-clip-publish-intent";
const MAX_AGE = 24 * 60 * 60 * 1000;
interface Intent { id: string; created: number; owner?: string }

function storage(): Storage {
  if (typeof sessionStorage === "undefined") throw new Error("This browser cannot keep your clip through sign-in. Save the video first.");
  return sessionStorage;
}

async function checkOwner(io: IoClient, key: string, generation: number): Promise<void> {
  const owner = await io.resolveOwner();
  if (!owner.confirmed || owner.key !== key || io.sessionGeneration !== generation) {
    throw new Error("The player changed. Open your clip again before sharing.");
  }
}

let preparation = 0;

/** Keep this selected guest video across sign-in. This never publishes anything. */
export async function prepareGuestPublish(id: string): Promise<void> {
  const attempt = ++preparation;
  const io = getIoClient();
  if (!io || !isClipId(id)) throw new Error("Open your saved clip and try again.");
  const tab = storage();
  const generation = io.sessionGeneration;
  await checkOwner(io, "guest", generation);
  const { record } = await io.read(id);
  await checkOwner(io, "guest", generation);
  if (record.ownerKey !== "guest") throw new Error("This clip belongs to another player.");
  if (record.storage === "memory") throw new Error("This browser cannot keep your clip through sign-in. Save the video first.");
  // A newer explicit selection wins even if its earlier IO completes first.
  if (attempt !== preparation) throw new Error("A newer clip was selected. Open that clip to continue.");
  await io.updateForSession(id, { kept: true }, "guest", generation);
  await checkOwner(io, "guest", generation);
  if (attempt !== preparation) throw new Error("A newer clip was selected. Open that clip to continue.");
  tab.setItem(KEY, JSON.stringify({ id, created: Date.now() } satisfies Intent));
}

let resuming: Promise<string | null> | null = null;

/** Adopt only the explicitly selected guest clip, then reopen for confirmation.
 * Concurrent UI subscribers share one transfer; the next invocation after it
 * finishes sees a consumed intent. No network publication is performed here.
 */
export function resumeGuestPublish(): Promise<string | null> {
  if (resuming) return resuming;
  resuming = resume().finally(() => { resuming = null; });
  return resuming;
}

async function resume(): Promise<string | null> {
  const io = getIoClient();
  if (!io) return null;
  const tab = storage();
  const raw = tab.getItem(KEY);
  if (!raw) return null;
  let intent: Intent;
  try {
    intent = JSON.parse(raw) as Intent;
    if (!intent || !isClipId(intent.id) || !Number.isFinite(intent.created) || Date.now() - intent.created > MAX_AGE || intent.created > Date.now() ||
      (intent.owner !== undefined && (!isOwnerKey(intent.owner) || intent.owner === "guest"))) throw new Error("Invalid intent");
  } catch {
    tab.removeItem(KEY);
    return null;
  }
  const generation = io.sessionGeneration;
  const owner = await io.resolveOwner();
  if (io.sessionGeneration !== generation) throw new Error("The player changed. Open your clip again before sharing.");
  if (!owner.confirmed || owner.key === "guest") return null;
  if (intent.owner && intent.owner !== owner.key) throw new Error("Sign in as the player who started sharing this clip.");
  // Never overwrite a newer selection made while the session lookup awaited.
  if (tab.getItem(KEY) !== raw) return null;
  // Bind before any file operation so a retry cannot adopt into another account.
  intent.owner = owner.key;
  const bound = JSON.stringify(intent);
  tab.setItem(KEY, bound);
  const { record } = await io.read(intent.id);
  await checkOwner(io, owner.key, generation);
  if (record.ownerKey !== "guest" && record.ownerKey !== owner.key) throw new Error("This clip belongs to another player.");
  if (record.storage === "memory") throw new Error("This video was not saved through sign-in. Open your saved copy first.");
  if (tab.getItem(KEY) !== bound) return null;
  if (record.ownerKey === "guest") await io.updateForSession(intent.id, { ownerKey: owner.key, kept: true }, owner.key, generation);
  await checkOwner(io, owner.key, generation);
  // Do not consume a newer selection made while this transfer was pending.
  if (tab.getItem(KEY) !== bound) return null;
  tab.removeItem(KEY);
  return intent.id;
}
