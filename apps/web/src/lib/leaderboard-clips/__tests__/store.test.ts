// @vitest-environment node
/**
 * The in-memory ClipStore that the handler and sweeper tests use follows the
 * same rules as the Postgres store: both run storeContract.ts (the Postgres
 * run is in leaderboard-clips.integration.test.ts).
 */
import { MemoryClipStore } from "./fakes";
import { runStoreContract } from "./storeContract";

runStoreContract("in memory", async () => {
  const store = new MemoryClipStore();
  return {
    store,
    addUser: async (userId) => store.addUser(userId),
    addBoardEntry: async (userId, appId, scoreType) => store.addBoardEntry(userId, appId, scoreType),
    removeBoardEntry: async (userId, appId) => store.removeBoardEntry(userId, appId),
    setShowOnLeaderboards: async (userId, show) => {
      const profile = store.profileOf(userId);
      if (profile) profile.showOnLeaderboards = show;
    },
    deleteUser: async (userId) => store.deleteUser(userId),
    uploadCount: async (userId) => store.uploads.filter((upload) => upload.userId === userId).length,
  };
});
