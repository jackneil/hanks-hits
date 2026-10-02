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

## Completed (2026-07-21) — `fix/cso-hardening-recs` branch (CSO audit follow-ups)

The `/cso` comprehensive audit found no HIGH/MEDIUM issues in the codebase; these are the LOW/hygiene follow-ups it surfaced.

- [x] **Display-name validation (shared)** — `apps/web/src/lib/validators.ts` (`validateDisplayName` + `displayNameFromEmail`) bounds length (1-50), restricts charset, and rejects non-strings/markup. Both `POST /api/auth/signup` and `PATCH /api/profile` now use it, so signup no longer persists a raw, unbounded `name` into the `users.name` text column.
- [x] **ROM proxy per-IP rate limit** — `apps/web/src/app/api/roms/[...path]/route.ts` now calls `checkRomProxyRateLimit` (120/min/IP) before path validation or any upstream fetch, closing the unauthenticated amplification vector on top of the existing SSRF/path hardening.
- [x] **Removed dead admin endpoint** — deleted `apps/web/src/app/api/admin/backfill-leaderboards/route.ts` (one-time migration route, dead attack surface). `ADMIN_SECRET` now has no consumer and can be dropped from the Railway env.
- [x] **Dependency audit cleared (35 → 0)** — an in-range refresh plus `pnpm.overrides` (kysely, vite, esbuild, postcss) cleared all `pnpm audit` advisories (was 2 critical, 18 high). Every advisory was dev/build/test tooling or the unused `kysely` path inside `drizzle-orm` (this app uses `node-postgres`); none were runtime-reachable.

## Completed (2026-10-02) - `fix/coppa-accounts` branch (issue #26i)

- [x] **Email and password sign-up removed (COPPA).** Sign-in is Google only, and an account keeps only the Google subject id and a random gamer name. The signup page and API, the Credentials provider, bcrypt, `validators.ts`, the signup and login rate limiters and `PATCH /api/profile` (name edit) are gone; `/signup` redirects to `/login`. The 2025-12-26 signup/login rate limits, the password minimum (item 2) and the display-name validation above applied only to that removed code. Items 3 (email verification) and 5 (lockout by email) below no longer apply: there are no passwords and no stored email addresses. Decision, legal basis and purge steps: `design/ACCOUNTS_COPPA.md`.
- [x] **Account linking closed.** Auth.js links a Google account that is new to the site to whoever is signed in on that browser, and that Google account then opened the first player's account on any device. `oneAccountPerPlayer()` (`apps/web/src/lib/auth-privacy.ts`) refuses the link in code, the unique index `accounts_user_id_unique` refuses it in the database, and `/login` shows "Sign out" instead of the Google button when the browser is signed in.
- [x] **Deleted accounts sign out everywhere.** The `jwt` callback reads the account on each session read (`sessionGamerName`), so the cookie of a deleted account is cleared at its next read on every device, instead of living for 30 days.
- [x] **Sign-in ends 30 days after the sign-in.** Auth.js slides the cookie expiry on each read; the `jwt` callback keeps the sign-in time (`authTime`) and ends the session 30 days after it.
- [x] **Database pool timeouts.** `packages/db/src/index.ts` stops a connection attempt after 5 s and a query after 30 s, so a database that does not answer cannot hold a route (or every session read) for minutes.

---

## High Priority

### 1. Server Timestamps Only — SUPERSEDED (2026-07-10)
**File:** `apps/web/src/lib/progress-merge.ts`

> **Status: superseded by the clamped-ordering design.** Client timestamps are
> no longer trusted as-is: merge-ordering timestamps are clamped to sane
> server-side bounds before any comparison, the merged blob is re-validated
> against the app's Zod schema before persisting, and monotonic merge keys use
> a conservative prefix rule plus a verified exact allowlist (commits `781a181`,
> `bab096e`, `05e0784`). A client claiming a future timestamp can no longer
> win the merge, which was this item's threat. The original "server time only"
> proposal below is kept for history; it traded away legitimate offline-play
> ordering and is not planned.

<details>
<summary>Original proposal (historical)</summary>

Client-provided timestamps can still be manipulated (set the clock forward). `mergeProgress(...)` still accepts both `localTimestamp` and `serverTimestamp`, and `extractTimestamp()` reads `updatedAt` / `lastModified` / `timestamp` straight from the (client-controlled) progress blob — so a client can claim a future timestamp and win the merge.

Should use server time only for merge decisions:
```typescript
// Instead of:
mergeProgress(localData, serverData, localTimestamp, serverTimestamp)

// Use:
mergeProgress(localData, serverData, serverData?.updatedAt)
// Always trust server time
```

</details>

---

## Medium Priority

### 2. Stronger Password Requirements — DONE (2026-07-17)
**File:** `apps/web/src/app/api/auth/signup/route.ts`

> **Status: shipped on `feat/my-games-shelf`.** Minimum is now 8 characters,
> enforced server-side in the signup route and mirrored in the signup form
> (error copy, placeholder, `minLength`), with route + page tests. Existing
> accounts with shorter passwords still sign in; the rule applies at signup.

For a kids' game, don't overcomplicate (no special chars requirement) — kept.

---

## Low Priority (Future)

### 3. Email Verification - OBSOLETE (2026-10-02)
No longer applies: sign-in is Google only and no email address is stored (see `design/ACCOUNTS_COPPA.md`). Original note:
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

### 5. Account Lockout - OBSOLETE (2026-10-02)
No longer applies: there are no passwords to guess (Google sign-in only). Original note:
After X failed attempts, lock account temporarily.
Currently rate-limited by email, but could add:
- Account lockout after 20 failed attempts
- Email notification on lockout
- Unlock after 1 hour or manual reset

---

## Notes

- In-memory rate limiting resets on server restart (acceptable for low-traffic kids' game). For production with high traffic, consider Upstash Redis.
- The transaction-log table (`appTransactions` / `app_transactions` in `packages/db/src/schema/app-progress.ts`) exists but is not yet used for anti-cheat merge — intended for future exploit-proof currency tracking.
