/**
 * Library budgets (plan 6.5, 8.1). Pure functions.
 *
 * Persistent tiers (OPFS and IndexedDB): 25% of navigator.storage.estimate().quota.
 *
 * Where estimate() is missing (Safari 16.4 to 16.x; estimate() arrived in Safari 17),
 * the library does NOT probe the free space. A probe must grow a file past the quota
 * to find the quota, and before Safari 17 a site that went past about 1 GB got a
 * "use more space?" prompt, with more space given in 200 MB steps (web.dev "Storage
 * for the web"; WebKit "Updates to Storage Policy", 2023-08-10: "Safari 17.0 no longer
 * prompts users about a website wanting to use more space"). A kid must never get a
 * storage prompt in the middle of a save. So on these browsers the library keeps to
 * 25% of that 1 GB, and QuotaExceededError (a typed "quota" error) stays the real stop.
 *
 * Memory tier (private windows): clips live in the tab's memory next to the encode
 * rings and the game, so the budget follows the memory class (plan 6.5). Until the
 * main thread sends the class, the budget of the "low" class applies.
 */

import type { MemoryClass } from "../protocol";
import { budgetFromQuota } from "./eviction";

const MiB = 1024 * 1024;

/** The origin quota of Safari before 17, before its first "more space" prompt. */
export const NO_ESTIMATE_QUOTA_BYTES = 1024 * MiB;
/** The persistent budget where estimate() is missing or fails: 256 MiB. */
export const NO_ESTIMATE_BUDGET_BYTES = budgetFromQuota(NO_ESTIMATE_QUOTA_BYTES);

/** In-memory budgets per memory class. The lowest export budget in plan 6.5 is 60 MB. */
export const MEMORY_BUDGET_BYTES: Readonly<Record<MemoryClass, number>> = {
  low: 64 * MiB,
  mid: 128 * MiB,
  high: 256 * MiB,
};

/** The memory-tier budget for a memory class. An unknown class gets the "low" budget. */
export function memoryBudgetFor(memoryClass: MemoryClass | null | undefined): number {
  return memoryClass && Object.prototype.hasOwnProperty.call(MEMORY_BUDGET_BYTES, memoryClass)
    ? MEMORY_BUDGET_BYTES[memoryClass]
    : MEMORY_BUDGET_BYTES.low;
}

/** The persistent budget from an estimate() result. No estimate (or a bad one) gives the fixed budget. */
export function persistentBudgetFor(estimate: { quota?: number; usage?: number } | null | undefined): number {
  const quota = estimate?.quota;
  return typeof quota === "number" && Number.isFinite(quota) && quota > 0 ? budgetFromQuota(quota) : NO_ESTIMATE_BUDGET_BYTES;
}
