---
type: "query"
date: "2026-08-03T12:44:58.560757+00:00"
question: "Why does useAuthSync() connect authentication synchronization to almost every major game community?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["useAuthSync()", "isClearedOnSignOut()", "extractTimestamp()", "mergeForSave()", "POST()", "VALID_APP_IDS", "reportProgressToAchievements()", "AchievementCelebrations()"]
---

# Q: Why does useAuthSync() connect authentication synchronization to almost every major game community?

## Answer

Expanded from original query via vocab: [auth, authentication, sync, synchronization, account, accounts, game, games, major, platform, profile, provider]

Interpretation: `useAuthSync()` is a shared synchronization hub, so many entry points converge on it while it coordinates storage, progress merging, API persistence, and achievements.

```text
24 game roots + 7 app roots
          │
          ▼
     useAuthSync()
       ├──► isClearedOnSignOut() ◄── localProgress.ts
       ├──► extractTimestamp() ◄── mergeForSave() ◄── progress POST()
       │                                      └──► VALID_APP_IDS
       │                                             ▲
       │                              app-progress.ts contains it
       └──► reportProgressToAchievements()

Behavior spec: Authenticated Progress Synchronization
  ├── shares_data_with Leaderboards
  └── conceptually_related_to Progress Schema Validation
```

1. The star topology exists because the hook has 73 incident edges: 35 imports, 36 calls, 1 re-export, and 1 containment edge, touching 40 files across 35 communities. Production consumers include 24 game entry files, 7 app entry files, and `AchievementCelebrations.tsx` ([useAuthSync.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/useAuthSync.ts:55), [index.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/hooks/index.ts:1), [AchievementCelebrations.tsx](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/components/AchievementCelebrations.tsx:48)).

2. What crosses the boundary is synchronization behavior: sign-out clearing and ownership keys ([storage-keys.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/lib/storage-keys.ts:85)), timestamp extraction and progress merging ([progress-merge.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/lib/progress-merge.ts:223)), progress API persistence ([route.ts](</Users/jack.neil/Github/hanks-hits/apps/web/src/app/api/progress/[appId]/route.ts:177>)), schema validation through `VALID_APP_IDS` ([app-progress.ts](/Users/jack.neil/Github/hanks-hits/packages/db/src/schema/app-progress.ts:59)), and achievement reporting ([store.ts](/Users/jack.neil/Github/hanks-hits/apps/web/src/shared/lib/achievements/store.ts:112)).

3. “Auth Sync and Weather” is only a clustering label. Weather is one consumer; the hook lives under shared hooks and is not owned by Weather.

Would you like to trace the local-to-server merge path in more detail?

## Outcome

- Signal: useful

## Source Nodes

- useAuthSync()
- isClearedOnSignOut()
- extractTimestamp()
- mergeForSave()
- POST()
- VALID_APP_IDS
- reportProgressToAchievements()
- AchievementCelebrations()