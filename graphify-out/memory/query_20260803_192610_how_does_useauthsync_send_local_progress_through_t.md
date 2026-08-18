---
type: "query"
date: "2026-08-03T19:26:10.252991+00:00"
question: "How does useAuthSync send local progress through the authenticated progress API and persist it to the database, including ownership and merge rules?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["useAuthSync()", "POST()", "mergeForSave()", "PROGRESS_OWNER_KEY", "appProgress"]
---

# Q: How does useAuthSync send local progress through the authenticated progress API and persist it to the database, including ownership and merge rules?

## Answer

Expanded from original query via graph vocab: [auth, local, progress, sync, server, persistence, guard, owned, merge, resolution, version].

Outcome: no critical or high-severity issues were found, but five confirmed medium defects remain.

HTTP/auth/database chain:

1. `useAuthSync` requires an authenticated NextAuth session with `session.user.id` ([useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:73)).
2. Initial sync hydrates local state, then sends authenticated GET and POST requests to `/api/progress/{appId}` ([useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:115)).
3. The route authenticates, rate-limits, validates `appId`, validates the app-specific payload, and queries by `(userId, appId)` ([route.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/app/api/progress/[appId]/route.ts:30)).
4. Merge requests read and combine the existing row before the transaction, then upsert the entire `data` blob and synchronize leaderboard data ([route.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/app/api/progress/[appId]/route.ts:163)).
5. The database key is `(userId, appId)`, and the client receives save metadata before optionally re-fetching ([app-progress.ts](/Users/jack.neil/Github/hanks-hits/packages/db/src/schema/app-progress.ts:16), [route.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/app/api/progress/[appId]/route.ts:373)).

Medium findings:

1. Pre-transaction merge reads permit lost updates when concurrent writes read the same row and overwrite the entire blob; the initial no-row path has the same last-write-wins weakness ([route.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/app/api/progress/[appId]/route.ts:163), [useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:283)).
2. Autosave and `forceSync()` can submit before initial sync completes, allowing pending hydration or GET results to race with persisted game-over or autosave state ([useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:342), [useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:382), [Game.tsx](/Users/jack.neil/Github/hanks-hits/apps/web/src/games/snake/Game.tsx:468)).
3. Initial merge re-fetch compares the response with a captured snapshot rather than live state, so newer in-memory progress can be overwritten ([useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:269), [useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:317)).
4. Failed debounced or forced saves advance `lastSavedRef` before completion, suppressing retries until state changes again ([useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:367), [useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:393)).
5. Several valid monotonic counters are omitted from merge handling, allowing last-write-wins to retain lower values for food eaten, pieces captured, checkmates, walls placed, or blocks matched ([progress-merge.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/lib/progress-merge.ts:20), [store.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/games/snake/lib/store.ts:207), [store.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/games/checkers/lib/store.ts:281), [store.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/games/chess/lib/store.ts:191), [store.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/games/quoridor/lib/store.ts:411), [store.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/games/hextris/lib/store.ts:474)).

Low-severity gaps include missing runtime validation for null request bodies and non-boolean `merge`, no proven aggregate request-size enforcement, incomplete recovery when post-save re-fetch fails, ambiguous `merged` response semantics, possible UI-only `lastSynced` regression from out-of-order responses, and a missing `foreignPurgePending` beacon gate whose cross-account leak impact was not proven.

Focused verification: 5 test files, 67 tests, all passed.

The most important missing tests cover concurrent merge and no-row writes, autosave or `forceSync()` during pending initial sync, live state mutation during initial re-fetch, failed-save retries, omitted counter merges, multiple hooks during foreign purge, actual database upserts and auth isolation, null or malformed request bodies, aggregate body size, failed re-fetches, and out-of-order responses.

This audit was read-only. No product source was changed.

I can implement the fixes in priority order, starting with concurrency safety and sync sequencing.

## Outcome

- Signal: useful

## Source Nodes

- useAuthSync()
- POST()
- mergeForSave()
- PROGRESS_OWNER_KEY
- appProgress