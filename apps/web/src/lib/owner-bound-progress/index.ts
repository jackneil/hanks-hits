import { createOwnerBoundProgress, type PersistHandle } from "./core";
export * from "./core";
export { PROGRESS_STORAGE_KEYS } from "./keys";
export const ownerBoundProgress = createOwnerBoundProgress();
export const createOwnerBoundStorage = (logicalKey: string, appId?: string) => ownerBoundProgress.createStorage(logicalKey, appId);
export const bindPersistedStore = (logicalKey: string, persist: PersistHandle, flush?: () => void) => ownerBoundProgress.bindPersistedStore(logicalKey, persist, flush);
