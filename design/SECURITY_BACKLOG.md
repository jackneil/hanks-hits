# Security Backlog

Items identified during security review that should be addressed eventually.
Listed in priority order.

---

## Completed (2025-12-26)

- [x] Rate limiting on signup (5 req/min/IP)
- [x] Rate limiting on login (10 attempts/15min/email)
- [x] Email normalization (lowercase + trim)

## Completed (2026-07-01) — `security/audit-fixes` branch

- [x] **Progress data validation (Zod)** — `apps/web/src/app/api/progress/[appId]/route.ts` now calls `validateProgress(appId, data)`; per-game `.strict()` schemas with bounded numeric fields live in `apps/web/src/lib/progress-schemas.ts`, so injected values (e.g. 999999 coins) are rejected.
- [x] **Dynamic localStorage cleanup** — `apps/web/src/lib/auth-client.ts` iterates `Object.keys(localStorage)` and clears keys ending in `-storage` / `-progress` / `-save` / `-game-state` (no longer misses newly-added games).
- [x] **Removed dangerous `deepMergeProgress`** — the exploitable `Math.max`/`||` merge helper is gone from the codebase.
- [x] **Hardened ROM asset proxy** — `apps/web/src/app/api/roms/[...path]/route.ts` tightened against SSRF / path abuse.
- [x] **Fixed rate-limiter client-IP derivation** — `apps/web/src/lib/rate-limit.ts` now derives the caller IP correctly (previous logic could be spoofed or collapse many users onto one key).
- [x] **Dependency CVE bumps** — `next` 16.1.1 → 16.2.9, `drizzle-orm` 0.40.1 → 0.45.2.

---

## High Priority

### 1. Server Timestamps Only
**File:** `apps/web/src/lib/progress-merge.ts`

Client-provided timestamps can still be manipulated (set the clock forward). `mergeProgress(...)` still accepts both `localTimestamp` and `serverTimestamp`, and `extractTimestamp()` reads `updatedAt` / `lastModified` / `timestamp` straight from the (client-controlled) progress blob — so a client can claim a future timestamp and win the merge.

Should use server time only for merge decisions:
```typescript
// Instead of:
mergeProgress(localData, serverData, localTimestamp, serverTimestamp)

// Use:
mergeProgress(localData, serverData, serverData?.updatedAt)
// Always trust server time
```

---

## Medium Priority

### 2. Stronger Password Requirements
**File:** `apps/web/src/app/api/auth/signup/route.ts`

Current: 6 characters minimum (`password.length < 6`)
Recommended: 8 characters minimum

For a kids' game, don't overcomplicate (no special chars requirement).

---

## Low Priority (Future)

### 3. Email Verification
New users can sign up with any email without verification.
Would require:
- Send verification email on signup
- Block login until verified
- "Resend verification" flow

Not critical for a kids' game platform but good practice.

### 4. Audit Logging
Currently no logging of:
- Failed login attempts
- Account creation
- Suspicious activity (rapid progress saves)

Would help with:
- Detecting abuse
- Debugging user issues
- Compliance (if ever needed)

### 5. Account Lockout
After X failed attempts, lock account temporarily.
Currently rate-limited by email, but could add:
- Account lockout after 20 failed attempts
- Email notification on lockout
- Unlock after 1 hour or manual reset

---

## Notes

- In-memory rate limiting resets on server restart (acceptable for low-traffic kids' game). For production with high traffic, consider Upstash Redis.
- The transaction-log table (`appTransactions` / `app_transactions` in `packages/db/src/schema/app-progress.ts`) exists but is not yet used for anti-cheat merge — intended for future exploit-proof currency tracking.
