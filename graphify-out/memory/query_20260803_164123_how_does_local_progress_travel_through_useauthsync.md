---
type: "query"
date: "2026-08-03T16:41:23.605460+00:00"
question: "How does local progress travel through useAuthSync to server persistence, including ownership guards and conflict resolution?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["findLocalProgress()", "isClearedOnSignOut()", "useAuthSync()", "PROGRESS_OWNER_KEY", "SIGNOUT_BROADCAST_KEY", "extractTimestamp()", "mergeForSave()", "mergeProgress()", "reconcileFields()", "POST()"]
---

# Q: How does local progress travel through useAuthSync to server persistence, including ownership guards and conflict resolution?

## Answer

Expanded from original query via vocab: [auth, local, progress, sync, server, persistence, guard, owned, merge, resolution, version]

Outcome: The graph shows local progress and `useAuthSync()` converging on shared sign-out ownership state, while the client and progress route converge on shared merge infrastructure before a missing HTTP handoff to `POST()`; the final database mutation is also unrepresented.

```text
Local discovery:
  findLocalProgress() -> safeRead() / parseAliasBlob() / unwrapPersistEnvelope()
  findLocalProgress() -> isClearedOnSignOut() <- useAuthSync()

Shared merge seam, not an HTTP edge:
  useAuthSync() -> extractTimestamp() <- mergeForSave() <- POST()
  progress route --imports--> progress-merge.ts

  - - missing client HTTP handoff - ->

Server POST pipeline:
  rate limit -> app validation -> progress validation -> mergeForSave()
  -> leaderboard handling -> handle generation

Schema path:
  POST() -> VALID_APP_IDS <- app-progress.ts -> appProgress

  - - missing final database mutation - ->
```

1. Local discovery and ownership

- [`findLocalProgress()`](</Users/jack.neil/Github/hanks-hits/apps/web/src/shared/lib/localProgress.ts:65>) calls `safeRead()`, `parseAliasBlob()`, `isClearedOnSignOut()`, and `unwrapPersistEnvelope()`.
- [`useAuthSync()`](</Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:55>) imports `PROGRESS_OWNER_KEY` and `SIGNOUT_BROADCAST_KEY` from [`storage-keys.ts`](</Users/jack.neil/Github/hanks-hits/apps/web/src/lib/storage-keys.ts:55), calls `isClearedOnSignOut()`, `clearGameStorage()`, `extractTimestamp()`, and `reportProgressToAchievements()`.
- The shortest path from `findLocalProgress()` to `useAuthSync()` is shared dependency convergence: `findLocalProgress() -> isClearedOnSignOut() <- useAuthSync()`. It is not local progress flowing directly into the hook.
- [`useAuthSync.owner-guard.test.tsx`](</Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/__tests__/useAuthSync.owner-guard.test.tsx>) proves dedicated owner-guard coverage and a foreign-purge lock concept. The graph does not encode the comparison branches.

2. Client/server seam

- `useAuthSync()` calls [`extractTimestamp()`](</Users/jack.neil/Github/hanks-hits/apps/web/src/lib/progress-merge.ts:246>).
- The progress route imports [`progress-merge.ts`](</Users/jack.neil/Github/hanks-hits/apps/web/src/lib/progress-merge.ts:223>), confirming shared merge infrastructure.
- The shortest path is `useAuthSync() -> extractTimestamp() <- progress-merge.ts <-imports- progress route`.
- The graph contains no direct `useAuthSync()` to route or fetch/request edge. The client HTTP handoff to `POST()` is a graph gap.

3. Server validation and merge

- [`POST()`](</Users/jack.neil/Github/hanks-hits/apps/web/src/app/api/progress/[appId]/route.ts:98>) calls `checkProgressRateLimit()`, references `VALID_APP_IDS`, calls `validateProgress()`, then calls `mergeForSave()`.
- `POST()` also calls `hasLeaderboardSupport()`, `extractLeaderboardScore()`, and `generateUniqueHandle()`.
- [`mergeForSave()`](</Users/jack.neil/Github/hanks-hits/apps/web/src/lib/progress-merge.ts:223>) calls `clampOrderingTimestamp()`, `extractTimestamp()`, and `mergeProgress()`.
- [`mergeProgress()`](</Users/jack.neil/Github/hanks-hits/apps/web/src/lib/progress-merge.ts:151>) calls `reconcileFields()`, which uses monotonic keys, primitive arrays, and timestamp records.
- The graph exposes these conflict-resolution strategies and call order, but not exact branch precedence or which side wins for each field.

4. What is proven versus missing

- Proven: local ownership and sign-out concepts, shared timestamp extraction, server validation and merge order, and schema reachability from `VALID_APP_IDS` to [`appProgress`](</Users/jack.neil/Github/hanks-hits/packages/db/src/schema/app-progress.ts:16>).
- Missing: the direct client HTTP handoff, the route’s auth call edge despite its [`lib/auth.ts` import](</Users/jack.neil/Github/hanks-hits/apps/web/src/app/api/progress/[appId]/route.ts:2>), and the final database insert/update edge.
- Therefore, schema reachability is confirmed, but final persistence is not graph-confirmed.

I can perform a direct source-level audit of the two graph gaps: the client HTTP handoff and the final database mutation.

## Outcome

- Signal: useful

## Source Nodes

- findLocalProgress()
- isClearedOnSignOut()
- useAuthSync()
- PROGRESS_OWNER_KEY
- SIGNOUT_BROADCAST_KEY
- extractTimestamp()
- mergeForSave()
- mergeProgress()
- reconcileFields()
- POST()
- validateProgress()
- VALID_APP_IDS
- appProgress