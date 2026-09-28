/**
 * Next.js calls register() one time when a server process starts.
 *
 * In the production server, start the daily delete of accounts that nobody
 * used (see lib/account-retention.ts and the retention policy on /privacy).
 * The delete does not run in `next dev`, in the build, in the Edge runtime,
 * or when there is no database.
 */
export async function register(): Promise<void> {
  // The import stays inside this check (the pattern in the Next.js docs),
  // so the database code is never bundled for the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV !== "production") return;
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    if (!process.env.DATABASE_URL) return;

    const { startAccountRetentionSchedule } = await import(
      "./lib/account-retention"
    );
    startAccountRetentionSchedule();
  }
}
